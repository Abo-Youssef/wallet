import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectBackup} from '../src/integrity.mjs';
const empty=()=>Object.fromEntries(['entities','agreements','payments','expenses','tasks','audit','hidden_audit','dismissed_alerts'].map(k=>[k,[]]));
const agreement={id:'a',kind:'other',status:'active',direction:'out',entity_id:null,total_cents:120000,opening_cents:0,first_due_date:'2026-01-01',installment_count:3,frequency_months:1};
test('Read-only preflight catches historical payments invalid under corrected spreading',()=>{
 const data=empty();data.agreements=[agreement];
 const pay=(id,slot_index,amount_cents,reschedule_method=null)=>({id,request_id:id,agreement_id:'a',active:1,slot_index,amount_cents,reschedule_method,paid_at:'2026-01-01',created_at:'2026-01-01T00:00:0'+id.slice(1)+'.000Z'});
 data.payments=[pay('p1',1,35000),pay('p2',0,50000,'spread'),pay('p3',1,17500)];
 const before=JSON.stringify(data),report=inspectBackup(data);
 assert.equal(report.ok,false);assert.ok(report.issues.some(x=>x.table==='agreements'&&x.id==='a'&&x.reason.includes('إعادة حساب')));
 assert.equal(JSON.stringify(data),before);
 data.payments.pop();assert.equal(inspectBackup(data).ok,true);
});
test('Preflight reports missing tables, duplicate identities, invalid links and overlapping rents',()=>{
 assert.equal(inspectBackup(null).ok,false);assert.equal(inspectBackup({}).ok,false);
 const data=empty();data.entities=[{id:'u',kind:'unit',archived:0}];
 const rent={...agreement,kind:'rent',direction:'in',entity_id:'u',installment_count:1,start_date:'2026-01-01',end_date:'2026-01-31'};
 data.agreements=[rent,{...rent,id:'b'}];data.entities.push({id:'w',kind:'worker',archived:0});
 data.expenses=[{id:'x',entity_id:'w',active:1,direction:'out',amount_cents:100,paid_at:'2026-01-02'}];
 data.hidden_audit=[{audit_id:'missing'}];data.tasks=[{id:'t',state:'open',assigned_to:'assistant'},{id:'t',state:'done',assigned_to:'assistant'}];
 const report=inspectBackup(data);assert.equal(report.ok,false);
 for(const text of ['متداخل','المصروف','تدقيق','مكرر'])assert.ok(report.issues.some(x=>x.reason.includes(text)));
});
