import {test,after} from 'node:test';
import {createPostgresFixture} from './pg-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createSign} from 'node:crypto';
import worker from '../src/server/worker.mjs';
import {inspectBackup} from '../src/server/integrity.mjs';
import {parseMoney,project,addMonths} from '../src/shared/finance.mjs';
import {verifyBackup,canonicalJSON} from '../src/server/backup.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});jwk.kid='localtest';jwk.alg='RS256';jwk.use='sig';
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>String(url).includes('/cdn-cgi/access/certs')?new Response(JSON.stringify({keys:[jwk]}),{status:200}):originalFetch(url);
const fixture=await createPostgresFixture();
after(async()=>{globalThis.fetch=originalFetch;await fixture.close()});
const {one,rows,run}=fixture;
const env={DATABASE_URL:fixture.connectionString,ACCESS_TEAM_DOMAIN:'localtest.cloudflareaccess.com',ACCESS_AUD:'wallet-aud',MANAGER_EMAIL:'manager@example.com',ASSISTANT_EMAIL:'assistant@example.com'};
function token(role){const time=Math.floor(Date.now()/1000),payload={iss:'https://localtest.cloudflareaccess.com',aud:['wallet-aud'],email:`${role}@example.com`,exp:time+3600,nbf:time-1};
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const x=b64({alg:'RS256',kid:'localtest',typ:'JWT'})+'.'+b64(payload);const sig=createSign('RSA-SHA256').update(x).sign(privateKey).toString('base64url');return x+'.'+sig;}
const sentVersions=new Map();
const sentScheduleDates=new Map();
function assertOneConcurrentWrite(results){
 assert.equal(results.filter(result=>[200,201].includes(result.code)).length,1,JSON.stringify(results));
 // Validation occurs after the PostgreSQL row lock: the loser can see a
 // business-rule rejection (400) or a stale version (409), never success/500.
 assert.equal(results.filter(result=>[400,409].includes(result.code)).length,1,JSON.stringify(results));
}
async function call(role,method,url,body,{automatic=true,workMode=true,confirmSchedule=true}={}){
 if(method!=='GET'&&automatic){
  body={...body,request_id:body?.request_id??crypto.randomUUID(),database_generation:body?.database_generation??(await one('SELECT generation FROM restore_control WHERE id=1')).generation};
  const path=url.split('?')[0],parts=path.split('/');let row;
  if(parts[2]==='agreements'&&parts[3])row=(await one('SELECT version FROM agreements WHERE id=?',parts[3]));
  else if(parts[2]==='payments')row=(await one('SELECT a.version FROM agreements a JOIN payments p ON p.agreement_id=a.id WHERE p.id=?',parts[3]));
  else if(['entities','tasks','expenses'].includes(parts[2])&&parts[3])row=(await one(`SELECT version FROM ${parts[2]} WHERE id=?`,parts[3]));
  if(row&&body.expected_version===undefined){if(!sentVersions.has(body.request_id))sentVersions.set(body.request_id,row.version);body.expected_version=sentVersions.get(body.request_id)}
  // Existing lifecycle fixtures explicitly opt into the new confirmation flow.
  // Regression cases below disable this helper to exercise missing/invalid dates.
  if(confirmSchedule&&method!=='DELETE'&&body.schedule_end_date===undefined&&
    (parts[2]==='payments'||parts[2]==='agreements'&&parts[4]==='payments')){
    if(sentScheduleDates.has(body.request_id))body.schedule_end_date=sentScheduleDates.get(body.request_id);
    else try{
      const original=parts[2]==='payments'?(await one('SELECT * FROM payments WHERE id=?',parts[3])):null;
      const agreement=(await one('SELECT * FROM agreements WHERE id=?',original?.agreement_id??parts[3]));
      const payments=(await rows('SELECT * FROM payments WHERE agreement_id=? AND active=1 ORDER BY created_at,id',agreement.id));
      const candidate={...original,id:original?.id??'fixture-preview',active:1,amount_cents:body.amount===undefined?original?.amount_cents:parseMoney(body.amount),
        slot_index:body.slot??original?.slot_index,paid_at:body.paid_at??original?.paid_at,reschedule_method:body.reschedule_method??original?.reschedule_method??null,schedule_end_date:null,
        created_at:original?.created_at??new Date(Math.max(Date.now(),Date.parse(payments.at(-1)?.created_at??'1970-01-01')+1)).toISOString()};
      const result=project(agreement,[...payments.filter(p=>p.id!==candidate.id),candidate]);
      const context=result.payment_contexts[candidate.id];
      body.schedule_end_date=candidate.amount_cents===context.expected_cents?null:context.schedule_end_date;
      sentScheduleDates.set(body.request_id,body.schedule_end_date);
    }catch{/* Leave intentionally malformed fixtures untouched. */}
  }
 }
 const headers={'Cf-Access-Jwt-Assertion':token(role)};
 if(method!=='GET'){headers['origin']='https://wallet.test';headers['Content-Type']='application/json';headers['X-Wallet-Action']='1'}
 if(role==='manager'&&workMode)headers['X-Wallet-Mode']='assistant';
 const request=new Request('https://wallet.test'+url,{method,headers,body:method==='GET'?undefined:JSON.stringify(body===undefined?{}:body)});
 const res=await worker.fetch(request,env),text=await res.text();return {code:res.status,data:JSON.parse(text)};
}
test('End-to-end API, actual roles, schedule, ledger and audit',async()=>{
 let r=await call('assistant','POST','/api/entities',{kind:'property',name:'عمارة النخيل',electricity_meter:'12345',reference_value_cents:'900000'});
 assert.equal(r.code,201,JSON.stringify(r));const property=r.data.id;
 r=await call('outsider','POST','/api/entities',{kind:'car',name:'بلا صلاحية'});assert.equal(r.code,403);
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

test('Manager manages the full rental lifecycle without bypassing financial safeguards',async()=>{
 const asset=await call('manager','POST','/api/entities',{kind:'property',name:'عقار المدير'});
 assert.equal(asset.code,201);
 const unit=await call('manager','POST','/api/entities',{kind:'unit',name:'العقار بالكامل',parent_id:asset.data.id});
 assert.equal(unit.code,201);
 const edited=await call('manager','PATCH','/api/entities/'+unit.data.id,{name:'الوحدة المؤجرة'});
 assert.equal(edited.code,200);
 const contract={kind:'rent',entity_id:unit.data.id,title:'إيجار المدير',counterparty:'مستأجر تجريبي',phone:'0500000000',total:'1000',opening:'0',count:1,frequency:1,start_date:'2002-01-01',end_date:'2002-01-31',first_due_date:'2002-01-01'};
 const rent=await call('manager','POST','/api/agreements',contract);
 assert.equal(rent.code,201);
 assert.equal((await call('manager','POST','/api/agreements',contract)).code,400,'manager cannot overlap rental periods');
 const agreementPath='/api/agreements/'+rent.data.id;
 assert.equal((await call('manager','PATCH',agreementPath,{counterparty:'المستأجر المحدّث'})).code,200);
 const payment=await call('manager','POST',agreementPath+'/payments',{amount:'1000',paid_at:'2002-01-01',slot:0});
 assert.equal(payment.code,201);
 assert.equal((await call('manager','PATCH',agreementPath,{total:'900'})).code,400,'manager cannot rewrite schedule after payment');
 const paymentPath='/api/payments/'+payment.data.id;
 assert.equal((await call('manager','PATCH',paymentPath,{amount:'900',paid_at:'2002-01-01',slot:0})).code,200);
 assert.equal((await call('manager','POST',agreementPath+'/close',{})).code,400,'manager cannot close an unpaid contract');
 assert.equal((await call('manager','PATCH',paymentPath,{amount:'1000',paid_at:'2002-01-01',slot:0})).code,200);
 assert.equal((await call('manager','POST',agreementPath+'/vacate',{vacated_on:'2002-02-01',confirm_vacancy:true})).code,200);
 assert.equal((await call('manager','POST',agreementPath+'/close',{})).code,200);
 assert.equal((await call('manager','POST',agreementPath+'/reopen',{})).code,200);
 assert.equal((await call('manager','DELETE',paymentPath,{})).code,200);
 assert.equal((await call('manager','DELETE',agreementPath,{})).code,400,'vacated debt cannot be discarded by cancelling');
 assert.equal((await call('manager','POST',agreementPath+'/payments',{amount:'1000',paid_at:'2002-02-01',slot:0})).code,201);
 assert.equal((await call('manager','POST',agreementPath+'/close',{})).code,200);
 const expense=await call('manager','POST','/api/expenses',{title:'مصروف المدير',amount:'10',paid_at:'2002-01-01'});
 assert.equal(expense.code,201);
 assert.equal((await call('manager','DELETE','/api/expenses/'+expense.data.id,{})).code,200);
 assert.equal((await call('manager','DELETE','/api/entities/'+unit.data.id,{})).code,200);
 assert.equal((await call('manager','DELETE','/api/entities/'+asset.data.id,{})).code,200);
 const backup=await call('manager','GET','/api/backup');
 assert.equal(backup.code,200);
 assert.ok(backup.data.audit.some(x=>x.target_id===rent.data.id&&x.actor==='manager@example.com'));
 assert.equal((await call('assistant','GET','/api/backup')).code,403);
 assert.equal((await call('outsider','GET','/api/bootstrap')).code,403);
});

test('Manager can complete a genuine alert with an attributed audit entry',async()=>{
 const car=await call('manager','POST','/api/entities',{kind:'car',name:'تأمين للمتابعة',insurance_expiry:'2002-01-01'});
 assert.equal(car.code,201);
 const snapshot=await call('manager','GET','/api/bootstrap');
 const alert=snapshot.data.alerts.find(x=>x.key==='ins:'+car.data.id+':2002-01-01');
 assert.ok(alert);
 assert.equal((await call('manager','POST','/api/alerts/dismiss',{key:alert.key})).code,200);
 const refreshed=await call('manager','GET','/api/bootstrap');
 assert.ok(!refreshed.data.alerts.some(x=>x.key===alert.key));
 const backup=await call('manager','GET','/api/backup');
 assert.ok(backup.data.audit.some(x=>x.target_id===alert.key&&x.actor==='manager@example.com'));
 assert.equal((await call('manager','DELETE','/api/entities/'+car.data.id,{})).code,200);
});

test('History API filters the entire database, preserves permissions and paginates past 300',async()=>{
 const seed=(...values)=>run('INSERT INTO audit(id,actor,action,target_type,target_id,created_at) VALUES (?,?,?,?,?,?)',...values);
 const ids=[];
 for(let i=0;i<325;i++){
  const id=`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;ids.push(id);
  await seed(id,'assistant@example.com','إضافة','task',null,'2001-05-01T12:00:00.000Z');
 }
 const boundaryTimes=['2001-04-30T20:59:59.999Z','2001-04-30T21:00:00.000Z','2001-05-01T20:59:59.999Z','2001-05-01T21:00:00.000Z'];
 const boundaryIds=await Promise.all(boundaryTimes.map(async(date,i)=>{const id=`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`;await seed(id,'assistant@example.com','إضافة','task',null,date);return id}));
 const hidden=await call('manager','POST',`/api/history/${ids[5]}/hide`,{});assert.equal(hidden.code,200);
 const denied=await call('assistant','POST',`/api/history/${ids[6]}/hide`,{});assert.notEqual(denied.code,200);
 for(const sort of ['oldest','newest']){
  const seen=[];let cursor;
  do{
   const params=new URLSearchParams({from:'2001-05-01',to:'2001-05-01',sort,limit:'50',...(cursor?{cursor}:{})});
   const r=await call('manager','GET','/api/history?'+params,{},{workMode:false});assert.equal(r.code,200,JSON.stringify(r));
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
 await assert.rejects(()=>run('UPDATE audit SET action=? WHERE id=?','changed',ids[0]),/immutable/);
 await assert.rejects(()=>run('DELETE FROM audit WHERE id=?',ids[0]),/immutable/);
});

test('Concurrent payments cannot spend the same outstanding balance twice',{timeout:20000},async()=>{
 const a=await call('assistant','POST','/api/agreements',{kind:'other',title:'اختبار تزامن',total:'100',opening:'0',count:1,frequency:1,first_due_date:'2026-10-01'});
 assert.equal(a.code,201);
 const write=i=>call('assistant','POST',`/api/agreements/${a.data.id}/payments`,{amount:'60',paid_at:'2026-10-15',slot:0,request_id:`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`});
 // Separate Worker connections contend on the actual PostgreSQL mutation lock.
 const results=await fixture.race(()=>[write(1),write(2)]);
 assertOneConcurrentWrite(results);
 const row=(await one('SELECT SUM(amount_cents)::bigint AS total,COUNT(*) AS n FROM payments WHERE agreement_id=?',a.data.id));
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
 const row=(await one('SELECT COUNT(*) AS n FROM payments WHERE agreement_id=?',a.data.id));assert.equal(row.n,1);
});

test('Paid agreements reject silent schedule changes but retain descriptive editing',async()=>{
 const a=await call('assistant','POST','/api/agreements',{kind:'other',title:'اتفاق ثابت',total:'100',opening:'0',count:1,frequency:1,first_due_date:'2026-10-01'});
 const pay=await call('assistant','POST',`/api/agreements/${a.data.id}/payments`,{amount:'20',paid_at:'2026-10-15',slot:0,request_id:'50000000-0000-4000-8000-000000000001'});assert.equal(pay.code,201);
 const rejected=await call('assistant','PATCH',`/api/agreements/${a.data.id}`,{title:'عنوان مصحح',total:'200'});assert.equal(rejected.code,400);
 let stored=(await one('SELECT * FROM agreements WHERE id=?',a.data.id));assert.equal(stored.total_cents,10000);assert.equal(stored.title,'اتفاق ثابت');
 const allowed=await call('assistant','PATCH',`/api/agreements/${a.data.id}`,{title:'عنوان مصحح'});assert.equal(allowed.code,200);
 stored=(await one('SELECT * FROM agreements WHERE id=?',a.data.id));assert.equal(stored.title,'عنوان مصحح');
});

test('Workers cannot receive direct financial expenses through the API',async()=>{
 const worker=await call('assistant','POST','/api/entities',{kind:'worker',name:'عامل اختبار'});assert.equal(worker.code,201);
 const rejected=await call('assistant','POST','/api/expenses',{title:'لا يسمح',amount:'20',paid_at:'2026-10-15',entity_id:worker.data.id});assert.equal(rejected.code,400);
 assert.equal((await one('SELECT count(*) AS n FROM expenses WHERE entity_id=?',worker.data.id)).n,0);
});

test('History requires authentication and rejects an unlisted account',async()=>{
 const response=await worker.fetch(new Request('https://wallet.test/api/history'),env);assert.equal(response.status,401);
 const denied=await call('outsider','GET','/api/history');assert.equal(denied.code,403);
 assert.equal((await call('assistant','GET','/api/history')).code,403,'audit history is reserved for the manager');
 assert.equal((await call('manager','GET','/api/history',undefined,{workMode:false})).code,200,'reading history does not require assistant mode');
});

test('Expense retries are atomic, including simultaneous submissions',{timeout:20000},async()=>{
 const request_id=crypto.randomUUID(),payload={request_id,title:'منصرف موحد',amount:'20',paid_at:'2026-10-15'};
 const results=await fixture.race(()=>[call('assistant','POST','/api/expenses',payload),call('assistant','POST','/api/expenses',payload)]);
 assert.deepEqual(results.map(r=>r.code),[201,201],JSON.stringify(results));assert.equal(results[0].data.id,results[1].data.id);
 const id=results[0].data.id;
 assert.equal((await one('SELECT COUNT(*) n FROM expenses WHERE id=?',id)).n,1);
 assert.equal((await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',id)).n,1);
 assert.equal((await call('assistant','POST','/api/expenses',{...payload,amount:'21'})).code,409);
 assert.equal((await call('manager','POST','/api/tasks',{...payload,title:'scope mismatch'})).code,409);
});

test('Concurrent overlapping leases cannot both commit',{timeout:20000},async()=>{
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'وحدة التزامن'});
 const payload={kind:'rent',entity_id:unit.data.id,title:'اختبار التداخل',start_date:'2027-01-01',end_date:'2027-01-31',first_due_date:'2027-01-01',total:'100',opening:'0',count:1,frequency:1};
 const results=await fixture.race(()=>[call('assistant','POST','/api/agreements',payload),call('assistant','POST','/api/agreements',payload)]);
 assertOneConcurrentWrite(results);
 assert.equal((await one('SELECT COUNT(*) n FROM agreements WHERE entity_id=?',unit.data.id)).n,1);
 const adjacent=await call('assistant','POST','/api/agreements',{...payload,start_date:'2027-02-01',end_date:'2027-02-28',first_due_date:'2027-02-01'});assert.equal(adjacent.code,201);
 const overlapEdit=await call('assistant','PATCH','/api/agreements/'+adjacent.data.id,{start_date:'2027-01-31'});assert.equal(overlapEdit.code,400);
});

test('Stale edits and deletes fail without overwriting data or adding audit entries',async()=>{
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'اسم قبل التعديل'}),url='/api/entities/'+e.data.id;
 const first=await call('assistant','PATCH',url,{name:'اسم حديث',expected_version:0});assert.equal(first.code,200);
 const count=(await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',e.data.id)).n;
 assert.equal((await call('assistant','PATCH',url,{name:'اسم قديم',expected_version:0})).code,409);
 assert.equal((await call('assistant','DELETE',url,{expected_version:0})).code,409);
 const row=(await one('SELECT * FROM entities WHERE id=?',e.data.id));assert.equal(row.name,'اسم حديث');assert.equal(row.archived,0);
 assert.equal((await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',e.data.id)).n,count);
 const task=await call('manager','POST','/api/tasks',{title:'نسخ المهمة'});
 assert.equal((await call('assistant','PATCH','/api/tasks/'+task.data.id,{state:'done',expected_version:0})).code,200);
 assert.equal((await call('assistant','PATCH','/api/tasks/'+task.data.id,{state:'open',expected_version:0})).code,409);
});

test('Concurrent entity edits use a database compare-and-swap',{timeout:20000},async()=>{
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'نسخة مشتركة'});
 const results=await fixture.race(()=>['الأول','الثاني'].map(name=>call('assistant','PATCH','/api/entities/'+e.data.id,{name,expected_version:0})));
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);
 assert.equal((await one('SELECT version FROM entities WHERE id=?',e.data.id)).version,1);
 assert.equal((await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',e.data.id)).n,2);
});

test('Entity archive cannot race a new agreement into an archived asset',{timeout:20000},async()=>{
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'أصل مرتبط بالتزامن'});
 const results=await fixture.race(()=>[
  call('assistant','DELETE','/api/entities/'+e.data.id,{}),
  call('assistant','POST','/api/agreements',{kind:'purchase',entity_id:e.data.id,title:'شراء',total:'100',first_due_date:'2026-10-01',count:1,frequency:1})
 ]);
 assertOneConcurrentWrite(results);
 const asset=(await one('SELECT * FROM entities WHERE id=?',e.data.id)),links=(await one("SELECT COUNT(*) n FROM agreements WHERE entity_id=? AND status='active'",e.data.id)).n;
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
 assert.equal((await one('SELECT version FROM entities WHERE id=?',created.data.id)).version,1);
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
 assert.equal((await call('outsider','POST','/api/expenses',{title:'مرفوض',amount:'1',paid_at:'2026-10-15'})).code,403);
 assert.equal((await call('assistant','GET','/api/backup')).code,403);
 const legacyRequest=new Request('https://wallet.test/api/tasks',{method:'POST',headers:{origin:'https://wallet.test','Content-Type':'application/json','X-Mahfazati-Action':'1','X-Wallet-Mode':'assistant','Cf-Access-Jwt-Assertion':token('manager')},body:JSON.stringify({title:'طلب من تبويب سابق',request_id:crypto.randomUUID(),database_generation:(await one('SELECT generation FROM restore_control WHERE id=1')).generation})});
 assert.equal((await worker.fetch(legacyRequest,env)).status,201,'an open tab from before the rename retains the same protected write path');
 for(const headers of [
  {'origin':'https://evil.test','Content-Type':'application/json','X-Wallet-Action':'1'},
  {'origin':'https://wallet.test','Content-Type':'application/json'},
  {'origin':'https://wallet.test','Content-Type':'text/plain','X-Wallet-Action':'1'}
 ]){
  const r=await worker.fetch(new Request('https://wallet.test/api/tasks',{method:'POST',headers:{...headers,'Cf-Access-Jwt-Assertion':token('assistant')},body:'{}'}),env);assert.equal(r.status,400);
 }
 const broken={...env,DB:{prepare(){throw Error('SQL PRIVATE DATABASE DETAILS')}}};
 const r=await worker.fetch(new Request('https://wallet.test/api/history',{headers:{'Cf-Access-Jwt-Assertion':token('manager')}}),broken);
 assert.equal(r.status,500);assert.ok(!(await r.text()).includes('PRIVATE'));
});

test('Audit visibility changes are idempotent and alert keys must be real',async()=>{
 const task=await call('manager','POST','/api/tasks',{title:'مهمة لتجربة السجل'});
 const row=(await one('SELECT id FROM audit WHERE target_id=?',task.data.id));
 for(let i=0;i<2;i++)assert.equal((await call('manager','POST','/api/history/'+row.id+'/hide',{})).code,200);
 assert.equal((await one("SELECT COUNT(*) n FROM audit WHERE target_id=? AND action='إخفاء سجل'",row.id)).n,1);
 assert.equal((await call('assistant','POST','/api/alerts/dismiss',{key:'invented:key'})).code,400);
 const e=await call('assistant','POST','/api/entities',{kind:'car',name:'تأمين متأخر',insurance_expiry:'2020-01-01'});
 const key='ins:'+e.data.id+':2020-01-01';
 for(let i=0;i<2;i++)assert.equal((await call('assistant','POST','/api/alerts/dismiss',{key})).code,200);
 assert.equal((await one("SELECT COUNT(*) n FROM audit WHERE target_id=? AND action='إتمام تنبيه'",key)).n,1);
});

test('Snapshot exports include audit, voids, versions and retry receipts',async()=>{
 const r=await call('manager','GET','/api/backup');assert.equal(r.code,200);
 assert.deepEqual(inspectBackup(r.data).issues,[]);
 assert.equal(r.data.schema_version,9);assert.equal(r.data.format_version,2);
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
 const before={...(await one('SELECT * FROM payments WHERE id=?',p.data.id))};
 const version=(await one('SELECT version FROM agreements WHERE id=?',a.data.id)).version;
 const auditCount=(await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',p.data.id)).n;
 for(const edit of [{slot:1},{amount:'1'},{paid_at:'2030-01-01'},{reschedule_method:'spread'},{note:'تغيير خفي'}]){
  const request_id=crypto.randomUUID();
  const rejected=await call('assistant','DELETE',url,{...edit,request_id});
  assert.equal(rejected.code,400,JSON.stringify(rejected));
  assert.deepEqual({...(await one('SELECT * FROM payments WHERE id=?',p.data.id))},before);
  assert.equal((await one('SELECT version FROM agreements WHERE id=?',a.data.id)).version,version);
  assert.equal((await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',p.data.id)).n,auditCount);
  assert.equal((await one('SELECT COUNT(*) n FROM mutation_requests WHERE request_id=?',request_id)).n,0);
 }
 const request_id=crypto.randomUUID(),voided=await call('assistant','DELETE',url,{request_id});
 assert.equal(voided.code,200,JSON.stringify(voided));
 const after={...(await one('SELECT * FROM payments WHERE id=?',p.data.id))};
 assert.equal(after.active,0);
 for(const key of Object.keys(before).filter(key=>!['active','observed_version','updated_at'].includes(key)))assert.equal(after[key],before[key],key);
 assert.equal((await one('SELECT version FROM agreements WHERE id=?',a.data.id)).version,version+1);
 const retried=await call('assistant','DELETE',url,{request_id});
 assert.equal(retried.code,200);assert.equal(retried.data.idempotent,true);
 assert.equal((await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',p.data.id)).n,auditCount+1);
});

test('A committed receipt survives an expired session and authenticates the same retry safely',async()=>{
 const body={title:'إعادة المحاولة بعد تجديد الدخول',amount:'75',paid_at:'2026-10-15',request_id:crypto.randomUUID()};
 const committed=await call('assistant','POST','/api/expenses',body);
 assert.equal(committed.code,201);
 // The client may have lost this success response and retry after its JWT expires.
 const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const signingInput=b64({alg:'RS256',kid:'localtest'})+'.'+b64({iss:'https://localtest.cloudflareaccess.com',aud:['wallet-aud'],email:'assistant@example.com',exp:Math.floor(Date.now()/1000)-60});
 const expired=signingInput+'.'+createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
 const failed=await worker.fetch(new Request('https://wallet.test/api/expenses',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':expired,origin:'https://wallet.test','Content-Type':'application/json','X-Wallet-Action':'1'},body:JSON.stringify(body)}),env);
 assert.equal(failed.status,401);
 const retried=await call('assistant','POST','/api/expenses',body);
 assert.equal(retried.code,201);assert.equal(retried.data.id,committed.data.id);assert.equal(retried.data.idempotent,true);
 assert.equal((await one('SELECT COUNT(*) n FROM expenses WHERE title=?',body.title)).n,1);
 assert.equal((await one('SELECT COUNT(*) n FROM audit WHERE target_id=?',committed.data.id)).n,1);
 assert.equal((await one('SELECT COUNT(*) n FROM mutation_requests WHERE request_id=?',body.request_id)).n,1);
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
 const paymentBefore={...(await one('SELECT * FROM payments WHERE id=?',ids.payment))};
 assert.equal((await call('outsider','POST',base+'/close',{})).code,403);
 const closeBody={request_id:crypto.randomUUID()},closed=await call('assistant','POST',base+'/close',closeBody);
 assert.equal(closed.code,200,JSON.stringify(closed));assert.ok(closed.data.closed_at);assert.equal(closed.data.closed_by,'assistant@example.com');
 const closedRow=(await one('SELECT * FROM agreements WHERE id=?',ids.agreement));
 assert.equal(closedRow.status,'active');assert.equal(closedRow.version,2);
 for(const [method,path,body] of [['PATCH',base,{title:'تعديل مغلق'}],['DELETE',base,{}],['POST',base+'/payments',{amount:'1',paid_at:'2002-01-15',slot:0}],['PATCH','/api/payments/'+ids.payment,{amount:'90'}],['DELETE','/api/payments/'+ids.payment,{}]]){
  const denied=await call('assistant',method,path,body);assert.equal(denied.code,400,JSON.stringify(denied));assert.match(denied.data.error,/مغلق/);
 }
 const after=await call('manager','GET','/api/bootstrap?month=2002-01');
 assert.deepEqual(after.data.summary,before.data.summary);assert.deepEqual(after.data.payment_contexts,before.data.payment_contexts);
 assert.deepEqual({...(await one('SELECT * FROM payments WHERE id=?',ids.payment))},paymentBefore);
 const retried=await call('assistant','POST',base+'/close',closeBody);assert.equal(retried.data.idempotent,true);assert.equal(retried.data.closed_at,closed.data.closed_at);
 assert.equal((await call('outsider','POST',base+'/reopen',{})).code,403);
 const reopenBody={request_id:crypto.randomUUID()},reopened=await call('assistant','POST',base+'/reopen',reopenBody);
 assert.equal(reopened.code,200);assert.equal(reopened.data.closed_at,null);assert.equal(reopened.data.closed_by,null);
 assert.equal((await call('assistant','POST',base+'/reopen',reopenBody)).data.idempotent,true);
 assert.equal((await call('assistant','POST',base+'/close',closeBody)).data.idempotent,true);
 assert.equal((await one('SELECT closed_at FROM agreements WHERE id=?',ids.agreement)).closed_at,null,'replaying an old close receipt cannot close a reopened agreement');
 assert.equal((await call('assistant','POST',base+'/close',{})).code,200);
 assert.equal((await call('assistant','DELETE','/api/entities/'+ids.asset,{})).code,200);
 assert.equal((await call('assistant','POST',base+'/reopen',{})).code,400,'an archived asset cannot have an open agreement');
 const archived=await call('manager','GET','/api/bootstrap?month=2002-01');assert.deepEqual(archived.data.summary,before.data.summary);
 assert.ok(!archived.data.entities.some(e=>e.id===ids.asset));assert.ok(archived.data.payments.some(p=>p.id===ids.payment));
 const audit=(await rows('SELECT action FROM audit WHERE target_id=?',ids.agreement)).map(r=>r.action);
 assert.equal(audit.filter(action=>action==='إغلاق اتفاق').length,2);assert.equal(audit.filter(action=>action==='إعادة فتح اتفاق').length,1);
 const backup=await call('manager','GET','/api/backup');assert.equal(backup.data.schema_version,9);assert.deepEqual(inspectBackup(backup.data).issues,[]);
});

test('Financial closure requires settlement and saved vacancy; reopening does not restore occupancy',async()=>{
 const unpaid=await call('assistant','POST','/api/agreements',{kind:'other',title:'رصيد يمنع الإغلاق',total:'100',first_due_date:'2001-01-01'});
 assert.equal((await call('assistant','POST','/api/agreements/'+unpaid.data.id+'/close',{})).code,400);
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'إغلاق عقد الإيجار'});assert.equal(unit.code,201);
 const rent={kind:'rent',entity_id:unit.data.id,title:'إيجار منتهٍ ومسدد',total:'100',opening:'100',count:1,frequency:1,start_date:'2001-01-01',end_date:'2001-01-31',first_due_date:'2001-01-01'};
 const past=await call('assistant','POST','/api/agreements',rent);assert.equal(past.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+past.data.id+'/close',{})).code,400,'expiry alone cannot close possession');
 assert.equal((await call('assistant','POST','/api/agreements/'+past.data.id+'/vacate',{vacated_on:'2001-02-01',confirm_vacancy:true})).code,200);
 assert.equal((await call('assistant','POST','/api/agreements/'+past.data.id+'/close',{})).code,200);
 const afterClose=await call('assistant','GET','/api/bootstrap');assert.ok(!afterClose.data.alerts.some(a=>a.key.startsWith('rent:'+past.data.id+':')));
 const replacement=await call('assistant','POST','/api/agreements',{...rent,start_date:'2001-02-01',end_date:'2001-02-28',first_due_date:'2001-02-01'});assert.equal(replacement.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+past.data.id+'/reopen',{})).code,200);
 assert.equal((await call('assistant','POST','/api/agreements/'+replacement.data.id+'/vacate',{vacated_on:'2001-03-01',confirm_vacancy:true})).code,200);
 const future=await call('assistant','POST','/api/agreements',{...rent,start_date:'9999-01-01',end_date:'9999-01-31',first_due_date:'9999-01-01'});assert.equal(future.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+future.data.id+'/close',{})).code,400);
 const today=afterClose.data.today;
 const endingToday=await call('assistant','POST','/api/agreements',{...rent,start_date:today,end_date:today,first_due_date:today});assert.equal(endingToday.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+endingToday.data.id+'/close',{})).code,400,'the final rental day still belongs to the open contract');
});

test('Closure and payment correction cannot race into a closed unpaid agreement',{timeout:20000},async()=>{
 const ids=await paidSale('سباق الإغلاق والتصحيح');
 const closeBody={request_id:crypto.randomUUID()},editBody={amount:'90',request_id:crypto.randomUUID()};
 const beforeAudit=(await one('SELECT COUNT(*) n FROM audit')).n;
 const results=await fixture.race(()=>[call('assistant','POST','/api/agreements/'+ids.agreement+'/close',closeBody),call('assistant','PATCH','/api/payments/'+ids.payment,editBody)]);
 assertOneConcurrentWrite(results);
 const a=(await one('SELECT * FROM agreements WHERE id=?',ids.agreement)),p=(await one('SELECT * FROM payments WHERE id=?',ids.payment));
 assert.equal(a.version,2);assert.ok(a.closed_at?p.amount_cents===10000:p.amount_cents===9000);
 assert.equal((await one('SELECT COUNT(*) n FROM audit')).n,beforeAudit+1);
 assert.equal((await one('SELECT COUNT(*) n FROM mutation_requests WHERE request_id IN (?,?)',closeBody.request_id,editBody.request_id)).n,1);
});

test('Reopening and archiving the same asset retain the database relationship guard',{timeout:20000},async()=>{
 const ids=await paidSale('سباق إعادة الفتح والأرشفة');
 assert.equal((await call('assistant','POST','/api/agreements/'+ids.agreement+'/close',{})).code,200);
 const results=await fixture.race(()=>[call('assistant','POST','/api/agreements/'+ids.agreement+'/reopen',{}),call('assistant','DELETE','/api/entities/'+ids.asset,{})]);
 assertOneConcurrentWrite(results);
 const a=(await one('SELECT closed_at FROM agreements WHERE id=?',ids.agreement)),e=(await one('SELECT archived FROM entities WHERE id=?',ids.asset));
 assert.ok(a.closed_at||e.archived===0);
});

test('Closure migration preserves existing rows and guards closed financial history in SQLite',()=>{
 const prior=new DatabaseSync(':memory:');
 try{
  prior.exec('PRAGMA foreign_keys=ON');
  const migrations=fs.readdirSync(new URL('../database/migrations/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort();
  for(const file of migrations.filter(file=>file<'0004'))prior.exec(fs.readFileSync(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
  const time='2002-01-15T12:00:00.000Z';
  prior.prepare('INSERT INTO entities(id,kind,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('asset','car','سيارة سابقة','assistant@example.com',time,time);
  prior.prepare('INSERT INTO agreements(id,entity_id,kind,direction,title,total_cents,opening_cents,installment_count,frequency_months,first_due_date,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('agreement','asset','sale','in','بيع سابق',10000,0,1,1,'2002-01-01','assistant@example.com',time);
  prior.exec("UPDATE agreements SET version=1 WHERE id='agreement'");
  prior.prepare('INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('payment','request','agreement',0,10000,'2002-01-15',0,'assistant@example.com',time);
  prior.prepare('INSERT INTO audit(id,actor,action,target_type,target_id,created_at) VALUES (?,?,?,?,?,?)').run('audit','assistant@example.com','تسجيل حركة','payment','payment',time);
  const before=Object.fromEntries(['entities','agreements','payments','audit'].map(table=>[table,prior.prepare('SELECT * FROM '+table).all().map(row=>({...row}))]));
  prior.exec(fs.readFileSync(new URL('../database/migrations/0004_agreement_closure.sql',import.meta.url),'utf8'));
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
   assert.deepEqual(archived.find(row=>row.id===id),{id,kind,name,parent_id,property_type:null});
   assert.ok(!result.data.entities.some(row=>row.id===id),'current asset lists remain separate');
  }
  for(const id of [paid.agreement,opening.data.id])assert.ok(result.data.agreements.find(a=>a.id===id)?.closed_at);
  assert.ok(result.data.payments.some(p=>p.id===paid.payment));
  assert.ok(!result.data.payments.some(p=>p.agreement_id===opening.data.id),'opening balances do not become new cash movements');
 }
 assert.equal((await call('outsider','GET','/api/bootstrap?month=2002-01')).code,403);
});

test('Manager starts read-only at the API and explicit assistant mode preserves the real actor',async()=>{
 const before=(await one('SELECT COUNT(*) n FROM audit')).n;
 for(const [method,path,body] of [
  ['POST','/api/entities',{kind:'car',name:'لا يحفظ دون وضع المساعد'}],
  ['POST','/api/tasks',{title:'مهمة لا تحفظ'}],
  ['POST','/api/alerts/dismiss',{key:'anything'}],
  ['PATCH','/api/entities/10000000-0000-4000-8000-000000000000',{name:'تعديل'}],
  ['DELETE','/api/entities/10000000-0000-4000-8000-000000000000',{}],
 ]){
  const denied=await call('manager',method,path,body,{workMode:false});
  assert.equal(denied.code,403);assert.match(denied.data.error,/وضع المساعد/);
 }
 assert.equal((await one('SELECT COUNT(*) n FROM audit')).n,before);
 assert.equal((await call('manager','GET','/api/bootstrap',undefined,{workMode:false})).code,200);
 const saved=await call('manager','POST','/api/entities',{kind:'car',name:'تعديل المدير في وضع المساعد'});
 assert.equal(saved.code,201);
 assert.equal((await one('SELECT created_by FROM entities WHERE id=?',saved.data.id)).created_by,'manager@example.com');
 assert.equal((await one('SELECT actor FROM audit WHERE target_id=?',saved.data.id)).actor,'manager@example.com');
 assert.equal((await call('manager','GET','/api/bootstrap')).data.user.role,'manager');
});

test('Unit occupancy persists after expiry and releases only after saved vacancy; future cancellation stays separate',async()=>{
 const today=(await call('assistant','GET','/api/bootstrap')).data.today;
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'حالة تلقائية',status:'rented'});
 const state=async()=> (await call('assistant','GET','/api/bootstrap')).data.entities.find(e=>e.id===unit.data.id);
 assert.equal((await state()).status,'available','stale manual rented label does not reserve a unit');
 assert.equal((await state()).manual_status,'rented');
 const rent=await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'إيجار اليوم',start_date:today,end_date:today,first_due_date:today,total:'100'});
 assert.equal(rent.code,201);assert.equal((await state()).status,'rented');
 assert.equal((await call('assistant','PATCH','/api/entities/'+unit.data.id,{status:'personal_use'})).code,400,'cannot mask an active rental with a manual state');
 assert.equal((await call('assistant','DELETE','/api/agreements/'+rent.data.id,{})).code,400);
 assert.equal((await call('assistant','POST','/api/agreements/'+rent.data.id+'/vacate',{vacated_on:today,confirm_vacancy:true})).code,200);
 assert.equal((await state()).status,'available');
 const old=await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'عقد منتهٍ وله دين',start_date:'2000-01-01',end_date:'2000-01-31',first_due_date:'2000-01-01',total:'100'});
 assert.equal(old.code,201);assert.equal((await state()).status,'rented','expiry does not release possession');
 assert.equal((await call('assistant','PATCH','/api/entities/'+unit.data.id,{status:'maintenance'})).code,400,'expiry cannot bypass possession through manual state');
 const expiredAlert=(await call('assistant','GET','/api/bootstrap')).data.alerts.find(a=>a.key.startsWith('rent:'+old.data.id+':'));
 assert.ok(expiredAlert);
 assert.equal((await call('assistant','POST','/api/alerts/dismiss',{key:expiredAlert.key})).code,200);
 assert.equal((await state()).status,'rented','acknowledging an alert is not confirming vacancy');
 assert.equal((await call('assistant','POST','/api/agreements/'+old.data.id+'/vacate',{vacated_on:'2000-02-01',confirm_vacancy:true})).code,200);
 assert.equal((await state()).status,'available');
 const future=addMonths(today,1);
 const next=await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'حجز قادم',start_date:future,end_date:future,first_due_date:future,total:'100'});
 assert.equal(next.code,201);assert.equal((await state()).status,'available','future contract does not label today rented');
 assert.equal((await call('assistant','PATCH','/api/entities/'+unit.data.id,{status:'maintenance'})).code,400);
 assert.equal((await call('assistant','DELETE','/api/agreements/'+next.data.id,{})).code,200);
 for(const status of ['personal_use','maintenance','unavailable']){
  assert.equal((await call('assistant','PATCH','/api/entities/'+unit.data.id,{status})).code,200);
  assert.equal((await state()).status,status);
  assert.equal((await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'إيجار محجوب',start_date:today,end_date:today,first_due_date:today,total:'100'})).code,400);
 }
 assert.equal((await call('assistant','PATCH','/api/entities/'+unit.data.id,{status:'available'})).code,200);
 const current=await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'دفع كامل لا يخلي الوحدة',start_date:today,end_date:today,first_due_date:today,total:'100'});
 assert.equal(current.code,201);
 assert.equal((await call('assistant','POST','/api/agreements/'+current.data.id+'/payments',{slot:0,amount:'100',paid_at:today})).code,201);
 assert.equal((await state()).status,'rented','payment does not shorten possession');
});

test('Early vacancy preserves exact receipts, original schedule and debt, permits reletting, and records the real actor once',async()=>{
 const today=(await call('assistant','GET','/api/bootstrap')).data.today;
 const unit=(await call('assistant','POST','/api/entities',{kind:'unit',name:'إنهاء مبكر بمديونية'})).data.id;
 const rental={kind:'rent',entity_id:unit,title:'عقد قائم',start_date:today,end_date:addMonths(today,3),first_due_date:today,total:'1000',opening:'100',count:3,frequency:1};
 const created=await call('assistant','POST','/api/agreements',rental);assert.equal(created.code,201);
 const path='/api/agreements/'+created.data.id;
 assert.equal((await call('assistant','POST',path+'/payments',{slot:0,amount:'200',paid_at:today})).code,201);
 const before=(await one('SELECT * FROM agreements WHERE id=?',created.data.id));
 const receipts=(await rows('SELECT * FROM payments WHERE agreement_id=?',before.id));
 const balance=project(before,receipts);assert.equal(balance.remaining_cents,70000);
 const snapshot=async()=>(await call('assistant','GET','/api/bootstrap')).data;
 assert.equal((await call('assistant','POST',path+'/vacate',{vacated_on:today})).code,400);
 assert.equal((await call('assistant','POST',path+'/vacate',{vacated_on:addMonths(today,1),confirm_vacancy:true})).code,400);
 assert.equal((await call('manager','POST',path+'/vacate',{vacated_on:today,confirm_vacancy:true},{workMode:false})).code,403);
 assert.equal((await call('assistant','POST','/api/agreements',rental)).code,400);
 assert.equal((await snapshot()).entities.find(e=>e.id===unit).status,'rented');
 const body={request_id:crypto.randomUUID(),vacated_on:today,confirm_vacancy:true,vacate_note:'تسليم الوحدة مبكرًا'};
 const saved=await call('manager','POST',path+'/vacate',body);assert.equal(saved.code,200,JSON.stringify(saved));
 assert.equal((await call('manager','POST',path+'/vacate',body)).data.idempotent,true);
 const after=(await one('SELECT * FROM agreements WHERE id=?',before.id));
 assert.equal(after.vacated_by,'manager@example.com');assert.equal(after.closed_at,null);assert.equal(after.status,'active');
 for(const field of ['total_cents','opening_cents','installment_count','frequency_months','first_due_date','start_date','end_date'])assert.equal(after[field],before[field]);
 assert.deepEqual((await rows('SELECT * FROM payments WHERE agreement_id=?',before.id)),receipts);
 assert.deepEqual(project(after,receipts),balance);
 const vacant=await snapshot();assert.equal(vacant.entities.find(e=>e.id===unit).status,'available');
 assert.equal(vacant.dues.filter(d=>d.agreement_id===before.id).reduce((n,d)=>n+d.amount_cents,0),70000);
 assert.ok(!vacant.alerts.some(a=>a.key.startsWith('rent:'+before.id+':')));
 assert.equal((await call('assistant','PATCH',path,{total:'300'})).code,400);
 assert.equal((await call('assistant','POST',path+'/close',{})).code,400,'debt prevents financial closure after vacancy');
 assert.equal((await call('assistant','POST','/api/agreements',{...rental,title:'المستأجر التالي'})).code,201,'same-day handover permits a new lease');
 assert.equal((await call('assistant','POST',path+'/payments',{slot:0,amount:'700',paid_at:today,reschedule_method:'shorten'})).code,201,'old debt remains collectible');
 assert.equal((await call('assistant','POST',path+'/close',{})).code,200,'settled vacated rental may close before its original end');
 assert.equal((await call('assistant','POST',path+'/reopen',{})).code,200,'financial reopening does not conflict with the new occupant');
 const events=(await rows("SELECT actor,action FROM audit WHERE target_id=? AND action='إخلاء وإنهاء مبكر'",before.id));
 assert.deepEqual(events.map(e=>({...e})),[{actor:'manager@example.com',action:'إخلاء وإنهاء مبكر'}]);
 assert.deepEqual(inspectBackup((await call('manager','GET','/api/backup')).data).issues,[]);
});

test('Concurrent vacancy confirmations commit once and stale confirmation cannot overwrite a newer payment',{timeout:20000},async()=>{
 const today=(await call('assistant','GET','/api/bootstrap')).data.today;
 const unit=(await call('assistant','POST','/api/entities',{kind:'unit',name:'تأكيد إخلاء متزامن'})).data.id;
 const rental=(await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit,title:'عقد الإخلاء',start_date:today,end_date:today,first_due_date:today,total:'100'})).data.id;
 const path='/api/agreements/'+rental;
 const stale=(await one('SELECT version FROM agreements WHERE id=?',rental)).version;
 assert.equal((await call('assistant','POST',path+'/payments',{slot:0,amount:'20',paid_at:today})).code,201);
 assert.equal((await call('assistant','POST',path+'/vacate',{expected_version:stale,vacated_on:today,confirm_vacancy:true})).code,409);
 assert.equal((await one('SELECT vacated_at FROM agreements WHERE id=?',rental)).vacated_at,null);
 const results=await fixture.race(()=>[1,2].map(()=>call('assistant','POST',path+'/vacate',{vacated_on:today,confirm_vacancy:true})));
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);
 assert.equal((await one("SELECT COUNT(*) n FROM audit WHERE target_id=? AND action='تأكيد إخلاء'",rental)).n,1);
});

test('Blocking a unit and creating a future rental cannot both commit',{timeout:20000},async()=>{
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'حالة متزامنة'});
 const today=(await call('assistant','GET','/api/bootstrap')).data.today,future=addMonths(today,1);
 const results=await fixture.race(()=>[
  call('assistant','PATCH','/api/entities/'+unit.data.id,{status:'personal_use'}),
  call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'حجز متزامن',start_date:future,end_date:future,first_due_date:future,total:'100'})
 ]);
 assertOneConcurrentWrite(results);
});

test('Changed receipts require an explicit coherent schedule date and partial arrears never disappear',async()=>{
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'وحدة اختبار الجدولة'});
 const rent=await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'ثبات تاريخ العقد',start_date:'2001-01-01',end_date:'2001-12-31',first_due_date:'2001-01-01',count:3,frequency:1,total:'300'});
 assert.equal(rent.code,201);
 const endpoint='/api/agreements/'+rent.data.id+'/payments',options={confirmSchedule:false};
 const partial={slot:0,amount:'40',paid_at:'2001-01-10'};
 for(const body of [partial,{...partial,schedule_end_date:'2001-02-01'},{...partial,reschedule_method:'spread',schedule_end_date:'2001-03-01'}])
  assert.equal((await call('assistant','POST',endpoint,body,options)).code,400);
 assert.equal((await one('SELECT version FROM agreements WHERE id=?',rent.data.id)).version,0);
 const paid=await call('assistant','POST',endpoint,{...partial,schedule_end_date:'2001-03-01'},options);assert.equal(paid.code,201);
 let snapshot=await call('assistant','GET','/api/bootstrap?month=2001-01');
 const due=snapshot.data.dues.find(d=>d.agreement_id===rent.data.id&&d.slot===0);
 assert.equal(due.amount_cents,6000);assert.equal(due.due_date,'2001-01-01');assert.equal(due.status,'متأخر');
 assert.equal((await call('assistant','PATCH','/api/payments/'+paid.data.id,{amount:'45'},options)).code,400,'editing a prior confirmation requires a fresh explicit date');
 const excess={slot:0,amount:'160',paid_at:'2001-01-11'};
 assert.equal((await call('assistant','POST',endpoint,{...excess,schedule_end_date:'2001-02-01'},options)).code,400);
 assert.equal((await call('assistant','POST',endpoint,{...excess,reschedule_method:'shorten'},options)).code,400);
 assert.equal((await call('assistant','POST',endpoint,{...excess,reschedule_method:'shorten',schedule_end_date:'2001-03-01'},options)).code,400);
 const shortened=await call('assistant','POST',endpoint,{...excess,reschedule_method:'shorten',schedule_end_date:'2001-02-01'},options);assert.equal(shortened.code,201);
 snapshot=await call('assistant','GET','/api/bootstrap?month=2001-01');
 assert.deepEqual(snapshot.data.dues.filter(d=>d.agreement_id===rent.data.id).map(d=>[d.slot,d.due_date,d.amount_cents]),[[1,'2001-02-01',10000]]);
 const stored=(await one('SELECT * FROM agreements WHERE id=?',rent.data.id));
 assert.equal(stored.total_cents,30000);assert.equal(stored.start_date,'2001-01-01');assert.equal(stored.end_date,'2001-12-31');
 assert.equal((await one('SELECT SUM(amount_cents)::bigint n FROM payments WHERE agreement_id=?',rent.data.id)).n,20000);
});

test('Spread keeps the last installment date and full early settlement explicitly confirms payment day',async()=>{
 for(const [amount,method,date,expected] of [['150','spread','2001-03-01',15000],['300','shorten','2001-01-10',0]]){
  const a=await call('assistant','POST','/api/agreements',{kind:'other',title:'توزيع أو تسوية',first_due_date:'2001-01-01',count:3,frequency:1,total:'300'});
  const endpoint='/api/agreements/'+a.data.id+'/payments',options={confirmSchedule:false};
  const body={slot:0,amount,paid_at:'2001-01-10',reschedule_method:method,schedule_end_date:date,request_id:crypto.randomUUID()};
  const saved=await call('assistant','POST',endpoint,body,options);assert.equal(saved.code,201);
  assert.equal((await call('assistant','POST',endpoint,body,options)).data.idempotent,true);
  assert.equal((await call('assistant','POST',endpoint,{...body,schedule_end_date:'2001-01-11'},options)).code,409);
  const agreement=(await one('SELECT * FROM agreements WHERE id=?',a.data.id)),payments=(await rows('SELECT * FROM payments WHERE agreement_id=?',a.data.id));
  const result=project(agreement,payments);assert.equal(result.remaining_cents,expected);assert.equal(result.schedule_end_date,date);
  if(expected)assert.deepEqual(result.rows.map(r=>r.remaining_cents),[0,7500,7500]);
 }
});

test('General reminders start seven days ahead and annual rentals start three calendar months ahead',async()=>{
 const today=(await call('assistant','GET','/api/bootstrap')).data.today;
 const days=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 const car7=await call('assistant','POST','/api/entities',{kind:'car',name:'تأمين خلال أسبوع',insurance_expiry:days(7)});
 const car8=await call('assistant','POST','/api/entities',{kind:'car',name:'تأمين بعد أسبوع',insurance_expiry:days(8)});
 const annualEnd=addMonths(today,3),startYear=String(Number(annualEnd.slice(0,4))-1)+annualEnd.slice(4);
 const unit=await call('assistant','POST','/api/entities',{kind:'unit',name:'وحدة عقد سنوي'});
 const annual=await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit.data.id,title:'تنبيه سنوي',start_date:startYear,end_date:annualEnd,first_due_date:startYear,total:'100'});
 assert.equal(annual.code,201);
 const alerts=(await call('assistant','GET','/api/bootstrap')).data.alerts;
 assert.ok(alerts.some(a=>a.key.startsWith('ins:'+car7.data.id)&&a.days_remaining===7));
 assert.ok(!alerts.some(a=>a.key.startsWith('ins:'+car8.data.id)));
 assert.ok(alerts.some(a=>a.key.startsWith('rent:'+annual.data.id)&&a.reminder_date<=today));
});

test('Property classification is persisted, audited and permission checked without changing units, leases or debt',async()=>{
 const types={};
 for(const property_type of ['building','house','rest_house']){
  const result=await call('assistant','POST','/api/entities',{kind:'property',property_type,name:'عقار اختبار '+property_type,electricity_meter:'000123'});
  assert.equal(result.code,201);types[property_type]=result.data.id;
 }
 for(const property_type of ['villa','',null]){
  const expected=property_type==='villa'?400:201;
  assert.equal((await call('assistant','POST','/api/entities',{kind:'property',property_type,name:'توافق نسخة قديمة'})).code,expected);
 }
 for(const kind of ['unit','car','worker'])assert.equal((await call('assistant','POST','/api/entities',{kind,property_type:'house',name:'نوع غير مقبول'})).code,400);
 const unit=(await call('assistant','POST','/api/entities',{kind:'unit',parent_id:types.house,name:'البيت كاملًا'})).data.id;
 const today=(await call('assistant','GET','/api/bootstrap')).data.today;
 const rent=(await call('assistant','POST','/api/agreements',{kind:'rent',entity_id:unit,title:'إيجار البيت',start_date:today,end_date:addMonths(today,1),first_due_date:today,total:'100'})).data.id;
 assert.equal((await call('assistant','POST',`/api/agreements/${rent}/payments`,{slot:0,amount:'40',paid_at:today})).code,201);
 const financialBefore={agreement:(await one('SELECT * FROM agreements WHERE id=?',rent)),payments:(await rows('SELECT * FROM payments WHERE agreement_id=?',rent))};
 assert.equal((await call('manager','PATCH','/api/entities/'+types.house,{property_type:'rest_house'},{workMode:false})).code,403);
 assert.equal((await call('assistant','PATCH','/api/entities/'+types.house,{property_type:'rest_house'})).code,200);
 const boot=(await call('assistant','GET','/api/bootstrap')).data;
 assert.equal(boot.entities.find(e=>e.id===types.house).property_type,'rest_house');
 assert.equal(boot.entities.find(e=>e.id===types.house).electricity_meter,'000123');
 assert.equal(boot.entities.find(e=>e.id===unit).parent_id,types.house);
 assert.equal(boot.entities.find(e=>e.id===unit).status,'rented');
 assert.deepEqual((await one('SELECT * FROM agreements WHERE id=?',rent)),financialBefore.agreement);
 assert.deepEqual((await rows('SELECT * FROM payments WHERE agreement_id=?',rent)),financialBefore.payments);
 assert.equal(project(financialBefore.agreement,financialBefore.payments).remaining_cents,6000);
 assert.ok((await rows('SELECT after_json FROM audit WHERE target_id=?',types.house)).some(row=>JSON.parse(row.after_json)?.property_type==='rest_house'));
});

test('Real API backup restores into a separate PostgreSQL database and preserves balances, occupancy, guards and retry safety',async()=>{
 const body={request_id:crypto.randomUUID(),database_generation:(await one('SELECT generation FROM restore_control WHERE id=1')).generation,kind:'car',name:'اختبار إيصال الاستعادة'};
 const created=await call('assistant','POST','/api/entities',body);assert.equal(created.code,201);
 const backup=(await call('manager','GET','/api/backup')).data;
 assert.equal((await verifyBackup(backup,{forRestore:true})).checksum,'verified');
 assert.ok(backup.agreements.some(a=>a.vacated_at));
 assert.ok(backup.agreements.some(a=>a.closed_at));
 assert.ok(backup.payments.some(p=>p.active===0));
 assert.ok(backup.entities.some(e=>e.archived===1));
 assert.ok(backup.hidden_audit.length>0);assert.ok(backup.dismissed_alerts.length>0);
 const source=canonicalJSON(backup);
 const recovered=await createPostgresFixture();
 try {
  const request=(path,method='GET',payload,role='manager')=>new Request('https://wallet.example.com'+path,{method,headers:{'Cf-Access-Jwt-Assertion':token(role),Origin:'https://wallet.example.com','Content-Type':'application/json','X-Wallet-Action':'1','X-Wallet-Mode':'assistant'},...(payload?{body:JSON.stringify(payload)}:{})});
  const recoveredEnv={...env,DATABASE_URL:recovered.connectionString};
  const preview=await worker.fetch(request('/api/backup/preview','POST',{backup}),recoveredEnv);
  assert.equal(preview.status,200);const plan=await preview.json();assert.equal(plan.ok,true);
  const saved=await worker.fetch(request('/api/backup/restore','POST',{backup,checkpoint:plan.checkpoint,confirmation:'استعادة',request_id:crypto.randomUUID()}),recoveredEnv);
  assert.equal(saved.status,200,await saved.text());
  assert.equal(canonicalJSON(backup),source,'source snapshot must stay unchanged');
  const before=(await call('assistant','GET','/api/bootstrap')).data;
  const response=await worker.fetch(request('/api/bootstrap','GET',undefined,'assistant'),recoveredEnv);assert.equal(response.status,200);
  const after=await response.json();
  for(const key of ['summary','payment_contexts'])assert.equal(canonicalJSON(after[key]),canonicalJSON(before[key]),key);
  for(const key of ['entities','agreements','payments','expenses','tasks','dues','alerts']){
   const ordered=rows=>rows.map(canonicalJSON).sort();assert.deepEqual(ordered(after[key]),ordered(before[key]),key);
  }
  const counts=async()=>({entities:(await recovered.one('SELECT count(*) AS n FROM entities')).n,audit:(await recovered.one('SELECT count(*) AS n FROM audit')).n});
  const rowsBefore=await counts();
  const retried=await worker.fetch(request('/api/entities','POST',body,'assistant'),recoveredEnv);
  assert.equal(retried.status,409,'restoration invalidates forms from the source generation');
  assert.deepEqual(await counts(),rowsBefore,'a stale retry must not duplicate an operation after recovery');
  await assert.rejects(()=>recovered.run("UPDATE audit SET action='rewritten'"),/immutable/);
  const closed=backup.agreements.find(a=>a.closed_at);
  await assert.rejects(()=>recovered.run("UPDATE agreements SET title='rewritten' WHERE id=?",closed.id),/closed/);
  const receipt=backup.payments.find(p=>p.active===1&&backup.agreements.some(a=>a.id===p.agreement_id&&!a.closed_at));
  await assert.rejects(()=>recovered.run('UPDATE payments SET observed_version=-100 WHERE id=?',receipt.id),/stale/);
 }finally{await recovered.close()}
});
