import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import worker from '../src/server/worker.mjs';
import {BACKUP_TABLES,canonicalJSON} from '../src/server/backup.mjs';
import {readRestoredRows} from '../scripts/restore-backup.mjs';
import {project} from '../src/shared/finance.mjs';
import {restHouseAvailability} from '../src/shared/unit-status.mjs';
import {prepareRestore} from '../scripts/restore-backup.mjs';
import {createPostgresFixture} from './pg-fixture.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'restore-test',alg:'RS256',use:'sig'};
globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}));
function token(role){
  const t=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const data=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:'https://restore-test.cloudflareaccess.com',aud:['restore-test'],email:role+'@example.test',exp:t+600,nbf:t-1});
  return data+'.'+createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url');
}
async function fixture(){
  const pg=await createPostgresFixture();
  const env={DATABASE_URL:pg.connectionString,ACCESS_TEAM_DOMAIN:'restore-test.cloudflareaccess.com',ACCESS_AUD:'restore-test',MANAGER_EMAIL:'manager@example.test',ASSISTANT_EMAIL:'assistant@example.test'};
  const generation=async()=>(await pg.one('SELECT generation FROM restore_control WHERE id=1')).generation;
  async function call(path,body,{role='assistant',working=true,origin='https://restore.test',method:chosenMethod}={}){
    const method=chosenMethod ?? (body===undefined?'GET':'POST');
    const headers={'Cf-Access-Jwt-Assertion':token(role),'Content-Type':'application/json','Origin':origin,'X-Wallet-Action':'1'};
    if(working)headers['X-Wallet-Mode']='assistant';
    const response=await worker.fetch(new Request('https://restore.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify({request_id:crypto.randomUUID(),database_generation:await generation(),...body})}),env);
    return {code:response.status,data:await response.json()};
  }
  return {...pg,env,call,generation};
}

const dayAfter=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
async function setupBooking(f) {
  const today=(await f.call('/api/bootstrap')).data.today;
  const r=await f.call('/api/entities',{kind:'property',property_type:'rest_house',name:'استراحة اختبار'});
  assert.equal(r.code,201,JSON.stringify(r));
  return {today,property:r.data.id,body:{entity_id:r.data.id,day:today,counterparty:'مستأجر تجريبي',phone:'0500012345',total:'1000'}};
}
const row=(f,id)=>f.one('SELECT * FROM agreements WHERE id=?',id);
const primaryKey=table=>({hidden_audit:'audit_id',dismissed_alerts:'alert_key',mutation_requests:'request_id'}[table]??'id');
const databaseRows=async f=>f.db.transaction(async()=>{
  const values=[];
  for(const table of BACKUP_TABLES)values.push([table,await f.rows(`SELECT * FROM ${table} ORDER BY ${primaryKey(table)}`)]);
  return Object.fromEntries(values);
},{readOnly:true});
const snapshot=async f=>canonicalJSON(await databaseRows(f));
const availability=async(f,property,day)=>{
  const {data}=await f.call('/api/bootstrap');
  return restHouseAvailability(data.entities.find(e=>e.id===property),data.entities,data.agreements,day,data.today);
};

test('Daily booking: selected date only, leading zero phone, conflict rejection, next day and separate rest house',async()=>{
  const f=await fixture();try{
    const {today,property,body}=await setupBooking(f);
    assert.equal((await availability(f,property,today)).status,'available');
    const r=await f.call('/api/bookings',body);assert.equal(r.code,201,JSON.stringify(r));
    assert.equal((await row(f,r.data.id)).phone,'0500012345');
    assert.equal((await availability(f,property,today)).status,'rented');
    assert.equal((await availability(f,property,dayAfter(today,1))).status,'available');
    const before=await snapshot(f);
    assert.equal((await f.call('/api/bookings',body)).code,400);assert.equal(await snapshot(f),before);
    assert.equal((await f.call('/api/bookings',{...body,day:dayAfter(today,1)})).code,201);
    const second=await setupBooking(f);assert.equal((await f.call('/api/bookings',second.body)).code,201);
    const data=(await f.call('/api/bootstrap')).data;
    assert.ok(!data.alerts.some(a=>a.key.startsWith('rent:')));
    assert.equal(data.dues.find(d=>d.agreement_id===r.data.id).amount_cents,100000);
  }finally{await f.close();}
});

test('Concurrent PostgreSQL booking requests serialize availability and retain one reservation, receipt and audit',async()=>{
  const f=await fixture();try{
    const {body}=await setupBooking(f);
    const responses=await f.race(()=>[
      f.call('/api/bookings',body),
      f.call('/api/bookings',{...body,counterparty:'الجهاز الآخر'}),
    ]);
    assert.deepEqual(responses.map(response=>response.code).sort(),[201,400],JSON.stringify(responses));
    assert.equal((await f.one('SELECT count(*) n FROM agreements')).n,1);
    assert.equal((await f.one("SELECT count(*) n FROM audit WHERE action='حجز يومي'")).n,1);
    assert.equal((await f.one("SELECT count(*) n FROM mutation_requests WHERE scope='POST /api/bookings'")).n,1);
  }finally{await f.close();}
});

test('Cancellation requires confirmation and reason, preserves paid cash/debt, retry is once and day can be rebooked',async()=>{
  const f=await fixture();try{
    const {today,property,body}=await setupBooking(f);
    const r=await f.call('/api/bookings',body),id=r.data.id;
    assert.equal((await f.call('/api/agreements/'+id+'/payments',{slot:0,amount:'400',paid_at:today,schedule_end_date:today,expected_version:0})).code,201);
    const unchanged=await snapshot(f);
    for(const bad of [{note:'سبب',expected_version:1},{confirm_cancellation:true,expected_version:1}]){
      assert.equal((await f.call('/api/bookings/'+id+'/cancel',bad)).code,400);
      assert.equal(await snapshot(f),unchanged);
    }
    const cancel={note:'طلب المستأجر',confirm_cancellation:true,expected_version:1,request_id:crypto.randomUUID()};
    const result=await f.call('/api/bookings/'+id+'/cancel',cancel);assert.equal(result.code,200,JSON.stringify(result));
    assert.equal((await f.call('/api/bookings/'+id+'/cancel',cancel)).data.idempotent,true);
    assert.equal((await availability(f,property,today)).status,'available');
    const a=await row(f,id),payments=await f.rows('SELECT * FROM payments WHERE agreement_id=?',id),p=project(a,payments);
    assert.equal(a.status,'active');assert.equal(a.total_cents,100000);
    assert.equal(p.paid_total_cents,40000);assert.equal(p.remaining_cents,60000);
    const data=(await f.call('/api/bootstrap')).data;
    assert.equal(data.summary.cash_in,40000);assert.equal(data.dues.find(d=>d.agreement_id===id).amount_cents,60000);
    assert.equal((await f.one("SELECT count(*) n FROM audit WHERE action='إلغاء حجز يومي'")).n,1);
    const audit=await f.one("SELECT * FROM audit WHERE action='إلغاء حجز يومي'");
    assert.equal(audit.actor,'assistant@example.test');assert.equal(JSON.parse(audit.after_json).remaining_cents,60000);
    assert.equal((await f.call('/api/bookings',body)).code,201);
    // Collecting the old debt never changes the new reservation.
    assert.equal((await f.call('/api/agreements/'+id+'/payments',{slot:0,amount:'600',paid_at:today,expected_version:2})).code,201);
    assert.equal((await f.call('/api/agreements/'+id+'/close',{expected_version:3})).code,200);
    assert.equal((await f.call('/api/agreements/'+id+'/reopen',{expected_version:4})).code,200);
    assert.equal((await availability(f,property,today)).status,'rented');
    assert.equal((await row(f,id)).booking_cancel_note,'طلب المستأجر');
  }finally{await f.close();}
});

test('Daily booking permissions and immutable identity prevent alternate cancel/edit/vacate/close routes',async()=>{
  const f=await fixture();try{
    const {body,today}=await setupBooking(f);
    assert.equal((await f.call('/api/bookings',body,{role:'manager',working:false})).code,403);
    assert.equal((await f.call('/api/bookings',body,{role:'outsider'})).code,403);
    for(const bad of [{...body,day:dayAfter(today,-1)},{...body,total:'0'},{...body,day:'2026-02-30'},{...body,counterparty:''}])
      assert.equal((await f.call('/api/bookings',bad)).code,400);
    const r=await f.call('/api/bookings',body,{role:'manager'}),id=r.data.id;
    assert.equal(r.code,201);assert.equal((await row(f,id)).created_by,'manager@example.test');
    assert.equal((await f.call('/api/agreements/'+id,{expected_version:0},{method:'DELETE'})).code,400);
    assert.equal((await f.call('/api/agreements/'+id,{expected_version:0,total:'500'},{method:'PATCH'})).code,400);
    assert.equal((await f.call('/api/agreements/'+id+'/vacate',{expected_version:0,confirm_vacancy:true,vacated_on:today})).code,400);
    assert.equal((await f.call('/api/agreements/'+id+'/payments',{expected_version:0,slot:0,amount:'1000',paid_at:today})).code,201);
    assert.equal((await f.call('/api/agreements/'+id+'/close',{expected_version:1})).code,400);
    assert.equal((await f.call('/api/bookings/'+id+'/cancel',{expected_version:0,confirm_cancellation:true,note:'نسخة قديمة'})).code,409);
    assert.equal((await availability(f,body.entity_id,today)).status,'rented');
    await assert.rejects(f.run("UPDATE agreements SET booking_cancelled_at='x',booking_cancelled_by='x' WHERE id=?",id),/invalid daily booking/);
  }finally{await f.close();}
});

test('Concurrent payment and cancellation accept one version and reject the stale request without partial changes',async()=>{
  const f=await fixture();try{
    const {body,today,property}=await setupBooking(f);
    const id=(await f.call('/api/bookings',body)).data.id;
    const [payment,cancellation]=await f.race(()=>[
      f.call('/api/agreements/'+id+'/payments',{expected_version:0,amount:'1000',paid_at:today,slot:0}),
      f.call('/api/bookings/'+id+'/cancel',{expected_version:0,note:'إلغاء قبل تحديث الرصيد',confirm_cancellation:true}),
    ]);
    const agreement=await row(f,id),payments=await f.rows('SELECT * FROM payments');
    assert.equal(agreement.version,1);
    if(payment.code===201){
      assert.equal(cancellation.code,409,JSON.stringify(cancellation));
      assert.equal((await availability(f,property,today)).status,'rented');
      assert.equal(agreement.booking_cancelled_at,null);
      assert.equal((await f.one("SELECT count(*) n FROM audit WHERE action='إلغاء حجز يومي'")).n,0);
      assert.equal(project(agreement,payments).remaining_cents,0);
    }else{
      assert.equal(payment.code,409,JSON.stringify(payment));
      assert.equal(cancellation.code,200,JSON.stringify(cancellation));
      assert.equal((await availability(f,property,today)).status,'available');
      assert.ok(agreement.booking_cancelled_at);
      assert.equal(payments.length,0);
      assert.equal(project(agreement,payments).remaining_cents,100000);
      assert.equal((await f.one("SELECT count(*) n FROM audit WHERE action='إلغاء حجز يومي'")).n,1);
    }
  }finally{await f.close();}
});

test('Whole rest house reservations conflict with its unit rentals in both directions, respect personal use and preserve periodic vacancy rules',async()=>{
  const f=await fixture();try{
    const {body,today,property}=await setupBooking(f);
    const u=await f.call('/api/entities',{kind:'unit',parent_id:property,name:'الاستراحة بالكامل',status:'personal_use'});
    assert.equal((await f.call('/api/bookings',body)).code,400);
    assert.equal((await availability(f,property,today)).status,'personal_use');
    await f.call('/api/entities/'+u.data.id,{status:'available',expected_version:0},{method:'PATCH'});
    const rental={kind:'rent',entity_id:u.data.id,title:'إيجار سابق',total:'1000',count:1,frequency:1,first_due_date:dayAfter(today,-3),start_date:dayAfter(today,-3),end_date:dayAfter(today,-1)};
    const r=await f.call('/api/agreements',rental);assert.equal(r.code,201,JSON.stringify(r));
    assert.equal((await f.call('/api/bookings',body)).code,400);
    await f.call('/api/agreements/'+r.data.id+'/vacate',{expected_version:0,confirm_vacancy:true,vacated_on:today});
    assert.equal((await f.call('/api/bookings',body)).code,201);
    assert.equal((await f.call('/api/entities',{kind:'unit',parent_id:property,name:'وحدة جديدة غير متاحة',status:'personal_use'})).code,409);
    assert.equal((await f.call('/api/agreements',{...rental,start_date:today,end_date:today,first_due_date:today})).code,400);
    const data=(await f.call('/api/bootstrap')).data;
    assert.equal(data.entities.find(e=>e.id===u.data.id).status,'rented');
    assert.equal((await f.call('/api/entities/'+u.data.id,{status:'maintenance',expected_version:1},{method:'PATCH'})).code,409);
    assert.equal((await f.call('/api/entities/'+property,{property_type:'house',expected_version:0},{method:'PATCH'})).code,409);
    assert.equal(project(await row(f,r.data.id),[]).remaining_cents,100000);
  }finally{await f.close();}
});

test('Bookings and cancelled balances remain compatible with legacy export tools and PostgreSQL atomic restore',async()=>{
  const f=await fixture();try{
    const {body,today,property}=await setupBooking(f);
    const id=(await f.call('/api/bookings',body)).data.id;
    await f.call('/api/agreements/'+id+'/payments',{slot:0,amount:'400',paid_at:today,schedule_end_date:today,expected_version:0});
    await f.call('/api/bookings/'+id+'/cancel',{expected_version:1,confirm_cancellation:true,note:'إلغاء تجريبي'});
    await f.call('/api/bookings',body);
    const backup=(await f.call('/api/backup',undefined,{role:'manager'})).data;
    const offline=await prepareRestore(backup);
    try{assert.equal(canonicalJSON(readRestoredRows(offline.db)),canonicalJSON(await databaseRows(f)));}finally{offline.db.close();}
    const preview=await f.call('/api/backup/preview',{backup},{role:'manager'});assert.equal(preview.data.ok,true,JSON.stringify(preview));
    const result=await f.call('/api/backup/restore',{backup,checkpoint:preview.data.checkpoint,confirmation:'استعادة'},{role:'manager'});
    assert.equal(result.code,200,JSON.stringify(result));
    assert.equal(project(await row(f,id),await f.rows('SELECT * FROM payments WHERE agreement_id=?',id)).remaining_cents,60000);
    assert.equal((await availability(f,property,today)).status,'rented');
  }finally{await f.close();}
});
