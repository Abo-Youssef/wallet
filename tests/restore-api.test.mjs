import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import worker from '../src/server/worker.mjs';
import {createPostgresFixture} from './pg-fixture.mjs';
import {BACKUP_TABLES,canonicalJSON,sealBackup} from '../src/server/backup.mjs';
import {importIntoEmptyDatabase,restoreControl} from '../src/server/restore.mjs';
import {project} from '../src/shared/finance.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'restore-pg',alg:'RS256',use:'sig'};
globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}));
function token(role){
  const t=Math.floor(Date.now()/1000),b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const data=b64({alg:'RS256',kid:jwk.kid})+'.'+b64({iss:'https://restore-test.cloudflareaccess.com',aud:['restore-test'],email:role+'@example.test',exp:t+600,nbf:t-1});
  return data+'.'+createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url');
}
const sorted=rows=>[...rows].sort((a,b)=>canonicalJSON(a).localeCompare(canonicalJSON(b)));
async function fixture(){
  const pg=await createPostgresFixture();
  const env={DATABASE_URL:pg.connectionString,ACCESS_TEAM_DOMAIN:'restore-test.cloudflareaccess.com',ACCESS_AUD:'restore-test',MANAGER_EMAIL:'manager@example.test',ASSISTANT_EMAIL:'assistant@example.test'};
  const generation=async()=>(await pg.one('SELECT generation FROM restore_control')).generation;
  async function call(path,body,{role='manager',working=true,origin='https://restore.test'}={}){
    const headers={'Cf-Access-Jwt-Assertion':token(role),'Content-Type':'application/json','Origin':origin,'X-Wallet-Action':'1'};
    if(working)headers['X-Wallet-Mode']='assistant';
    const payload=body===undefined?undefined:JSON.stringify({request_id:crypto.randomUUID(),database_generation:await generation(),...body});
    const response=await worker.fetch(new Request('https://restore.test'+path,{method:body===undefined?'GET':'POST',headers,body:payload}),env);
    return {code:response.status,data:await response.json()};
  }
  async function seed(){
    const add=async(path,body)=>{const r=await call(path,body);assert.ok(r.code<300,JSON.stringify(r));return r.data;};
    const p=await add('/api/entities',{kind:'property',property_type:'house',name:'منزل تجريبي',notes:"حفظ حرفي'); DROP TABLE audit; --"});
    const u=await add('/api/entities',{kind:'unit',name:'الوحدة',parent_id:p.id});
    const a=await add('/api/agreements',{entity_id:u.id,kind:'rent',title:'إيجار',start_date:'2001-01-01',end_date:'2001-12-31',first_due_date:'2001-01-01',count:12,frequency:1,total:'1200'});
    await add('/api/agreements/'+a.id+'/payments',{slot:0,amount:'100',paid_at:'2001-01-01',expected_version:0});
    await add('/api/agreements/'+a.id+'/vacate',{vacated_on:'2001-02-01',confirm_vacancy:true,expected_version:1});
    await add('/api/expenses',{entity_id:p.id,title:'صيانة',amount:'25',paid_at:'2001-01-01'});
    await add('/api/tasks',{title:'متابعة',due_date:'2001-01-01'});
    return {unit:u.id,agreement:a.id,backup:(await call('/api/backup')).data};
  }
  const rows=async()=>Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async table=>[table,sorted(await pg.rows(`SELECT * FROM ${table}`))])));
  const state=async()=>canonicalJSON({rows:await rows(),control:await pg.one('SELECT * FROM restore_control')});
  return {...pg,call,seed,generation,rows,state};
}
async function proposal(f,backup){
  const r=await f.call('/api/backup/preview',{backup});assert.equal(r.code,200,JSON.stringify(r));assert.equal(r.data.ok,true,JSON.stringify(r));
  return {backup,checkpoint:r.data.checkpoint,confirmation:'استعادة',request_id:crypto.randomUUID(),database_generation:await f.generation()};
}

test('PostgreSQL restore permissions, origin, confirmation and read-only preview',async()=>{
  const f=await fixture();try{
    const {backup}=await f.seed(),before=await f.state();
    for(const path of ['/api/backup/preview','/api/backup/restore'])assert.equal((await f.call(path,{backup},{role:'assistant'})).code,403);
    assert.equal((await f.call('/api/backup/recovery',undefined,{role:'assistant'})).code,403);
    assert.equal((await f.call('/api/backup/preview',{backup},{origin:'https://evil.test'})).code,400);
    const body=await proposal(f,backup);
    assert.equal((await f.call('/api/backup/restore',body,{working:false})).code,403);
    assert.equal((await f.call('/api/backup/restore',{...body,confirmation:''})).code,400);
    assert.equal((await f.call('/api/backup/restore',{...body,checkpoint:{...body.checkpoint,digest:'wrong'}})).code,409);
    assert.equal((await f.call('/api/backup/restore',{...body,checkpoint:{...body.checkpoint,checked_at:'2001-01-01'}})).code,409);
    assert.equal(await f.state(),before);
  }finally{await f.close();}
});
test('PostgreSQL restore rejects tampering, unknown columns, unsafe integers, missing references and NUL without loss',async()=>{
  const f=await fixture();try{
    const {backup}=await f.seed(),before=await f.state();
    const variants=[{...backup,exported_at:'2001-01-01'},{...backup,entities:undefined}];
    for(const edit of [d=>{delete d.entities[0].name;},d=>{d.entities[0].injected_sql='DROP TABLE audit';},d=>{d.payments[0].amount_cents='10000';},
      d=>{d.payments[0].amount_cents=Number.MAX_SAFE_INTEGER+1;},d=>{d.payments[0].agreement_id='missing';},d=>{d.entities[0].notes='before\u0000after';},
      d=>{d.agreements[0].vacated_on='9999-12-31';},d=>{Object.assign(d.agreements[0],{vacated_at:null,vacated_by:null,vacated_on:null,vacate_note:'invalid'});}]){
      const copy=structuredClone(backup);edit(copy);variants.push(await sealBackup(copy));
    }
    for(const candidate of variants){const r=await f.call('/api/backup/preview',{backup:candidate});assert.equal(r.code,200);assert.equal(r.data.ok,false);}
    assert.equal(await f.state(),before);
  }finally{await f.close();}
});
test('PostgreSQL restore keeps financial rows, recovery, append-only audit, generation and identical retry',async()=>{
  const f=await fixture();try{
    const {backup,agreement}=await f.seed();
    await f.call('/api/entities',{kind:'car',name:'بعد النسخة'});
    const before=await f.rows(),body=await proposal(f,backup),r=await f.call('/api/backup/restore',body);
    assert.equal(r.code,200,JSON.stringify(r));const rows=await f.rows();
    for(const table of BACKUP_TABLES){const restored=table==='audit'?rows[table].filter(row=>row.target_id!==r.data.generation):rows[table];assert.equal(canonicalJSON(sorted(restored)),canonicalJSON(sorted(backup[table])),table);}
    const a=rows.agreements.find(row=>row.id===agreement),p=project(a,rows.payments);
    assert.equal(p.paid_total_cents,10000);assert.equal(p.remaining_cents,110000);assert.ok(a.vacated_at);
    await assert.rejects(f.db.query('DELETE FROM audit'),/immutable/);
    const recovery=(await f.call('/api/backup/recovery')).data;
    for(const table of BACKUP_TABLES)assert.equal(canonicalJSON(sorted(recovery[table])),canonicalJSON(before[table]),table);
    assert.equal((await f.call('/api/entities',{kind:'car',name:'نافذة قديمة',database_generation:body.database_generation})).code,409);
    assert.equal((await f.call('/api/entities',{kind:'car',name:'إضافة جديدة'})).code,201);
    const state=await f.state();assert.equal((await f.call('/api/backup/restore',body)).data.idempotent,true);assert.equal(await f.state(),state);
    assert.equal(Object.hasOwn(await restoreControl(f.db),'recovery_json'),false);
  }finally{await f.close();}
});
test('Concurrent change invalidates preview; two simultaneous restores perform only one replacement',async()=>{
  const f=await fixture();try{
    const {backup}=await f.seed(),old=await proposal(f,backup);
    await f.call('/api/tasks',{title:'أثناء المراجعة'});
    assert.equal((await f.call('/api/backup/restore',old)).code,409);
    const fresh=await proposal(f,backup);
    const results=await f.race(()=>[f.call('/api/backup/restore',fresh),f.call('/api/backup/restore',fresh)]);
    assert.deepEqual(results.map(r=>r.code),[200,200]);assert.equal(results.filter(r=>r.data.idempotent).length,1);
    assert.equal((await f.one("SELECT count(*) n FROM audit WHERE target_type='backup'")).n,1);
  }finally{await f.close();}
});
test('Database failure midway through restore rolls back rows, recovery and generation atomically',async()=>{
  const f=await fixture();try{
    const {backup}=await f.seed(),body=await proposal(f,backup),before=await f.state();
    await f.db.query("ALTER TABLE tasks ADD CONSTRAINT force_restore_failure CHECK(title <> 'متابعة') NOT VALID");
    const r=await f.call('/api/backup/restore',body);assert.ok(r.code>=400);
    assert.equal(await f.state(),before);await assert.rejects(f.db.query('DELETE FROM audit'),/immutable/);
    await f.db.query('ALTER TABLE tasks DROP CONSTRAINT force_restore_failure');
    assert.equal((await f.call('/api/backup/restore',body)).code,200);
  }finally{await f.close();}
});
test('D1 schema 6,7,8 exports import into PostgreSQL without inventing financial data',async()=>{
  const f=await fixture();try{
    const {backup}=await f.seed();
    for(const version of [6,7,8]){
      const source=structuredClone(backup);source.schema_version=version;
      for(const a of source.agreements)for(const key of ['rental_mode','booking_cancelled_at','booking_cancelled_by','booking_cancel_note'])delete a[key];
      if(version===6)for(const e of source.entities)delete e.property_type;
      const body=await proposal(f,await sealBackup(source));assert.equal((await f.call('/api/backup/restore',body)).code,200);
      assert.equal((await f.one('SELECT count(*) n FROM entities')).n,2);
      assert.equal((await f.one('SELECT sum(amount_cents)::bigint n FROM payments')).n,10000);
    }
  }finally{await f.close();}
});
test('JSON larger than old 1 MB cap round-trips through the real PostgreSQL restore API',async()=>{
  const f=await fixture();try{
    const {backup}=await f.seed(),template=backup.entities.find(e=>e.kind==='property');
    for(let i=0;i<450;i++)backup.entities.push({...template,id:crypto.randomUUID(),name:'أصل '+i,notes:'ع'.repeat(1200)});
    const large=await sealBackup(backup);assert.ok(Buffer.byteLength(JSON.stringify(large))>1_000_000);
    const body=await proposal(f,large),r=await f.call('/api/backup/restore',body);assert.equal(r.code,200,JSON.stringify(r));
    assert.equal((await f.one('SELECT count(*) n FROM entities')).n,452);
    const exported=(await f.call('/api/backup')).data;
    assert.equal(canonicalJSON(sorted(exported.entities)),canonicalJSON(sorted(large.entities)));
  }finally{await f.close();}
});
test('Offline JSON import exceeds browser cap, refuses occupied target and leaves all source data intact',async()=>{
  const source=await fixture(),target=await fixture();try{
    const {backup}=await source.seed(),template=backup.entities.find(e=>e.kind==='property');
    for(let i=0;i<4000;i++)backup.entities.push({...template,id:crypto.randomUUID(),name:'أصل '+i,notes:'ع'.repeat(1200)});
    const large=await sealBackup(backup);assert.ok(Buffer.byteLength(JSON.stringify(large))>10_000_000);
    assert.equal((await source.call('/api/backup/preview',{backup:large})).code,413);
    const before=await source.state();assert.equal((await importIntoEmptyDatabase(target.db,large)).ok,true);
    assert.equal((await target.one('SELECT count(*) n FROM entities')).n,4002);
    await assert.rejects(importIntoEmptyDatabase(target.db,large),/فارغة/);
    assert.equal(await source.state(),before);
  }finally{await source.close();await target.close();}
});
