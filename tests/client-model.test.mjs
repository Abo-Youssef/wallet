import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inputCents} from '../src/shared/numerals.mjs';
import {parseMoney} from '../src/shared/finance.mjs';
import {normalizeSearch,selectDataRecords,agreementPayments,alertDestination,buildMonthStatement,entityReference,formatRiyadhDate} from '../src/shared/client-model.mjs';
import {statementCSV,statementHTML} from '../src/shared/statements.mjs';

test('Money input comparisons agree with server halalas without floating-point overpayment',()=>{
 for(const value of ['0','0.01','1.10','2.20','34.80','1200.35','99999999.99'])assert.equal(inputCents(value),parseMoney(value));
 assert.equal(inputCents('1.10'),110);assert.equal(inputCents('1.11'),111);
 for(const value of ['','1.001','-1','1e2','Infinity','1000000000000'])assert.throws(()=>inputCents(value));
});

test('Shared search finds hidden identifiers, Arabic numerals and units with their parent context',()=>{
 const data={entities:[{id:'p',kind:'property',name:'عِمارة الأمل',electricity_meter:'12345'},{id:'u',kind:'unit',parent_id:'p',name:'محل ٢'},{id:'w',kind:'worker',name:'سامي',iqama_number:'98765',phone:'050123'},{id:'v',kind:'worker',name:'آخر'}],agreements:[],expenses:[]};
 assert.equal(normalizeSearch('الأَمــل ١٢۳'),'الامل 123');
 assert.deepEqual(selectDataRecords(data,'property','محل 2').entities.map(e=>e.id),['p','u']);
 assert.deepEqual(selectDataRecords(data,'property','١٢٣٤٥').entities.map(e=>e.id),['p']);
 assert.deepEqual(selectDataRecords(data,'worker','٩٨٧٦٥').entities.map(e=>e.id),['w']);
 assert.deepEqual(selectDataRecords(data,'worker','050123').entities.map(e=>e.id),['w']);
 assert.equal(selectDataRecords(data,'worker','لا يوجد').resultCount,0);
});

test('Agreement payments ignore the selected month and retain stable actual-date ordering',()=>{
 const data={month:'2026-10',payments:[{id:'p1',agreement_id:'a',paid_at:'2026-01-01',created_at:'1',amount_cents:10},{id:'p2',agreement_id:'a',paid_at:'2026-10-01',created_at:'2',amount_cents:20},{id:'void',agreement_id:'a',paid_at:'2026-10-02',created_at:'3',active:0},{id:'other',agreement_id:'b',paid_at:'2026-10-02',created_at:'3'}]};
 assert.deepEqual(agreementPayments(data,'a').map(p=>p.id),['p2','p1']);
});

test('Alert links resolve known subjects and never invent a missing record',()=>{
 const data={entities:[{id:'car'}],agreements:[{id:'rent'}]};
 assert.deepEqual(alertDestination({key:'ins:car:2026-10-15'},data),{action:'entityDetails',id:'car',label:'عرض السجل'});
 assert.equal(alertDestination({key:'rent:rent:2026-10-15'},data).action,'agreementDetails');
 assert.equal(alertDestination({key:'ins:missing:2026-10-15'},data),null);
 assert.equal(alertDestination({key:'unknown:car:x'},data),null);
});

test('Monthly statements separate execution from dues and export escaped Arabic CSV',()=>{
 const data={month:'2026-10',today:'2026-10-15',summary:{due_in:1000,fulfilled_in:1000,remaining_in:0,due_out:0,fulfilled_out:0,remaining_out:0,cash_in:2000,cash_out:500,net:1500},entities:[{id:'e',name:'الأصل'}],agreements:[{id:'a',direction:'in',title:'=1+1',entity_id:'e',closed_at:'2026-10-10'}],payments:[{id:'p',agreement_id:'a',paid_at:'2026-10-01',created_at:'1',amount_cents:2000,note:'<script>bad</script>'},{id:'prior',agreement_id:'a',paid_at:'2026-09-01',created_at:'0',amount_cents:1000},{id:'void',agreement_id:'a',paid_at:'2026-10-02',created_at:'2',amount_cents:2000,active:0}],expenses:[{id:'ex',title:'سفر',paid_at:'2026-10-03',amount_cents:500,note:' +SUM(1,1)'}],dues:[{due_date:'2026-11-01',amount_cents:1000}]};
 const statement=buildMonthStatement(data);assert.deepEqual(statement.transactions.map(t=>t.id),['p','ex']);assert.equal(statement.openDues.length,0);
 assert.equal(statement.transactions.filter(t=>t.direction==='in').reduce((sum,t)=>sum+t.amount_cents,0),statement.summary.cash_in);
 const csv=statementCSV(statement);assert.equal(csv.charCodeAt(0),0xfeff);assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"\' +SUM(1,1)"'));assert.ok(csv.includes('"20.00"'));
 const html=statementHTML(statement);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/لا يمثل رصيد حساب بنكي/);
});

test('Archived references preserve statement names without entering active data or creation lists',()=>{
 const data={month:'2026-10',summary:{},entities:[],archived_entities:[{id:'archived-car',kind:'car',name:'سيارة قديمة',parent_id:null}],agreements:[{id:'a',entity_id:'archived-car',direction:'in',title:'بيع السيارة',status:'active',closed_at:'2026-10-15T21:30:00Z'}],payments:[{id:'p',agreement_id:'a',paid_at:'2026-10-01',amount_cents:100}],expenses:[{id:'e',entity_id:'archived-car',title:'صيانة سابقة',paid_at:'2026-10-02',amount_cents:50}]};
 assert.equal(entityReference(data,'archived-car').name,'سيارة قديمة');assert.equal(entityReference(data,'archived-car').archived,1);
 assert.equal(data.archived_entities[0].archived,undefined);
 assert.equal(selectDataRecords(data,'car','').resultCount,0);
 assert.deepEqual(buildMonthStatement(data).transactions.map(t=>t.entity),['سيارة قديمة','سيارة قديمة']);
 assert.equal(selectDataRecords(data,'other','سيارة قديمة').expenses.length,1);
});

test('Closed agreements remain discoverable without active assets or post-opening payments',()=>{
 const data={entities:[],archived_entities:[{id:'p',kind:'property',name:'عمارة الأمل'},{id:'u',kind:'unit',parent_id:'p',name:'محل ١١٠'}],payments:[],expenses:[],agreements:[{id:'closed',entity_id:'u',kind:'rent',title:'عقد قديم',status:'active',closed_at:'2026-10-15T21:30:00Z',opening_cents:100,total_cents:100},{id:'open',entity_id:'u',kind:'rent',title:'عقد نشط',status:'active',closed_at:null}]};
 assert.deepEqual(selectDataRecords(data,'closed','110').agreements.map(a=>a.id),['closed']);
 assert.deepEqual(selectDataRecords(data,'closed','الأمل').agreements.map(a=>a.id),['closed']);
 assert.equal(selectDataRecords(data,'closed','').totalCount,1);
 assert.equal(selectDataRecords(data,'property','').resultCount,0);
});

test('Closure timestamps use the Riyadh calendar day at the UTC day boundary',()=>{
 assert.equal(formatRiyadhDate('2026-10-15T20:59:59Z'),'15 أكتوبر 2026');
 assert.equal(formatRiyadhDate('2026-10-15T21:30:00Z'),'16 أكتوبر 2026');
 assert.equal(formatRiyadhDate(null),'—');
});
