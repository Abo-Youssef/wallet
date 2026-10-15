import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createSign} from 'node:crypto';
import worker from '../src/worker.mjs';
import {inspectBackup} from '../src/integrity.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});jwk.kid='localtest';jwk.alg='RS256';jwk.use='sig';
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>String(url).includes('/cdn-cgi/access/certs')?new Response(JSON.stringify({keys:[jwk]}),{status:200}):originalFetch(url);
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON;');
for(const file of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())
 sqlite.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
function dbQuery(stmts){sqlite.exec('BEGIN');const out=[];try{
 for(const q of stmts){const stmt=sqlite.prepare(q.sql);const isRead=/^\s*SELECT\b/i.test(q.sql);
  if(isRead)out.push((()=>{const rows=stmt.all(...q.params);return {rows,results:rows,meta:{}}})());
  else {const result=stmt.run(...q.params);out.push({rows:[],meta:{changes:result.changes}})}
 }
 sqlite.exec('COMMIT');return out;
}catch(e){sqlite.exec('ROLLBACK');throw e}}
class MockStatement {
 constructor(sql){this.sql=sql;this.params=[]}
 bind(...params){this.params=params;return this}
 async first(){return dbQuery([{sql:this.sql,params:this.params}])[0].rows[0]??null}
 async all(){return {results:dbQuery([{sql:this.sql,params:this.params}])[0].rows}}
 async run(){return dbQuery([{sql:this.sql,params:this.params}])[0]}
}
let beforeBatch=null;
const db={prepare:sql=>new MockStatement(sql),batch:async stmts=>{if(beforeBatch)await beforeBatch(stmts);return dbQuery(stmts.map(x=>({sql:x.sql,params:x.params})))}};
const env={DB:db,ACCESS_TEAM_DOMAIN:'localtest.cloudflareaccess.com',ACCESS_AUD:'wallet-aud',MANAGER_EMAIL:'manager@example.com',ASSISTANT_EMAIL:'assistant@example.com'};
function token(role){const time=Math.floor(Date.now()/1000),payload={iss:'https://localtest.cloudflareaccess.com',aud:['wallet-aud'],email:`${role}@example.com`,exp:time+3600,nbf:time-1};
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const x=b64({alg:'RS256',kid:'localtest',typ:'JWT'})+'.'+b64(payload);const sig=createSign('RSA-SHA256').update(x).sign(privateKey).toString('base64url');return x+'.'+sig;}
const sentVersions=new Map();
async function call(role,method,url,body,{automatic=true}={}){
 if(method!=='GET'&&automatic){
  body={...body,request_id:body?.request_id??crypto.randomUUID()};
  const path=url.split('?')[0],parts=path.split('/');let row;
  if(parts[2]==='agreements'&&parts[3])row=sqlite.prepare('SELECT version FROM agreements WHERE id=?').get(parts[3]);
  else if(parts[2]==='payments')row=sqlite.prepare('SELECT a.version FROM agreements a JOIN payments p ON p.agreement_id=a.id WHERE p.id=?').get(parts[3]);
  else if(['entities','tasks','expenses'].includes(parts[2])&&parts[3])row=sqlite.prepare(`SELECT version FROM ${parts[2]} WHERE id=?`).get(parts[3]);
  if(row&&body.expected_version===undefined){if(!sentVersions.has(body.request_id))sentVersions.set(body.request_id,row.version);body.expected_version=sentVersions.get(body.request_id)}
 }
 const headers={'Cf-Access-Jwt-Assertion':token(role)};
 if(method!=='GET'){headers['origin']='https://wallet.test';headers['Content-Type']='application/json';headers['X-Mahfazati-Action']='1'}
 const request=new Request('https://wallet.test'+url,{method,headers,body:method==='GET'?undefined:JSON.stringify(body===undefined?{}:body)});
 const res=await worker.fetch(request,env),text=await res.text();return {code:res.status,data:JSON.parse(text)};
}
test('End-to-end API, actual roles, schedule, ledger and audit',async()=>{
 let r=await call('assistant','POST','/api/entities',{kind:'property',name:'عمارة النخيل',electricity_meter:'12345',reference_value_cents:'900000'});
 assert.equal(r.code,201,JSON.stringify(r));const property=r.data.id;
 r=await call('manager','POST','/api/entities',{kind:'car',name:'بلا صلاحية'});assert.notEqual(r.code,201);
 r=await call('assistant','POST','/api/entities',{kind:'unit',name:'شقة 1',parent_id:property,status:'available'});
 assert.equal(r.code,201,JSON.stringify(r));const unit=r.data.id;
 r=await call('assistant','POST','/api/entities',{kind:'car',name:'كامري',insurance_expiry:'2026-10-16',odometer_km:1000,maintenance_due_km:1500});
 assert.equal(r.code,201,JSON.stringify(r));const car=r.data.id;
 const rent={kind:'rent',entity_id:unit,title:'إيجار شقة 1',contract_number:'123',counterparty:'محمد',start_date:'2026-10-01',end_date:'2026-10-31',first_due_date:'2026-10-15',total:'3000',opening:'0',count:1,frequency:1};
 r=await call('assistant','POST','/api/agreements',rent);assert.equal(r.code,201,JSON.stringify(r));const agreement=r.data.id;
 const overlapping=await call('assistant','POST','/api/agreements',rent);assert.equal(overlapping.code,400);
 r=await call('assistant','GET','/api/bootstrap?month=2026-10');
 assert.equal(r.code,200,JSON.stringify(r));assert.equal(r.data.summary.due_in,300000);
 assert.equal(r.data.entities.find(x=>x.id===property).electricity_meter,'12345');
 assert.equal(r.data.summary.cash_out,0);
 const reqId='cbde3b02-e3b0-4510-9bf8-f68cac33ce17';
 r=await call('assistant','POST',`/api/agreements/${agreement}/payments`,{amount:'3000',paid_at:'2026-10-12',slot:0,request_id:reqId});
 assert.equal(r.code,201,JSON.stringify(r));const paymentId=r.data.id;
 const dup=await call('assistant','POST',`/api/agreements/${agreement}/payments`,{amount:'3000',paid_at:'2026-10-12',slot:0,request_id:reqId});
 assert.equal(dup.data.idempotent,true);
 r=await call('manager','GET','/api/bootstrap?month=2026-10');
 assert.equal(r.data.summary.cash_in,300000);assert.equal(r.data.dues.filter(x=>x.agreement_id===agreement).length,0,'completed due should disappear from alerts');
 const edited=await call('assistant','PATCH',`/api/payments/${paymentId}`,{amount:'2000',paid_at:'2026-10-12',slot:0});
 assert.equal(edited.code,200,JSON.stringify(edited));
 r=await call('assistant','GET','/api/bootstrap?month=2026-10');
 assert.equal(r.data.dues.find(x=>x.agreement_id===agreement).amount_cents,100000);
 assert.equal(r.data.summary.cash_in,200000);
 const voided=await call('assistant','DELETE',`/api/payments/${paymentId}`,{});
 assert.equal(voided.code,200,JSON.stringify(voided));
 r=await call('manager','GET','/api/bootstrap?month=2026-10');
 assert.equal(r.data.summary.cash_in,0);assert.equal(r.data.dues.find(x=>x.agreement_id===agreement).amount_cents,300000);
 const task=await call('manager','POST','/api/tasks',{title:'متابعة عقد',due_date:'2026-10-20'});
 assert.equal(task.code,201,JSON.stringify(task));
 const completed=await call('assistant','PATCH','/api/tasks/'+task.data.id,{state:'done'});
 assert.equal(completed.code,200,JSON.stringify(completed));
 const exp=await call('assistant','POST','/api/expenses',{title:'سفر',amount:'2500',paid_at:'2026-10-13'});
 assert.equal(exp.code,201,JSON.stringify(exp));
 r=await call('manager','GET','/api/bootstrap?month=2026-10');assert.equal(r.data.summary.cash_out,250000);
 const history=await call('manager','GET','/api/history');assert.ok(history.data.entries.some(x=>x.action==='حذف حركة'));
 const hide=await call('manager','POST',`/api/history/${history.data.entries[0].id}/hide`,{});assert.equal(hide.code,200,JSON.stringify(hide));
 const cannotHide=await call('assistant','POST',`/api/history/${history.data.entries[1].id}/hide`,{});assert.notEqual(cannotHide.code,200);
 const blocked=await call('assistant','DELETE','/api/entities/'+unit,{});assert.equal(blocked.code,400,'active lease guards deletion');
 r=await call('manager','GET','/api/backup');assert.equal(r.code,200);assert.ok(r.data.audit.length>=6);
});

test('History API filters the entire database, preserves permissions and paginates past 300',async()=>{
 const seed=sqlite.prepare('INSERT INTO audit(id,actor,action,target_type,target_id,created_at) VALUES (?,?,?,?,?,?)');
 const ids=[];
 for(let i=0;i<325;i++){
  const id=`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;ids.push(id);
  seed.run(id,'assistant@example.com','إضافة','task',null,'2001-05-01T12:00:00.000Z');
 }
 const boundaryTimes=['2001-04-30T20:59:59.999Z','2001-04-30T21:00:00.000Z','2001-05-01T20:59:59.999Z','2001-05-01T21:00:00.000Z'];
 const boundaryIds=boundaryTimes.map((date,i)=>{const id=`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`;seed.run(id,'assistant@example.com','إضافة','task',null,date);return id});
 const hidden=await call('manager','POST',`/api/history/${ids[5]}/hide`,{});assert.equal(hidden.code,200);
 const denied=await call('assistant','POST',`/api/history/${ids[6]}/hide`,{});assert.notEqual(denied.code,200);
 for(const sort of ['oldest','newest']){
  const seen=[];let cursor;
  do{
   const params=new URLSearchParams({from:'2001-05-01',to:'2001-05-01',sort,limit:'50',...(cursor?{cursor}:{})});
   const r=await call('assistant','GET','/api/history?'+params);assert.equal(r.code,200,JSON.stringify(r));
   assert.ok(r.data.entries.length<=50);seen.push(...r.data.entries);cursor=r.data.next_cursor;
  }while(cursor);
  assert.equal(seen.length,326);assert.equal(new Set(seen.map(x=>x.id)).size,326);
  assert.ok(!seen.some(x=>x.id===ids[5]));
  assert.ok(seen.some(x=>x.id===boundaryIds[1]));assert.ok(seen.some(x=>x.id===boundaryIds[2]));
  assert.ok(!seen.some(x=>x.id===boundaryIds[0]||x.id===boundaryIds[3]));
  const expected=[...seen].sort((a,b)=>sort==='oldest'?a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id):b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  assert.deepEqual(seen.map(x=>x.id),expected.map(x=>x.id));
 }
 for(const query of ['from=2026-02-30','from=2026-10-20&to=2026-10-01','sort=bad','limit=1000','cursor=invalid'])assert.equal((await call('manager','GET','/api/history?'+query)).code,400);
 const empty=await call('manager','GET','/api/history?from=1990-01-01&to=1990-01-02');
 assert.deepEqual(empty.data.entries,[]);assert.equal(empty.data.next_cursor,null);
 const backup=await call('manager','GET','/api/backup');assert.ok(backup.data.audit.some(x=>x.id===ids[5]));
 assert.throws(()=>sqlite.prepare('UPDATE audit SET action=? WHERE id=?').run('changed',ids[0]),/immutable/);
 assert.throws(()=>sqlite.prepare('DELETE FROM audit WHERE id=?').run(ids[0]),/immutable/);
});

test('Concurrent payments cannot spend the same outstanding balance twice',{timeout:3000},async()=>{
 const a=await call('assistant','POST','/api/agreements',{kind:'other',title:'اختبار تزامن',total:'100',opening:'0',count:1,frequency:1,first_due_date:'2026-10-01'});
 assert.equal(a.code,201);
 const write=i=>call('assistant','POST',`/api/agreements/${a.data.id}/payments`,{amount:'60',paid_at:'2026-10-15',slot:0,request_id:`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`});
 let arrived=0,release;const barrier=new Promise(resolve=>{release=resolve});
 // Both requests finish reading and validating the same balance before either commits.
 beforeBatch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('INSERT INTO payments'))){if(++arrived===2)release();await barrier}};
 let results;try{results=await Promise.all([write(1),write(2)])}finally{beforeBatch=null}
 assert.deepEqual(results.map(r=>r.code).sort(),[201,409],JSON.stringify(results));
 const row=sqlite.prepare('SELECT SUM(amount_cents) AS total,COUNT(*) AS n FROM payments WHERE agreement_id=?').get(a.data.id);
 assert.equal(row.total,6000);assert.equal(row.n,1);
 const bootstrap=await call('manager','GET','/api/bootstrap');assert.equal(bootstrap.code,200,JSON.stringify(bootstrap));
 assert.equal(bootstrap.data.dues.find(x=>x.agreement_id===a.data.id).amount_cents,4000);
});

test('Retry identity cannot silently accept a different payment payload',async()=>{
 const a=await call('assistant','POST','/api/agreements',{kind:'other',title:'اختبار إعادة إرسال',total:'100',opening:'0',count:1,frequency:1,first_due_date:'2026-10-01'});
 const data={amount:'20',paid_at:'2026-10-15',slot:0,request_id:'40000000-0000-4000-8000-000000000001'};
 const endpoint=`/api/agreements/${a.data.id}/payments`;
 const first=await call('assistant','POST',endpoint,data);assert.equal(first.code,201);
 const retry=await call('assistant','POST',endpoint,data);assert.equal(retry.data.id,first.data.id);assert.equal(retry.data.idempotent,true);
 const different=await call('assistant','POST',endpoint,{...data,amount:'30'});assert.equal(different.code,409);
 const row=sqlite.prepare('SELECT COUNT(*) AS n FROM payments WHERE agreement_id=?').get(a.data.id);assert.equal(row.n,1);
});

test('Paid agreements reject silent schedule changes but retain descriptive editing',async()=>{
 const a=await call('assistant','POST','/api/agreements',{kind:'other',title:'اتفاق ثابت',total:'100',opening:'0',count:1,frequency:1,first_due_date:'2026-10-01'});
 const pay=await call('assistant','POST',`/api/agreements/${a.data.id}/payments`,{amount:'20',paid_at:'2026-10-15',slot:0,request_id:'50000000-0000-4000-8000-000000000001'});assert.equal(pay.code,201);
 const rejected=await call('assistant','PATCH',`/api/agreements/${a.data.id}`,{title:'عنوان مصحح',total:'200'});assert.equal(rejected.code,400);
 let stored=sqlite.prepare('SELECT * FROM agreements WHERE id=?').get(a.data.id);assert.equal(stored.total_cents,10000);assert.equal(stored.title,'اتفاق ثابت');
 const allowed=await call('assistant','PATCH',`/api/agreements/${a.data.id}`,{title:'عنوان مصحح'});assert.equal(allowed.code,200);
 stored=sqlite.prepare('SELECT * FROM agreements WHERE id=?').get(a.data.id);assert.equal(stored.title,'عنوان مصحح');
});

test('Workers cannot receive direct financial expenses through the API',async()=>{
 const worker=await call('assistant','POST','/api/entities',{kind:'worker',name:'عامل اختبار'});assert.equal(worker.code,201);
 const rejected=await call('assistant','POST','/api/expenses',{title:'لا يسمح',amount:'20',paid_at:'2026-10-15',entity_id:worker.data.id});assert.equal(rejected.code,400);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM expenses WHERE entity_id=?').get(worker.data.id).n,0);
});

test('History requires authentication and rejects an unlisted account',async()=>{
 const response=await worker.fetch(new Request('https://wallet.test/api/history'),env);assert.equal(response.status,401);
 const denied=await call('outsider','GET','/api/history');assert.equal(denied.code,403);
});

test('Expense retries are atomic, including simultaneous submissions',{timeout:3000},async()=>{
 const request_id=crypto.randomUUID(),payload={request_id,title:'منصرف موحد',amount:'20',paid_at:'2026-10-15'};
 let arrived=0,release;const barrier=new Promise(resolve=>{release=resolve});
 beforeBatch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('INSERT INTO expenses'))){if(++arrived===2)release();await barrier}};
 let results;try{results=await Promise.all([call('assistant','POST','/api/expenses',payload),call('assistant','POST','/api/expenses',payload)])}finally{beforeBatch=null}
 assert.deepEqual(results.map(r=>r.code),[201,201],JSON.stringify(results));assert.equal(results[0].data.id,results[1].data.id);
 const id=results[0].data.id;
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM expenses WHERE id=?').get(id).n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(id).n,1);
 assert.equal((await call('assistant','POST','/api/expenses',{...payload,amount:'21'})).code,409);
 assert.equal((await call('manager','POST','/api/tasks',{...payload,title:'scope mismatch'})).code,409);
});

test('Concurrent overlapping leases cannot both commit',{timeout:3000},async()=>{
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'وحدة التزامن'});
 const payload={kind:'rent',entity_id:unit.data.id,title:'اختبار التداخل',start_date:'2027-01-01',end_date:'2027-01-31',first_due_date:'2027-01-01',total:'100',opening:'0',count:1,frequency:1};
 let arrived=0,release;const barrier=new Promise(resolve=>{release=resolve});
 beforeBatch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('INSERT INTO agreements'))){if(++arrived===2)release();await barrier}};
 let results;try{results=await Promise.all([call('assistant','POST','/api/agreements',payload),call('assistant','POST','/api/agreements',payload)])}finally{beforeBatch=null}
 assert.deepEqual(results.map(r=>r.code).sort(),[201,409],JSON.stringify(results));
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM agreements WHERE entity_id=?').get(unit.data.id).n,1);
 const adjacent=await call('assistant','POST','/api/agreements',{...payload,start_date:'2027-02-01',end_date:'2027-02-28',first_due_date:'2027-02-01'});assert.equal(adjacent.code,201);
 const overlapEdit=await call('assistant','PATCH','/api/agreements/'+adjacent.data.id,{start_date:'2027-01-31'});assert.equal(overlapEdit.code,400);
});

test('Stale edits and deletes fail without overwriting data or adding audit entries',async()=>{
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'اسم قبل التعديل'}),url='/api/entities/'+e.data.id;
 const first=await call('assistant','PATCH',url,{name:'اسم حديث',expected_version:0});assert.equal(first.code,200);
 const count=sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(e.data.id).n;
 assert.equal((await call('assistant','PATCH',url,{name:'اسم قديم',expected_version:0})).code,409);
 assert.equal((await call('assistant','DELETE',url,{expected_version:0})).code,409);
 const row=sqlite.prepare('SELECT * FROM entities WHERE id=?').get(e.data.id);assert.equal(row.name,'اسم حديث');assert.equal(row.archived,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(e.data.id).n,count);
 const task=await call('manager','POST','/api/tasks',{title:'نسخ المهمة'});
 assert.equal((await call('assistant','PATCH','/api/tasks/'+task.data.id,{state:'done',expected_version:0})).code,200);
 assert.equal((await call('assistant','PATCH','/api/tasks/'+task.data.id,{state:'open',expected_version:0})).code,409);
});

test('Concurrent entity edits use a database compare-and-swap',{timeout:3000},async()=>{
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'نسخة مشتركة'});
 let arrived=0,release;const barrier=new Promise(resolve=>{release=resolve});
 beforeBatch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('UPDATE entities SET name='))){if(++arrived===2)release();await barrier}};
 let results;try{results=await Promise.all(['الأول','الثاني'].map(name=>call('assistant','PATCH','/api/entities/'+e.data.id,{name,expected_version:0})))}finally{beforeBatch=null}
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);
 assert.equal(sqlite.prepare('SELECT version FROM entities WHERE id=?').get(e.data.id).version,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(e.data.id).n,2);
});

test('Entity archive cannot race a new agreement into an archived asset',{timeout:3000},async()=>{
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'أصل مرتبط بالتزامن'});
 let arrived=0,release;const barrier=new Promise(resolve=>{release=resolve});
 beforeBatch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('UPDATE entities SET archived=')||s.sql.startsWith('INSERT INTO agreements'))){if(++arrived===2)release();await barrier}};
 let results;try{results=await Promise.all([
  call('assistant','DELETE','/api/entities/'+e.data.id,{}),
  call('assistant','POST','/api/agreements',{kind:'purchase',entity_id:e.data.id,title:'شراء',total:'100',first_due_date:'2026-10-01',count:1,frequency:1})
 ])}finally{beforeBatch=null}
 assert.equal(results.filter(x=>x.code===409).length,1,JSON.stringify(results));
 const asset=sqlite.prepare('SELECT * FROM entities WHERE id=?').get(e.data.id),links=sqlite.prepare("SELECT COUNT(*) n FROM agreements WHERE entity_id=? AND status='active'").get(e.data.id).n;
 assert.ok(asset.archived===0||links===0);
});

test('Create and update retries preserve their original receipt after later changes',async()=>{
 const payload={kind:'car',name:'إنشاء واحد',request_id:crypto.randomUUID()};
 const created=await call('assistant','POST','/api/entities',payload),url='/api/entities/'+created.data.id;
 assert.equal(created.code,201);
 const edit={name:'تعديل واحد',expected_version:0,request_id:crypto.randomUUID()};
 assert.equal((await call('assistant','PATCH',url,edit)).code,200);
 assert.equal((await call('assistant','POST','/api/entities',payload)).data.idempotent,true);
 assert.equal((await call('assistant','PATCH',url,edit)).data.idempotent,true);
 assert.equal(sqlite.prepare('SELECT version FROM entities WHERE id=?').get(created.data.id).version,1);
 assert.equal((await call('assistant','PATCH',url,{...edit,name:'تغيير الطلب'})).code,409);
});

test('Malformed bodies, missing request identities and missing snapshot versions are rejected',async()=>{
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'التحقق'});
 assert.equal((await call('assistant','POST','/api/expenses',{title:'منصرف',amount:'1',paid_at:'2026-10-01'},{automatic:false})).code,400);
 assert.equal((await call('assistant','PATCH','/api/entities/'+e.data.id,{name:'تعديل',request_id:crypto.randomUUID()},{automatic:false})).code,400);
 for(const body of [null,[],true,'text'])assert.equal((await call('assistant','POST','/api/tasks',body,{automatic:false})).code,400);
 assert.equal((await call('assistant','POST','/api/entities',{kind:'car',name:{nested:'object'}})).code,400);
 assert.equal((await call('assistant','POST','/api/tasks',{title:'x'.repeat(256)})).code,400);
 assert.equal((await call('assistant','POST','/api/tasks',{title:'x'.repeat(51_000)})).code,413);
 assert.equal((await call('assistant','POST','/api/agreements',{kind:'other',title:'نطاق تاريخ',total:'100',first_due_date:'9999-12-01',count:2,frequency:12})).code,400);
});

test('Permissions, same-origin writes and internal errors fail safely',async()=>{
 assert.equal((await call('manager','POST','/api/expenses',{title:'مرفوض',amount:'1',paid_at:'2026-10-15'})).code,403);
 assert.equal((await call('assistant','GET','/api/backup')).code,403);
 for(const headers of [
  {'origin':'https://evil.test','Content-Type':'application/json','X-Mahfazati-Action':'1'},
  {'origin':'https://wallet.test','Content-Type':'application/json'},
  {'origin':'https://wallet.test','Content-Type':'text/plain','X-Mahfazati-Action':'1'}
 ]){
  const r=await worker.fetch(new Request('https://wallet.test/api/tasks',{method:'POST',headers:{...headers,'Cf-Access-Jwt-Assertion':token('assistant')},body:'{}'}),env);assert.equal(r.status,400);
 }
 const broken={...env,DB:{prepare(){throw Error('SQL PRIVATE DATABASE DETAILS')}}};
 const r=await worker.fetch(new Request('https://wallet.test/api/history',{headers:{'Cf-Access-Jwt-Assertion':token('manager')}}),broken);
 assert.equal(r.status,500);assert.ok(!(await r.text()).includes('PRIVATE'));
});

test('Audit visibility changes are idempotent and alert keys must be real',async()=>{
 const task=await call('manager','POST','/api/tasks',{title:'مهمة لتجربة السجل'});
 const row=sqlite.prepare('SELECT id FROM audit WHERE target_id=?').get(task.data.id);
 for(let i=0;i<2;i++)assert.equal((await call('manager','POST','/api/history/'+row.id+'/hide',{})).code,200);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE target_id=? AND action='إخفاء سجل'").get(row.id).n,1);
 assert.equal((await call('assistant','POST','/api/alerts/dismiss',{key:'invented:key'})).code,400);
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'تأمين متأخر',insurance_expiry:'2020-01-01'});
 const key='ins:'+e.data.id+':2020-01-01';
 for(let i=0;i<2;i++)assert.equal((await call('assistant','POST','/api/alerts/dismiss',{key})).code,200);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE target_id=? AND action='إتمام تنبيه'").get(key).n,1);
});

test('Snapshot exports include audit, voids, versions and retry receipts',async()=>{
 const r=await call('manager','GET','/api/backup');assert.equal(r.code,200);
 assert.deepEqual(inspectBackup(r.data).issues,[]);
 assert.equal(r.data.schema_version,4);assert.equal(r.data.format_version,2);
 assert.ok(r.data.mutation_requests.length>0);assert.ok(r.data.payments.some(p=>p.active===0));
 assert.ok(r.data.entities.every(e=>Number.isSafeInteger(e.version)));
 const boot=await call('assistant','GET','/api/bootstrap');assert.equal(boot.code,200);
 for(const p of boot.data.payments)assert.ok(boot.data.payment_contexts[p.id]?.expected_cents>=p.amount_cents||p.reschedule_method);
});

test('Payment cancellation rejects edits and preserves the original financial history',async()=>{
 const a=await call('assistant','POST','/api/agreements',{kind:'other',title:'إلغاء دون تغيير التاريخ',total:'200',count:2,frequency:1,first_due_date:'2026-10-01'});
 assert.equal(a.code,201);
 const p=await call('assistant','POST',`/api/agreements/${a.data.id}/payments`,{amount:'100',paid_at:'2026-10-15',slot:0,note:'الوصف الأصلي'});
 assert.equal(p.code,201);
 const url='/api/payments/'+p.data.id;
 const before={...sqlite.prepare('SELECT * FROM payments WHERE id=?').get(p.data.id)};
 const version=sqlite.prepare('SELECT version FROM agreements WHERE id=?').get(a.data.id).version;
 const auditCount=sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(p.data.id).n;
 for(const edit of [{slot:1},{amount:'1'},{paid_at:'2030-01-01'},{reschedule_method:'spread'},{note:'تغيير خفي'}]){
  const request_id=crypto.randomUUID();
  const rejected=await call('assistant','DELETE',url,{...edit,request_id});
  assert.equal(rejected.code,400,JSON.stringify(rejected));
  assert.deepEqual({...sqlite.prepare('SELECT * FROM payments WHERE id=?').get(p.data.id)},before);
  assert.equal(sqlite.prepare('SELECT version FROM agreements WHERE id=?').get(a.data.id).version,version);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(p.data.id).n,auditCount);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM mutation_requests WHERE request_id=?').get(request_id).n,0);
 }
 const request_id=crypto.randomUUID(),voided=await call('assistant','DELETE',url,{request_id});
 assert.equal(voided.code,200,JSON.stringify(voided));
 const after={...sqlite.prepare('SELECT * FROM payments WHERE id=?').get(p.data.id)};
 assert.equal(after.active,0);
 for(const key of Object.keys(before).filter(key=>!['active','observed_version','updated_at'].includes(key)))assert.equal(after[key],before[key],key);
 assert.equal(sqlite.prepare('SELECT version FROM agreements WHERE id=?').get(a.data.id).version,version+1);
 const retried=await call('assistant','DELETE',url,{request_id});
 assert.equal(retried.code,200);assert.equal(retried.data.idempotent,true);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(p.data.id).n,auditCount+1);
});

test('A committed receipt survives an expired session and authenticates the same retry safely',async()=>{
 const body={title:'إعادة المحاولة بعد تجديد الدخول',amount:'75',paid_at:'2026-10-15',request_id:crypto.randomUUID()};
 const committed=await call('assistant','POST','/api/expenses',body);
 assert.equal(committed.code,201);
 // The client may have lost this success response and retry after its JWT expires.
 const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const signingInput=b64({alg:'RS256',kid:'localtest'})+'.'+b64({iss:'https://localtest.cloudflareaccess.com',aud:['wallet-aud'],email:'assistant@example.com',exp:Math.floor(Date.now()/1000)-60});
 const expired=signingInput+'.'+createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
 const failed=await worker.fetch(new Request('https://wallet.test/api/expenses',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':expired,origin:'https://wallet.test','Content-Type':'application/json','X-Mahfazati-Action':'1'},body:JSON.stringify(body)}),env);
 assert.equal(failed.status,401);
 const retried=await call('assistant','POST','/api/expenses',body);
 assert.equal(retried.code,201);assert.equal(retried.data.id,committed.data.id);assert.equal(retried.data.idempotent,true);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM expenses WHERE title=?').get(body.title).n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE target_id=?').get(committed.data.id).n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM mutation_requests WHERE request_id=?').get(body.request_id).n,1);
});

async function paidSale(title){
 const asset=await call('assistant','POST','/api/entities',{kind:'car',name:title});assert.equal(asset.code,201);
 const agreement=await call('assistant','POST','/api/agreements',{kind:'sale',entity_id:asset.data.id,title,total:'100',first_due_date:'2002-01-01',count:1,frequency:1});assert.equal(agreement.code,201);
 const payment=await call('assistant','POST',`/api/agreements/${agreement.data.id}/payments`,{amount:'100',paid_at:'2002-01-15',slot:0});assert.equal(payment.code,201);
 return {asset:asset.data.id,agreement:agreement.data.id,payment:payment.data.id};
}

test('Explicit closure preserves historical cash and receipts, supports reopening and allows asset archive',async()=>{
 const ids=await paidSale('بيع مكتمل قابل للإغلاق'),base='/api/agreements/'+ids.agreement;
 const before=await call('manager','GET','/api/bootstrap?month=2002-01');
 const paymentBefore={...sqlite.prepare('SELECT * FROM payments WHERE id=?').get(ids.payment)};
 assert.equal((await call('manager','POST',base+'/close',{})).code,403);
 const closeBody={request_id:crypto.randomUUID()},closed=await call('assistant','POST',base+'/close',closeBody);
 assert.equal(closed.code,200,JSON.stringify(closed));assert.ok(closed.data.closed_at);assert.equal(closed.data.closed_by,'assistant@example.com');
 const closedRow=sqlite.prepare('SELECT * FROM agreements WHERE id=?').get(ids.agreement);
 assert.equal(closedRow.status,'active');assert.equal(closedRow.version,2);
 for(const [method,path,body] of [['PATCH',base,{title:'تعديل مغلق'}],['DELETE',base,{}],['POST',base+'/payments',{amount:'1',paid_at:'2002-01-15',slot:0}],['PATCH','/api/payments/'+ids.payment,{amount:'90'}],['DELETE','/api/payments/'+ids.payment,{}]]){
  const denied=await call('assistant',method,path,body);assert.equal(denied.code,400,JSON.stringify(denied));assert.match(denied.data.error,/مغلق/);
 }
 const after=await call('manager','GET','/api/bootstrap?month=2002-01');
 assert.deepEqual(after.data.summary,before.data.summary);assert.deepEqual(after.data.payment_contexts,before.data.payment_contexts);
 assert.deepEqual({...sqlite.prepare('SELECT * FROM payments WHERE id=?').get(ids.payment)},paymentBefore);
 const retried=await call('assistant','POST',base+'/close',closeBody);assert.equal(retried.data.idempotent,true);assert.equal(retried.data.closed_at,closed.data.closed_at);
 assert.equal((await call('manager','POST',base+'/reopen',{})).code,403);
 const reopenBody={request_id:crypto.randomUUID()},reopened=await call('assistant','POST',base+'/reopen',reopenBody);
 assert.equal(reopened.code,200);assert.equal(reopened.data.closed_at,null);assert.equal(reopened.data.closed_by,null);
 assert.equal((await call('assistant','POST',base+'/reopen',reopenBody)).data.idempotent,true);
 assert.equal((await call('assistant','POST',base+'/close',closeBody)).data.idempotent,true);
 assert.equal(sqlite.prepare('SELECT closed_at FROM agreements WHERE id=?').get(ids.agreement).closed_at,null,'replaying an old close receipt cannot close a reopened agreement');
 assert.equal((await call('assistant','POST',base+'/close',{})).code,200);
 assert.equal((await call('assistant','DELETE','/api/entities/'+ids.asset,{})).code,200);
 assert.equal((await call('assistant','POST',base+'/reopen',{})).code,400,'an archived asset cannot have an open agreement');
 const archived=await call('manager','GET','/api/bootstrap?month=2002-01');assert.deepEqual(archived.data.summary,before.data.summary);
 assert.ok(!archived.data.entities.some(e=>e.id===ids.asset));assert.ok(archived.data.payments.some(p=>p.id===ids.payment));
 const audit=sqlite.prepare('SELECT action FROM audit WHERE target_id=?').all(ids.agreement).map(r=>r.action);
 assert.equal(audit.filter(action=>action==='إغلاق اتفاق').length,2);assert.equal(audit.filter(action=>action==='إعادة فتح اتفاق').length,1);
 const backup=await call('manager','GET','/api/backup');assert.equal(backup.data.schema_version,4);assert.deepEqual(inspectBackup(backup.data).issues,[]);
});

test('Closure requires a zero balance and an expired rent period; reopening rechecks overlap',async()=>{
 const unpaid=await call('assistant','POST','/api/agreements',{kind:'other',title:'رصيد يمنع الإغلاق',total:'100',first_due_date:'2001-01-01'});
 assert.equal((await call('assistant','POST','/api/agreements/'+unpaid.data.id+'/close',{})).code,400);
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'إغلاق عقد الإيجار'});assert.equal(unit.code,201);
 const rent={kind:'rent',entity_id:unit.data.id,title:'إيجار منتهٍ ومسدد',total:'100',opening:'100',count:1,frequency:1,start_date:'2001-01-01',end_date:'2001-01-31',first_due_date:'2001-01-01'};
 const past=await call('assistant','POST','/api/agreements',rent);assert.equal(past.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+past.data.id+'/close',{})).code,200);
 const afterClose=await call('assistant','GET','/api/bootstrap');assert.ok(!afterClose.data.alerts.some(a=>a.key.startsWith('rent:'+past.data.id+':')));
 const replacement=await call('assistant','POST','/api/agreements',rent);assert.equal(replacement.code,201,'closed rents do not reserve the unit');
 assert.equal((await call('assistant','POST','/api/agreements/'+past.data.id+'/reopen',{})).code,400);
 assert.equal((await call('assistant','DELETE','/api/agreements/'+replacement.data.id,{})).code,200);
 assert.equal((await call('assistant','POST','/api/agreements/'+past.data.id+'/reopen',{})).code,200);
 const future=await call('assistant','POST','/api/agreements',{...rent,start_date:'9999-01-01',end_date:'9999-01-31',first_due_date:'9999-01-01'});assert.equal(future.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+future.data.id+'/close',{})).code,400);
 const today=afterClose.data.today;
 const endingToday=await call('assistant','POST','/api/agreements',{...rent,start_date:today,end_date:today,first_due_date:today});assert.equal(endingToday.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+endingToday.data.id+'/close',{})).code,400,'the final rental day still belongs to the open contract');
});

test('Closure and payment correction cannot race into a closed unpaid agreement',{timeout:3000},async()=>{
 const ids=await paidSale('سباق الإغلاق والتصحيح');
 const closeBody={request_id:crypto.randomUUID()},editBody={amount:'90',request_id:crypto.randomUUID()};
 const beforeAudit=sqlite.prepare('SELECT COUNT(*) n FROM audit').get().n;
 let arrived=0,release;const barrier=new Promise(resolve=>{release=resolve});
 beforeBatch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('UPDATE agreements SET closed_at=')||s.sql.startsWith('UPDATE payments SET slot_index='))){if(++arrived===2)release();await barrier}};
 let results;try{results=await Promise.all([call('assistant','POST','/api/agreements/'+ids.agreement+'/close',closeBody),call('assistant','PATCH','/api/payments/'+ids.payment,editBody)])}finally{beforeBatch=null}
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409],JSON.stringify(results));
 const a=sqlite.prepare('SELECT * FROM agreements WHERE id=?').get(ids.agreement),p=sqlite.prepare('SELECT * FROM payments WHERE id=?').get(ids.payment);
 assert.equal(a.version,2);assert.ok(a.closed_at?p.amount_cents===10000:p.amount_cents===9000);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM audit').get().n,beforeAudit+1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM mutation_requests WHERE request_id IN (?,?)').get(closeBody.request_id,editBody.request_id).n,1);
});

test('Reopening and archiving the same asset retain the database relationship guard',{timeout:3000},async()=>{
 const ids=await paidSale('سباق إعادة الفتح والأرشفة');
 assert.equal((await call('assistant','POST','/api/agreements/'+ids.agreement+'/close',{})).code,200);
 let arrived=0,release;const barrier=new Promise(resolve=>{release=resolve});
 beforeBatch=async stmts=>{if(stmts.some(s=>s.sql.startsWith('UPDATE agreements SET closed_at=')||s.sql.startsWith('UPDATE entities SET archived='))){if(++arrived===2)release();await barrier}};
 let results;try{results=await Promise.all([call('assistant','POST','/api/agreements/'+ids.agreement+'/reopen',{}),call('assistant','DELETE','/api/entities/'+ids.asset,{})])}finally{beforeBatch=null}
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409],JSON.stringify(results));
 const a=sqlite.prepare('SELECT closed_at FROM agreements WHERE id=?').get(ids.agreement),e=sqlite.prepare('SELECT archived FROM entities WHERE id=?').get(ids.asset);
 assert.ok(a.closed_at||e.archived===0);
});

test('Closure migration preserves existing rows and guards closed financial history in SQLite',()=>{
 const prior=new DatabaseSync(':memory:');
 try{
  prior.exec('PRAGMA foreign_keys=ON');
  const migrations=fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort();
  for(const file of migrations.filter(file=>file<'0004'))prior.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const time='2002-01-15T12:00:00.000Z';
  prior.prepare('INSERT INTO entities(id,kind,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('asset','car','سيارة سابقة','assistant@example.com',time,time);
  prior.prepare('INSERT INTO agreements(id,entity_id,kind,direction,title,total_cents,opening_cents,installment_count,frequency_months,first_due_date,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('agreement','asset','sale','in','بيع سابق',10000,0,1,1,'2002-01-01','assistant@example.com',time);
  prior.exec("UPDATE agreements SET version=1 WHERE id='agreement'");
  prior.prepare('INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('payment','request','agreement',0,10000,'2002-01-15',0,'assistant@example.com',time);
  prior.prepare('INSERT INTO audit(id,actor,action,target_type,target_id,created_at) VALUES (?,?,?,?,?,?)').run('audit','assistant@example.com','تسجيل حركة','payment','payment',time);
  const before=Object.fromEntries(['entities','agreements','payments','audit'].map(table=>[table,prior.prepare('SELECT * FROM '+table).all().map(row=>({...row}))]));
  prior.exec(fs.readFileSync(new URL('../migrations/0004_agreement_closure.sql',import.meta.url),'utf8'));
  for(const table of ['entities','payments','audit'])assert.deepEqual(prior.prepare('SELECT * FROM '+table).all().map(row=>({...row})),before[table]);
  const upgraded={...prior.prepare('SELECT * FROM agreements').get()};assert.equal(upgraded.closed_at,null);assert.equal(upgraded.closed_by,null);
  delete upgraded.closed_at;delete upgraded.closed_by;assert.deepEqual(upgraded,before.agreements[0]);
  assert.throws(()=>prior.exec("UPDATE agreements SET closed_at='2002-02-01T00:00:00.000Z' WHERE id='agreement'"),/invalid agreement closure/);
  prior.exec("UPDATE agreements SET closed_at='2002-02-01T00:00:00.000Z',closed_by='assistant@example.com',version=2 WHERE id='agreement'");
  assert.throws(()=>prior.exec("UPDATE payments SET active=0,observed_version=1 WHERE id='payment'"),/agreement closed/);
  assert.throws(()=>prior.exec("UPDATE agreements SET title='hidden edit' WHERE id='agreement'"),/agreement closed/);
  prior.exec("UPDATE entities SET archived=1 WHERE id='asset'");
  assert.throws(()=>prior.exec("UPDATE agreements SET closed_at=NULL,closed_by=NULL,version=3 WHERE id='agreement'"),/invalid agreement entity/);
  assert.throws(()=>prior.exec("DELETE FROM audit WHERE id='audit'"),/immutable/);
  assert.deepEqual({...prior.prepare('SELECT * FROM payments').get()},before.payments[0]);
 }finally{prior.close()}
});

test('Both roles retain minimal archived asset references for paid and opening-only closed agreements',async()=>{
 const paid=await paidSale('سيارة مؤرشفة بحركة تاريخية');
 const property=await call('assistant','POST','/api/entities',{kind:'property',name:'عقار مؤرشف بالتبعية'});assert.equal(property.code,201);
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'وحدة مسددة قبل التأسيس',parent_id:property.data.id,notes:'تفاصيل خاصة لا تحتاجها مراجع الأرشيف'});assert.equal(unit.code,201);
 const opening=await call('assistant','POST','/api/agreements',{kind:'sale',entity_id:unit.data.id,title:'بيع برصيد افتتاحي كامل',total:'200',opening:'200',first_due_date:'2002-01-01'});assert.equal(opening.code,201);
 const before=await call('manager','GET','/api/bootstrap?month=2002-01');
 for(const id of [paid.agreement,opening.data.id])assert.equal((await call('assistant','POST','/api/agreements/'+id+'/close',{})).code,200);
 for(const id of [paid.asset,unit.data.id,property.data.id])assert.equal((await call('assistant','DELETE','/api/entities/'+id,{})).code,200);
 for(const role of ['manager','assistant']){
  const result=await call(role,'GET','/api/bootstrap?month=2002-01');assert.equal(result.code,200);assert.equal(result.data.user.role,role);
  assert.deepEqual(result.data.summary,before.data.summary,'archiving does not change historical cash or dues');
  const archived=result.data.archived_entities;
  for(const [id,name,kind,parent_id] of [[paid.asset,'سيارة مؤرشفة بحركة تاريخية','car',null],[unit.data.id,'وحدة مسددة قبل التأسيس','unit',property.data.id],[property.data.id,'عقار مؤرشف بالتبعية','property',null]]){
   assert.deepEqual(archived.find(row=>row.id===id),{id,kind,name,parent_id});
   assert.ok(!result.data.entities.some(row=>row.id===id),'current asset lists remain separate');
  }
  for(const id of [paid.agreement,opening.data.id])assert.ok(result.data.agreements.find(a=>a.id===id)?.closed_at);
  assert.ok(result.data.payments.some(p=>p.id===paid.payment));
  assert.ok(!result.data.payments.some(p=>p.agreement_id===opening.data.id),'opening balances do not become new cash movements');
 }
 assert.equal((await call('outsider','GET','/api/bootstrap?month=2002-01')).code,403);
});
