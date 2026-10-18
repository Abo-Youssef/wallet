import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectBackup} from '../src/server/integrity.mjs';

const empty=()=>Object.fromEntries(['entities','agreements','payments','expenses','tasks','audit','hidden_audit','dismissed_alerts'].map(key=>[key,[]]));
const rent={id:'rent',kind:'rent',status:'active',direction:'in',entity_id:'unit',total_cents:120000,opening_cents:0,start_date:'2026-01-01',end_date:'2026-03-31',first_due_date:'2026-01-01',installment_count:3,frequency_months:1};
function backup(overrides={}){
  const data=empty();
  data.entities=[{id:'unit',kind:'unit',archived:0}];
  data.agreements=[{...rent,...overrides}];
  return data;
}

test('Backup preflight rejects first or final rental dues outside the contract',()=>{
  const cases=[
    [{first_due_date:'2025-12-31'},'أول استحقاق'],
    [{first_due_date:'2026-04-01'},'أول استحقاق'],
    [{end_date:'2026-02-28'},'آخر استحقاق'],
    [{first_due_date:'2026-01-31',end_date:'2026-03-30'},'آخر استحقاق']
  ];
  for(const [changes,reason] of cases){
    const data=backup(changes),before=JSON.stringify(data),report=inspectBackup(data);
    assert.equal(report.ok,false,JSON.stringify(changes));
    assert.ok(report.issues.some(issue=>issue.table==='agreements'&&issue.id==='rent'&&issue.reason.includes(reason)),JSON.stringify(report));
    assert.equal(JSON.stringify(data),before,'The preflight must not repair or mutate records');
  }
});

test('Backup preflight accepts inclusive rental boundaries and clamped monthly dates',()=>{
  const cases=[
    {start_date:'2026-01-01',end_date:'2026-01-01',first_due_date:'2026-01-01',installment_count:1},
    {start_date:'2026-01-01',end_date:'2026-01-31',first_due_date:'2026-01-31',installment_count:1},
    {start_date:'2026-01-31',end_date:'2026-02-28',first_due_date:'2026-01-31',installment_count:2},
    {start_date:'2028-01-31',end_date:'2028-02-29',first_due_date:'2028-01-31',installment_count:2},
    {start_date:'2026-01-31',end_date:'2026-04-30',first_due_date:'2026-01-31',installment_count:2,frequency_months:3},
    {start_date:'9999-12-31',end_date:'9999-12-31',first_due_date:'9999-12-31',installment_count:1}
  ];
  for(const changes of cases)assert.deepEqual(inspectBackup(backup(changes)).issues,[],JSON.stringify(changes));
  const leapTooShort=inspectBackup(backup({start_date:'2028-01-31',end_date:'2028-02-28',first_due_date:'2028-01-31',installment_count:2}));
  assert.ok(leapTooShort.issues.some(issue=>issue.reason.includes('آخر استحقاق')));
});

test('Backup preflight still checks the original rental end after early full payment',()=>{
  const data=backup({end_date:'2026-01-31'});
  data.payments=[{id:'payment',request_id:'payment',agreement_id:'rent',slot_index:0,amount_cents:120000,paid_at:'2026-01-01',reschedule_method:'shorten',active:1,created_at:'2026-01-01T09:00:00.000Z'}];
  const report=inspectBackup(data);
  assert.equal(report.ok,false);
  assert.ok(report.issues.some(issue=>issue.reason.includes('آخر استحقاق')));
});

test('Backup preflight rejects noninteger agreement money without tightening legacy amount limits',()=>{
  for(const [field,value] of [['total_cents',null],['opening_cents',null],['total_cents','120000'],['opening_cents','0'],['total_cents',120000.5]]){
    const report=inspectBackup(backup({[field]:value}));
    assert.equal(report.ok,false);
    assert.ok(report.issues.some(issue=>issue.reason.includes('قيمة مالية غير صحيحة: '+field)),JSON.stringify(report));
  }
  assert.equal(inspectBackup(backup({total_cents:10000000000001})).ok,true,'Keep safe integer amounts from older exports');
});

test('Legacy backup fields stay optional and voided payment history survives later schedule changes',()=>{
  const data=backup({installment_count:1,end_date:'2026-01-31'});
  data.payments=[{id:'voided',request_id:'voided',agreement_id:'rent',slot_index:2,amount_cents:40000,paid_at:'2026-01-02',reschedule_method:null,active:0,created_at:'2026-01-02T09:00:00.000Z'}];
  assert.equal('format_version' in data,false);
  assert.equal('mutation_requests' in data,false);
  assert.equal('version' in data.agreements[0],false);
  assert.deepEqual(inspectBackup(data).issues,[]);
});

test('Invalid rent dates and schedule overflow return issues without throwing',()=>{
  for(const changes of [
    {start_date:'2026-02-30'},
    {end_date:'2025-12-31'},
    {first_due_date:'not-a-date'},
    {start_date:'9999-12-01',end_date:'9999-12-31',first_due_date:'9999-12-01',installment_count:2}
  ])assert.equal(inspectBackup(backup(changes)).ok,false,JSON.stringify(changes));
});

const closedRent={closed_at:'2026-04-01T00:00:00.000Z',closed_by:'assistant@example.com',opening_cents:120000};

test('Closed agreements retain payment history and may link to an archived asset',()=>{
  const data=backup({...closedRent,opening_cents:0});
  data.entities[0].archived=1;
  data.payments=[{id:'paid',request_id:'paid',agreement_id:'rent',slot_index:0,amount_cents:120000,paid_at:'2026-01-01',reschedule_method:'shorten',active:1,created_at:'2026-01-01T09:00:00.000Z'}];
  const before=JSON.stringify(data);
  assert.deepEqual(inspectBackup(data).issues,[]);
  assert.equal(JSON.stringify(data),before);
  data.agreements[0].closed_at=null;data.agreements[0].closed_by=null;
  assert.ok(inspectBackup(data).issues.some(issue=>issue.reason.includes('ارتباط مالي')),'An open agreement still requires a live asset');
});

test('Backup preflight checks closure metadata and the fully paid invariant',()=>{
  for(const changes of [
    {closed_at:'2026-04-01T00:00:00.000Z'},
    {closed_by:'assistant@example.com'},
    {...closedRent,closed_by:''},
    {...closedRent,closed_at:'not-a-timestamp'},
    {...closedRent,closed_at:'2026-02-30T00:00:00.000Z'},
    {...closedRent,status:'cancelled'},
    {...closedRent,opening_cents:119999}
  ])assert.equal(inspectBackup(backup(changes)).ok,false,JSON.stringify(changes));
  assert.deepEqual(inspectBackup(backup({closed_at:null,closed_by:null})).issues,[]);
  assert.deepEqual(inspectBackup(backup(closedRent)).issues,[]);
});

test('Rental closure uses the day after contract expiry in Riyadh',()=>{
  const changes={...closedRent,end_date:'2026-01-31',installment_count:1};
  for(const closed_at of ['2026-01-30T22:00:00.000Z','2026-01-31T20:59:59.999Z']){
    const report=inspectBackup(backup({...changes,closed_at}));
    assert.ok(report.issues.some(issue=>issue.reason.includes('قبل انتهاء مدته')),closed_at);
  }
  assert.deepEqual(inspectBackup(backup({...changes,closed_at:'2026-01-31T21:00:00.000Z'})).issues,[]);
});

test('Closed rentals do not block new periods, while reopening restores overlap validation',()=>{
  const data=backup(closedRent);
  data.agreements.push({...rent,id:'second-rent'});
  assert.deepEqual(inspectBackup(data).issues,[]);
  data.agreements[0].closed_at=null;data.agreements[0].closed_by=null;
  assert.ok(inspectBackup(data).issues.some(issue=>issue.reason.includes('متداخل')));
});
