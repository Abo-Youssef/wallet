import {test} from 'node:test';
import assert from 'node:assert/strict';
import {project,currentSummary,addMonths,splitEvenly,parseMoney,distributeCapped} from '../src/shared/finance.mjs';
const base={id:'a1',kind:'purchase',direction:'out',title:'سيارة',first_due_date:'2026-10-20',frequency_months:1,total_cents:12000000,opening_cents:6000000,installment_count:24,status:'active'};
const entry=(id,amount_cents,slot_index=0,reschedule_method=null,paid_at='2026-10-15')=>({id,amount_cents,slot_index,reschedule_method,paid_at,active:1,agreement_id:'a1',created_at:`2026-10-15T${id==='p1'?'10':'11'}:00:00Z`});
test('Opening paid is reference only; future totals stay balanced',()=>{const p=project(base);assert.equal(p.paid_total_cents,6000000);assert.equal(p.remaining_cents,6000000);assert.equal(p.rows[0].remaining_cents,250000);});
test('A normal payment closes current slot and reduces total once',()=>{const p=project(base,[entry('p1',250000)]);assert.equal(p.rows[0].remaining_cents,0);assert.equal(p.remaining_cents,5750000);assert.equal(p.paid_total_cents,6250000)});
test('A partial payment leaves only the remaining obligation open, no partial status',()=>{const p=project(base,[entry('p1',100000)]);assert.equal(p.rows[0].remaining_cents,150000);assert.equal(p.remaining_cents,5900000)});
test('Early execution date is separate from scheduled date',()=>{const p=entry('p1',250000,0,null,'2026-09-18');const data=currentSummary([base],[p],[],'2026-09','2026-09-20');assert.equal(data.summary.cash_out,250000);assert.equal(data.summary.due_out,0);const oct=currentSummary([base],[p],[],'2026-10','2026-10-15');assert.equal(oct.summary.due_out,250000);assert.equal(oct.summary.fulfilled_out,250000);assert.equal(oct.summary.cash_out,0)});
test('Overpay shortening retains normal installment value and removes tail first',()=>{const p=project(base,[entry('p1',500000,0,'shorten')]);assert.equal(p.rows[0].remaining_cents,0);assert.equal(p.rows[1].remaining_cents,250000);assert.equal(p.rows[23].remaining_cents,0);assert.equal(p.rows.filter(r=>r.remaining_cents>0).length,22);assert.equal(p.remaining_cents,5500000)});
test('Overpay spreading retains number of periods and lowers future amount',()=>{const p=project(base,[entry('p1',500000,0,'spread')]);assert.equal(p.rows.filter(r=>r.remaining_cents>0).length,23);assert.ok(p.rows[1].remaining_cents<250000);assert.equal(p.remaining_cents,5500000)});
test('After overpay, next installment payment works normally',()=>{const p=project(base,[entry('p1',500000,0,'spread'),entry('p2',239130,1,null,'2026-11-20')]);assert.equal(p.remaining_cents,5500000-239130);});
test('Deleting or editing a payment reconstructs schedule cleanly',()=>{const payment=entry('p1',500000,0,'shorten');const old=project(base,[payment]);const voided=project(base,[{...payment,active:0}]);const corrected=project(base,[{...payment,amount_cents:250000,reschedule_method:null}]);assert.equal(old.remaining_cents,5500000);assert.equal(voided.remaining_cents,6000000);assert.equal(voided.rows.at(-1).remaining_cents,250000);assert.equal(corrected.remaining_cents,5750000)});
test('Cannot overpay full outstanding or wrong slot',()=>{assert.throws(()=>project(base,[entry('p1',6000001,0,'shorten')]),/يتجاوز/);assert.throws(()=>project(base,[entry('p1',2000,100)]),/غير موجود/)});
test('Extra requires explicit rescheduling method',()=>{assert.throws(()=>project(base,[entry('p1',300000,0,null)]),/اختر/)});
test('Single-month rental needs only one collection',()=>{const a={...base,kind:'rent',direction:'in',total_cents:300000,opening_cents:0,installment_count:1,first_due_date:'2026-11-01'};const p=project(a);assert.equal(p.rows.length,1);assert.equal(p.rows[0].due_date,'2026-11-01')});
test('Cashflow includes direct expense and excludes opening capital',()=>{const d=currentSummary([base],[entry('p1',250000)], [{id:'e1',direction:'out',amount_cents:200000,paid_at:'2026-10-15',active:1}], '2026-10','2026-10-15');assert.equal(d.summary.cash_out,450000);assert.equal(d.summary.due_out,250000);assert.equal(d.summary.net,-450000)});
test('Cents add up with nondivisible principal and clamped dates',()=>{assert.deepEqual(splitEvenly(100,3),[33,33,34]);assert.equal(addMonths('2026-01-31',1),'2026-02-28');assert.equal(addMonths('2026-01-31',2),'2026-03-31');assert.equal(parseMoney('123.45'),12345)});

test('Spreading never increases a later partly paid installment',()=>{
 const a={...base,total_cents:120000,opening_cents:0,installment_count:3};
 const first=entry('p1',35000,1),before=project(a,[first]);
 const after=project(a,[first,entry('p2',50000,0,'spread')]);
 assert.equal(before.rows[1].remaining_cents,5000);
 assert.equal(after.rows[1].remaining_cents,5000);assert.equal(after.rows[2].remaining_cents,30000);
 assert.equal(after.remaining_cents,35000);
 assert.equal(after.payment_contexts.p1.expected_cents,40000);
 assert.equal(after.payment_contexts.p2.expected_cents,40000);
});
test('Capped redistribution conserves every halala without increasing any slot',()=>{
 let seed=42;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n};
 for(let n=0;n<1000;n++){
  const caps=Array.from({length:1+rand(30)},()=>rand(100000));const total=caps.reduce((a,b)=>a+b,0),target=rand(total+1);
  const parts=distributeCapped(target,caps);
  assert.equal(parts.reduce((a,b)=>a+b,0),target);assert.ok(parts.every((x,i)=>Number.isSafeInteger(x)&&x>=0&&x<=caps[i]));
 }
});
test('Money and schedule boundaries reject ambiguity and overflow',()=>{
 for(const value of [true,{},[],null,'1e3','-1','1.001'])assert.throws(()=>parseMoney(value));
 assert.equal(parseMoney('99999999999.99'),9999999999999);
 assert.throws(()=>project({...base,first_due_date:'9999-12-01'}),/نهاية الجدولة/);
 assert.throws(()=>addMonths('0099-12-01',1));
});

test('Schedule confirmation describes partial, shorten, spread and settlement without rewriting rental dates',()=>{
 const agreement={...base,kind:'rent',start_date:'2026-01-01',end_date:'2026-12-31',first_due_date:'2026-01-01',total_cents:30000,opening_cents:0,installment_count:3};
 for(const [amount,method,end] of [[4000,null,'2026-03-01'],[20000,'shorten','2026-02-01'],[15000,'spread','2026-03-01'],[30000,'shorten','2026-01-10']]){
  const payment={...entry('p1',amount,0,method,'2026-01-10'),schedule_end_date:end};
  const result=project(agreement,[payment]);
  assert.equal(result.schedule_end_date,end);assert.equal(result.payment_contexts.p1.schedule_end_date,end);
  assert.equal(result.remaining_cents+result.paid_total_cents,30000);
  assert.equal(agreement.end_date,'2026-12-31');assert.equal(result.original_schedule_end_date,'2026-03-01');
  assert.throws(()=>project(agreement,[{...payment,schedule_end_date:'2027-01-01'}]),/تاريخ نهاية الجدولة/);
 }
});

test('Historical undated payments replay unchanged, while edits cannot invalidate a later confirmed schedule silently',()=>{
 const agreement={...base,first_due_date:'2026-01-01',total_cents:30000,opening_cents:0,installment_count:3};
 const legacy=entry('p1',5000,0,null,'2026-01-01');
 assert.equal(project(agreement,[legacy]).remaining_cents,25000);
 const later={...entry('p2',15000,0,'shorten','2026-01-10'),schedule_end_date:'2026-02-01'};
 assert.equal(project(agreement,[legacy,later]).remaining_cents,10000);
 assert.throws(()=>project(agreement,[{...legacy,amount_cents:4000},later]),/تاريخ نهاية الجدولة/);
});
