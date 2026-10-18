import {DatabaseSync} from 'node:sqlite';
import {readFile, readdir, mkdir, writeFile, unlink, rmdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {BACKUP_TABLES, BACKUP_SCHEMA, canonicalJSON, verifyBackup, upgradeBackupData} from '../src/server/backup.mjs';
import {project, currentSummary} from '../src/shared/finance.mjs';
import {effectiveUnitStatus} from '../src/shared/unit-status.mjs';

const quote = name => '"' + name.replaceAll('"','""') + '"';
const digest = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');
const primaryKey = table => ({hidden_audit:'audit_id', dismissed_alerts:'alert_key', mutation_requests:'request_id'}[table] ?? 'id');
const sortedRows = (table, rows) => [...rows].sort((a,b) => a[primaryKey(table)] < b[primaryKey(table)] ? -1 : a[primaryKey(table)] > b[primaryKey(table)] ? 1 : 0);
export const readRestoredRows = db => Object.fromEntries(BACKUP_TABLES.map(table => [table, sortedRows(table,db.prepare(`SELECT * FROM ${quote(table)}`).all())]));
const snapshotRows = data => Object.fromEntries(BACKUP_TABLES.map(table => [table,sortedRows(table,data[table])]));

function fail(message, details) {
  const error = new Error(message);
  error.details = details;
  throw error;
}
function derivedState(data, day) {
  data = snapshotRows(data);
  return {
    agreements: sortedRows('agreements',data.agreements).map(agreement => ({id:agreement.id,
      projection:project(agreement,data.payments.filter(payment => payment.agreement_id === agreement.id))})),
    units: sortedRows('entities',data.entities).filter(entity => entity.kind === 'unit').map(unit => ({id:unit.id,status:effectiveUnitStatus(unit,data.agreements,day)})),
    financial: currentSummary(data.agreements,data.payments,data.expenses,day.slice(0,7),day),
  };
}
function validateDatabase(db, source, day) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') fail('فشل فحص سلامة قاعدة الاستعادة');
  if (db.prepare('PRAGMA foreign_key_check').all().length) fail('علاقات غير سليمة في قاعدة الاستعادة');
  const restored = readRestoredRows(db);
  if (canonicalJSON(restored) !== canonicalJSON(snapshotRows(source))) fail('السجلات المستعادة لا تطابق النسخة؛ لم تُقبل الاستعادة');
  if (canonicalJSON(derivedState(restored,day)) !== canonicalJSON(derivedState(source,day))) fail('الأرصدة أو الجداول أو حالات الوحدات لا تطابق النسخة');
  return restored;
}
function sqlValue(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  // Preserve NUL and Unicode without allowing text to become executable SQL.
  if (value.includes('\0')) return `CAST(X'${Buffer.from(value,'utf8').toString('hex')}' AS TEXT)`;
  return "'" + value.replaceAll("'","''") + "'";
}
function makeSQL(db) {
  const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables = [...BACKUP_TABLES,'restore_control','d1_migrations'];
  const lines = ['-- my Wallet: restore into a NEW EMPTY database only.',
    '-- No DROP, DELETE, REPLACE or IF NOT EXISTS: existing wallet tables cause an error.',
    '-- D1 import manages its transactions. Discard a new target if import fails.',
    'PRAGMA defer_foreign_keys=ON;'];
  for (const table of tables) {
    const entry = schema.find(item => item.type === 'table' && item.name === table);
    lines.push(entry.sql.replace(/\bIF NOT EXISTS\s+/i,'') + ';');
  }
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(column => column.name);
    let rows = db.prepare(`SELECT * FROM ${quote(table)}`).all();
    // Parents precede units, including archived parents. Runtime insert guards
    // are installed after loading history, not applied to historical records.
    if (table === 'entities') rows.sort((a,b) => Number(Boolean(a.parent_id))-Number(Boolean(b.parent_id)));
    for (const row of rows) lines.push(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(column => sqlValue(row[column])).join(',')});`);
  }
  for (const type of ['index','trigger']) for (const entry of schema.filter(item => item.type === type)) lines.push(entry.sql + ';');
  lines.push('PRAGMA defer_foreign_keys=OFF;');
  return lines.join('\n') + '\n';
}

// Operates exclusively on new in-memory databases; never opens a user's DB.
export async function prepareRestore(data) {
  const validation = await verifyBackup(data,{forRestore:true});
  if (!validation.ok) fail('رُفضت النسخة قبل الاستعادة',validation.issues);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    const root = new URL('../database/migrations/',import.meta.url);
    const migrations = (await readdir(root)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    if (Number.parseInt(migrations.at(-1),10) !== BACKUP_SCHEMA) fail('إصدار الترحيلات لا يطابق أداة الاستعادة');
    const sourceMigrations = migrations.filter(name => Number.parseInt(name,10) <= data.schema_version);
    for (const name of sourceMigrations) db.exec(await readFile(new URL(name,root),'utf8'));
    let triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    // These guards enforce NEW operations, so replaying a historical snapshot
    // through them would reject valid closed/voided/vacated records. They are
    // restored in the same transaction before the database can be published.
    for (const trigger of triggers) db.exec(`DROP TRIGGER ${quote(trigger.name)}`);
    db.exec('PRAGMA defer_foreign_keys=ON');
    for (const table of BACKUP_TABLES) {
      const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
      const keys = columns.map(column => column.name);
      const statement = db.prepare(`INSERT INTO ${quote(table)} (${keys.map(quote).join(',')}) VALUES (${keys.map(() => '?').join(',')})`);
      for (const row of data[table]) {
        if (canonicalJSON(Object.keys(row).sort()) !== canonicalJSON([...keys].sort())) fail(`حقول ناقصة أو غير معروفة في ${table}`,{id:row[primaryKey(table)]});
        for (const column of columns) {
          const value = row[column.name];
          if ((value === null && (column.notnull || column.pk)) ||
            (value !== null && (column.type === 'INTEGER' ? !Number.isSafeInteger(value) : typeof value !== 'string'))) fail(`نوع حقل غير صحيح في ${table}.${column.name}`,{id:row[primaryKey(table)]});
          if (value !== null && column.name.endsWith('_json')) {
            try { JSON.parse(value); } catch { fail(`JSON غير صحيح في ${table}.${column.name}`); }
          }
        }
        statement.run(...keys.map(key => row[key]));
      }
    }
    for (const trigger of triggers) db.exec(trigger.sql);
    const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    validateDatabase(db,data,day);
    for (const name of migrations.filter(name => !sourceMigrations.includes(name))) db.exec(await readFile(new URL(name,root),'utf8'));
    // Upgrade v6 by adding an unknown classification only; every old field is
    // compared before and after migration, and no classification is inferred.
    const expected = upgradeBackupData(data);
    triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    // Wrangler's migration ledger is reconstructed from the trusted schema,
    // so a recovered D1 database does not reapply already installed migrations.
    db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
    const appliedAt = new Date().toISOString();
    for (const name of migrations) db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES (?,?)').run(name,appliedAt);
    const rows = validateDatabase(db,expected,day);
    db.exec('COMMIT');
    const sql = makeSQL(db);
    // Exercise the exact recovery SQL in another empty database, including its
    // constraints, triggers and ledger, before writing any deliverable files.
    const imported = new DatabaseSync(':memory:');
    try {
      imported.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
      imported.exec(sql);
      validateDatabase(imported,expected,day);
      imported.exec('COMMIT');
      const installed = imported.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
      if (canonicalJSON(installed) !== canonicalJSON(triggers)) fail('قواعد الحماية المستعادة غير مطابقة');
    } finally { imported.close(); }
    return {db,sql,report:{ok:true,schema_version:BACKUP_SCHEMA,source_schema_version:data.schema_version,backup_checksum:validation.checksum,
      source_exported_at:data.exported_at,verified_at:appliedAt,counts:validation.counts,
      rows_sha256:digest(rows),sql_sha256:createHash('sha256').update(sql).digest('hex'),
      checks:{all_rows_equal:true,financial_schedules_equal:true,unit_statuses_equal:true,
        foreign_keys:true,sqlite_integrity:true,sql_round_trip:true,triggers_restored:triggers.length,migrations_recorded:migrations.length}}};
  } catch (error) { db.close(); throw error; }
}

export async function restoreBackupFile(input, outputDirectory) {
  const source = resolve(input), output = resolve(outputDirectory);
  let data;
  try { data = JSON.parse((await readFile(source,'utf8')).replace(/^\uFEFF/,'')); }
  catch { fail('تعذرت قراءة ملف النسخة بصيغة JSON؛ لم تُعدّل أي بيانات'); }
  const prepared = await prepareRestore(data);
  let created = false;
  const paths = ['wallet.sqlite','restore.sql','verification.json'].map(name => join(output,name));
  try {
    // Exclusive mkdir refuses an existing folder, file, symlink or DB. No force
    // flag exists, and no path to a running or remote database is accepted.
    await mkdir(output); created = true;
    prepared.db.prepare('VACUUM INTO ?').run(paths[0]);
    // Read the actual file back as well, not just the in-memory copy.
    const saved = new DatabaseSync(paths[0],{readOnly:true});
    try {
      if (digest(readRestoredRows(saved)) !== prepared.report.rows_sha256) fail('فشلت مطابقة ملف القاعدة المحفوظ');
    } finally { saved.close(); }
    await writeFile(paths[1],prepared.sql,{flag:'wx',mode:0o600});
    await writeFile(paths[2],JSON.stringify({...prepared.report,checks:{...prepared.report.checks,persisted_database_equal:true}},null,2)+'\n',{flag:'wx',mode:0o600});
    return {...prepared.report,output};
  } catch (error) {
    if (created) {
      for (const path of paths) await unlink(path).catch(() => {});
      await rmdir(output).catch(() => {});
    }
    if (error.code === 'EEXIST') fail('مسار الإخراج موجود؛ اختر مجلدًا جديدًا. لم نكتب فوق أي ملف');
    throw error;
  } finally { prepared.db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('Usage: npm run backup:legacy:verify -- backup.json --output NEW_DIRECTORY\nCreates wallet.sqlite, restore.sql and verification.json. Never overwrites existing data or connects to D1.');
  else if (args.length !== 3 || args[1] !== '--output' || !args[0] || !args[2]) {
    console.error('Usage: npm run backup:legacy:verify -- backup.json --output NEW_DIRECTORY'); process.exitCode = 2;
  } else try { console.log(JSON.stringify(await restoreBackupFile(args[0],args[2]),null,2)); }
  catch (error) { console.error(JSON.stringify({ok:false,error:error.message,issues:error.details},null,2)); process.exitCode = 1; }
}
