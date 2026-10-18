import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {BACKUP_TABLES,sealBackup,verifyBackup,canonicalJSON} from '../src/server/backup.mjs';
import {prepareRestore,restoreBackupFile,readRestoredRows} from '../scripts/restore-backup.mjs';

const empty = () => ({format_version:2,schema_version:7,exported_at:'2026-10-17T12:00:00.000Z',timezone:'Asia/Riyadh',...Object.fromEntries(BACKUP_TABLES.map(table => [table,[]]))});
async function withDirectory(run) {
  const parent = resolve(tmpdir()), directory = await mkdtemp(join(parent,'wallet-restore-test-'));
  try { return await run(directory); }
  finally {
    assert.ok(resolve(directory).startsWith(parent + '\\') || resolve(directory).startsWith(parent + '/'));
    await rm(directory,{recursive:true,force:true});
  }
}
test('Backup digest detects changed data, preserves older current exports and validates retry receipts',async () => {
  const data = await sealBackup(empty());
  assert.equal((await verifyBackup(data,{forRestore:true})).checksum,'verified');
  assert.equal((await verifyBackup({...data,timezone:'UTC'})).ok,false);
  assert.equal((await verifyBackup({...data,integrity:{algorithm:'SHA-256',digest:'0'.repeat(64)}})).ok,false);
  assert.equal((await verifyBackup(empty(),{forRestore:true})).ok,true);
  assert.equal((await verifyBackup({...empty(),schema_version:99},{forRestore:true})).ok,false);
  assert.equal((await verifyBackup({...empty(),mutation_requests:undefined},{forRestore:true})).ok,false);
  const receipt = {request_id:'test',actor:'manager@example.test',scope:'POST /api/tasks',fingerprint:'a'.repeat(64),response_json:'{"id":"task"}',created_at:'2026-10-17T12:00:00.000Z'};
  assert.equal((await verifyBackup({...empty(),mutation_requests:[receipt]})).ok,true);
  for (const receipts of [[receipt,receipt],[null],[{...receipt,response_json:'not JSON'}],[{...receipt,fingerprint:'broken'}]])
    assert.equal((await verifyBackup({...empty(),mutation_requests:receipts})).ok,false);
});
test('Restoration round-trips all schema and guard definitions, including an empty wallet',async () => {
  const restored = await prepareRestore(await sealBackup(empty()));
  try {
    assert.equal(restored.report.checks.sql_round_trip,true);
    assert.equal(restored.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,9);
    assert.equal(restored.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").get().n,restored.report.checks.triggers_restored);
    assert.deepEqual(readRestoredRows(restored.db),Object.fromEntries(BACKUP_TABLES.map(table => [table,[]])));
    assert.throws(() => restored.db.exec(restored.sql),/already exists/);
    assert.equal(restored.db.prepare('SELECT count(*) n FROM entities').get().n,0);
  } finally { restored.db.close(); }
});
test('Current unsigned snapshots preserve Unicode, leading zeros, literal SQL and NUL text exactly',async () => {
  const base = await prepareRestore(empty());
  let data;
  try {
    base.db.prepare('INSERT INTO entities(id,kind,name,electricity_meter,notes,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run('unit','unit',"شقة '); DROP TABLE audit; --\nسطر ثانٍ",'001234','نص\0خاص','2026-10-17T00:00:00.000Z','2026-10-17T00:00:00.000Z','manager@example.test');
    data = {...empty(),...readRestoredRows(base.db)};
  } finally { base.db.close(); }
  const result = await prepareRestore(data);
  try {
    assert.equal(result.report.backup_checksum,'absent');
    assert.equal(result.db.prepare('SELECT electricity_meter FROM entities').get().electricity_meter,'001234');
    assert.equal(canonicalJSON(readRestoredRows(result.db)),canonicalJSON(Object.fromEntries(BACKUP_TABLES.map(table => [table,data[table]]))));
  } finally { result.db.close(); }
  for (const change of [row => {delete row.phone;},row => {row.unknown='discard me';},row => {row.odometer_km='123';},row => {row.parent_id='missing';}]) {
    const invalid = structuredClone(data);change(invalid.entities[0]);
    await assert.rejects(() => prepareRestore(invalid));
  }
});
test('File restoration creates a durable independent DB and refuses existing paths without modifying the source',async () => withDirectory(async directory => {
  const source = join(directory,'backup.json'),output = join(directory,'recovered');
  const contents = JSON.stringify(await sealBackup(empty()));
  await writeFile(source,contents);
  const report = await restoreBackupFile(source,output);
  assert.equal(report.ok,true);
  const stored = JSON.parse(await readFile(join(output,'verification.json'),'utf8'));
  assert.equal(stored.checks.persisted_database_equal,true);
  const db = new DatabaseSync(join(output,'wallet.sqlite'),{readOnly:true});
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'); }
  finally { db.close(); }
  const prior = await readFile(join(output,'wallet.sqlite'));
  await assert.rejects(() => restoreBackupFile(source,output),/موجود/);
  await assert.rejects(() => restoreBackupFile(source,source),/موجود/);
  assert.deepEqual(await readFile(join(output,'wallet.sqlite')),prior);
  assert.equal(await readFile(source,'utf8'),contents);
  const existing = join(directory,'existing'); await mkdir(existing);
  await writeFile(join(existing,'my-data.txt'),'لا تمس هذه البيانات');
  await assert.rejects(() => restoreBackupFile(source,existing),/موجود/);
  assert.equal(await readFile(join(existing,'my-data.txt'),'utf8'),'لا تمس هذه البيانات');
}));
test('Corrupt, incomplete and unsupported files create no recovery directory',async () => withDirectory(async directory => {
  const source=join(directory,'bad.json'),output=join(directory,'rejected');
  const sealed=await sealBackup(empty());
  for (const text of ['{broken',JSON.stringify({...sealed,exported_at:'2026-10-17T13:00:00.000Z'}),JSON.stringify({...empty(),audit:undefined}),JSON.stringify({...empty(),schema_version:5})]) {
    await writeFile(source,text);
    await assert.rejects(() => restoreBackupFile(source,output));
    await assert.rejects(() => access(output));
    assert.equal(await readFile(source,'utf8'),text);
  }
}));

test('Schema 6 backups upgrade to 9 without losing fields or guessing old property types',async () => {
  const base=await prepareRestore(empty());
  let legacy;
  try {
    base.db.prepare('INSERT INTO entities(id,kind,name,electricity_meter,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?)')
      .run('old-house','property','عقار قديم','000987','2026-10-01','2026-10-01','manager');
    legacy={...empty(),...readRestoredRows(base.db),schema_version:6};
    for(const row of legacy.entities)delete row.property_type;
  }finally{base.db.close()}
  const before=canonicalJSON(legacy),result=await prepareRestore(await sealBackup(legacy));
  try {
    const rows=readRestoredRows(result.db);
    assert.equal(result.report.source_schema_version,6);assert.equal(result.report.schema_version,9);
    assert.equal(rows.entities[0].property_type,null);
    delete rows.entities[0].property_type;
    assert.equal(canonicalJSON(rows.entities),canonicalJSON(legacy.entities));
    assert.equal(canonicalJSON(legacy),before);
  }finally{result.db.close()}
});
