import {BACKUP_TABLES,BACKUP_FORMAT,BACKUP_SCHEMA,MAX_RESTORE_BYTES,verifyBackup,sealBackup,backupDigest,canonicalJSON,BOOKING_DEFAULTS,upgradeBackupData} from './backup.mjs';
import {project} from '../shared/finance.mjs';

const quote=name=>'"'+name.replaceAll('"','""')+'"';
const stmt=(db,sql,...values)=>db.prepare(sql).bind(...values);
const fail=(message,code=400)=>{throw Object.assign(new Error(message),{code});};
const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const RESTORE_CONFIRMATION='استعادة';
export const restoreConflict=()=>fail('تغيّرت بيانات المحفظة منذ الفحص. حدّث البيانات وافحص النسخة مجددًا قبل الاستعادة.',409);

export async function restoreControl(db){
  // Ordinary writes must not load the potentially large recovery snapshot.
  return db.prepare('SELECT id,generation,revision,last_request,last_actor,last_fingerprint,restored_at FROM restore_control WHERE id=1').first();
}
export function generationGuard(db,generation){
  return stmt(db,'UPDATE restore_control SET generation=CASE WHEN generation=? THEN generation ELSE NULL END,revision=revision+1 WHERE id=1',generation);
}
export async function readBackupSnapshot(db){
  // Read-only batches share a repeatable-read snapshot. Typed rows also pass
  // through the safe int8 decoder (JSON aggregation would bypass it).
  const [state,...tables]=await db.batch([db.prepare('SELECT generation,revision FROM restore_control WHERE id=1'),
    ...BACKUP_TABLES.map(table=>db.prepare(`SELECT * FROM ${quote(table)}`))]);
  const result=state.results[0];
  const backup=await sealBackup({format_version:BACKUP_FORMAT,schema_version:BACKUP_SCHEMA,
    exported_at:new Date().toISOString(),timezone:'Asia/Riyadh',
    ...Object.fromEntries(BACKUP_TABLES.map((table,index)=>[table,tables[index].results]))});
  return {backup,control:{generation:result.generation,revision:result.revision}};
}
async function inspect(db,backup,{browser=true}={}){
  if(browser&&byteLength(backup)>MAX_RESTORE_BYTES)fail('حد استعادة JSON في المتصفح 10 MB. استخدم أداة الكمبيوتر للملفات الكبيرة.',413);
  const report=await verifyBackup(backup,{forRestore:true});
  if(!report.ok)return {report};
  const definitions=(await db.query(`SELECT table_name,column_name AS name,data_type,is_nullable
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY ordinal_position`,[BACKUP_TABLES])).rows;
  const columns=Object.fromEntries(BACKUP_TABLES.map(table=>[table,definitions.filter(column=>column.table_name===table)]));
  for(const table of BACKUP_TABLES){
    if(!columns[table].length)fail('مخطط قاعدة البيانات غير مكتمل؛ شغّل ترحيل PostgreSQL.',503);
    const sourceColumns=columns[table].filter(column=>!(backup.schema_version===6&&table==='entities'&&column.name==='property_type')
      &&!(backup.schema_version<9&&table==='agreements'&&Object.hasOwn(BOOKING_DEFAULTS,column.name)));
    const keys=sourceColumns.map(column=>column.name).sort();
    for(const row of backup[table]){
      if(canonicalJSON(Object.keys(row).sort())!==canonicalJSON(keys)){
        report.issues.push({table,reason:'حقول ناقصة أو غير معروفة'});break;
      }
      for(const column of sourceColumns){
        const value=row[column.name],numeric=['bigint','integer','smallint'].includes(column.data_type);
        if((value===null&&column.is_nullable==='NO')||(value!==null&&(numeric?!Number.isSafeInteger(value):typeof value!=='string')))
          report.issues.push({table,reason:'نوع غير صحيح للحقل '+column.name});
        if(typeof value==='string'&&value.includes('\u0000'))report.issues.push({table,reason:'حرف غير مدعوم في '+column.name});
        if(value!==null&&column.name.endsWith('_json')){
          try{JSON.parse(value);}catch{report.issues.push({table,reason:'JSON غير صحيح في '+column.name});}
        }
      }
    }
  }
  report.ok=report.issues.length===0;
  const upgraded=upgradeBackupData(backup);
  return {report,columns,rows:Object.fromEntries(BACKUP_TABLES.map(table=>[table,upgraded[table]]))};
}
function totals(rows){
  const result={paid_in:0,paid_out:0,remaining_in:0,remaining_out:0},byAgreement=new Map();
  for(const payment of rows.payments){const list=byAgreement.get(payment.agreement_id)??[];list.push(payment);byAgreement.set(payment.agreement_id,list);}
  for(const agreement of rows.agreements.filter(row=>row.status==='active')){
    const p=project(agreement,byAgreement.get(agreement.id)??[]);
    result['paid_'+agreement.direction]+=p.paid_total_cents;
    result['remaining_'+agreement.direction]+=p.remaining_cents;
  }
  return result;
}
export async function previewRestore(db,backup){
  const {report,rows}=await inspect(db,backup);
  if(!report.ok)return {ok:false,issues:report.issues.slice(0,20),issue_count:report.issues.length};
  const current=await readBackupSnapshot(db);
  if(byteLength(current.backup)>MAX_RESTORE_BYTES)fail('البيانات الحالية كبيرة للاستعادة في المتصفح؛ استخدم أداة الكمبيوتر لحفظ نسخة رجوع كاملة.',413);
  return {ok:true,checksum:report.checksum,source_schema:backup.schema_version,exported_at:backup.exported_at,
    counts:report.counts,current_counts:Object.fromEntries(BACKUP_TABLES.map(table=>[table,current.backup[table].length])),totals:totals(rows),
    checkpoint:{...current.control,digest:await backupDigest(backup),checked_at:new Date().toISOString()}};
}
async function replaceRows(db,rows,columns){
  // No uploaded SQL is executed. SET LOCAL clears on commit and rollback.
  await db.query("SET LOCAL wallet.restore_mode='on'");
  await db.query('SET CONSTRAINTS ALL DEFERRED');
  for(const table of [...BACKUP_TABLES].reverse())await db.query(`DELETE FROM ${quote(table)}`);
  for(const table of BACKUP_TABLES){
    const keys=columns[table].map(column=>quote(column.name)).join(',');
    // Bound individual SQL values; all batches share one atomic transaction.
    for(let start=0;start<rows[table].length;start+=500){
      await db.query(`INSERT INTO ${quote(table)} (${keys}) SELECT ${keys} FROM jsonb_populate_recordset(NULL::${quote(table)},$1::jsonb)`,[JSON.stringify(rows[table].slice(start,start+500))]);
    }
  }
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  await db.query("SET LOCAL wallet.restore_mode='off'");
}
export async function commitRestore(db,user,body){
  if(body.confirmation!==RESTORE_CONFIRMATION)fail('اكتب استعادة لتأكيد استبدال بيانات المحفظة.');
  if(typeof body.request_id!=='string'||!/^[a-f0-9-]{36}$/.test(body.request_id))fail('معرف الاستعادة غير صحيح');
  const fingerprint=await backupDigest(body);
  return db.transaction(async()=>{
    await db.query('SELECT id FROM restore_control WHERE id=1 FOR UPDATE');
    const state=await restoreControl(db);
    if(state.last_request===body.request_id){
      if(state.last_actor!==user.email||state.last_fingerprint!==fingerprint)restoreConflict();
      return {ok:true,generation:state.generation,restored_at:state.restored_at,idempotent:true};
    }
    const {report,rows,columns}=await inspect(db,body.backup);
    if(!report.ok)fail('رُفضت النسخة: '+report.issues[0]?.reason);
    const point=body.checkpoint;
    if(!point||point.digest!==await backupDigest(body.backup)||!Number.isSafeInteger(point.revision)||typeof point.generation!=='string'
      ||!Number.isFinite(Date.parse(point.checked_at))||Math.abs(Date.now()-Date.parse(point.checked_at))>15*60*1000
      ||state.revision!==point.revision||state.generation!==point.generation)restoreConflict();
    const current=await readBackupSnapshot(db);
    if(byteLength(current.backup)>MAX_RESTORE_BYTES)fail('حجم نسخة الرجوع يتجاوز حد المتصفح؛ استخدم أداة الكمبيوتر.',413);
    const generation=crypto.randomUUID(),at=new Date().toISOString();
    await db.query('UPDATE restore_control SET generation=$1,revision=revision+1,last_request=$2,last_actor=$3,last_fingerprint=$4,recovery_json=$5,restored_at=$6 WHERE id=1',
      [generation,body.request_id,user.email,fingerprint,JSON.stringify(current.backup),at]);
    await replaceRows(db,rows,columns);
    await stmt(db,'INSERT INTO audit(id,actor,action,target_type,target_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
      crypto.randomUUID(),user.email,'استعادة نسخة احتياطية','backup',generation,
      JSON.stringify({counts:Object.fromEntries(BACKUP_TABLES.map(table=>[table,current.backup[table].length]))}),
      JSON.stringify({source_exported_at:body.backup.exported_at,digest:point.digest,counts:report.counts}),at).run();
    return {ok:true,generation,restored_at:at};
  });
}

// Offline migration of old D1 JSON, including files above the browser cap.
// Only an empty, migrated destination is accepted; the source stays untouched.
export async function importIntoEmptyDatabase(db,backup){
  const {report,rows,columns}=await inspect(db,backup,{browser:false});
  if(!report.ok)fail('رُفضت النسخة: '+report.issues[0]?.reason);
  return db.transaction(async()=>{
    await db.query('SELECT id FROM restore_control WHERE id=1 FOR UPDATE');
    for(const table of BACKUP_TABLES){
      if((await db.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rowCount)fail('الاستيراد يتطلب قاعدة جديدة فارغة؛ لم تتغير البيانات.',409);
    }
    await replaceRows(db,rows,columns);
    await db.query('UPDATE restore_control SET generation=$1,revision=revision+1 WHERE id=1',[crypto.randomUUID()]);
    return {ok:true,counts:report.counts};
  });
}
