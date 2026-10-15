// Client behavior using a minimal document stand-in. This is NOT browser/layout QA.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';

function client(storage){
 const nodes=new Map();
 const element=()=>({innerHTML:'',textContent:'',hidden:false,style:{},dataset:{},attributes:{},focus(){},addEventListener(){},setAttribute(k,v){this.attributes[k]=v},querySelector(){return element()},querySelectorAll(){return []},getClientRects(){return [{}]}});
 for(const id of ['app','modal','toast'])nodes.set(id,element());
 const handlers={};
 const document={body:{style:{}},activeElement:null,getElementById(id){
  if(!['app','modal','toast'].includes(id)&&!nodes.get('modal').innerHTML.includes(`id="${id}"`))return null;
  if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);
 },addEventListener(type,fn){handlers[type]=fn},querySelectorAll(){return []}};
 const context=vm.createContext({document,location:{search:'?demo=1'},URLSearchParams,Intl,Date,TextEncoder,AbortController,crypto:webcrypto,btoa,atob,Response,console,sessionStorage:storage,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer},clearTimeout,FormData:class{constructor(form){this.form=form}entries(){return Object.entries(this.form.values)}}});
 const helper=fs.readFileSync(new URL('../public/history.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
 const writes=fs.readFileSync(new URL('../public/writes.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
 const additions=['money-client','client-model','statements'].map(name=>fs.readFileSync(new URL('../public/'+name+'.mjs',import.meta.url),'utf8').replace(/^export /gm,'')).join('\n');
 const finance=fs.readFileSync(new URL('../src/finance.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
 const demo=fs.readFileSync(new URL('../preview/demo.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const run=code=>vm.runInContext(code,context);
 run('(()=>{'+finance+'\n'+demo+'})();\n'+helper+'\n'+writes+'\n'+additions+'\n'+app);
 return {run,context,nodes,handlers};
}
test('Client history loads all preview pages, filters and rejects a reversed range',async()=>{
 const c=client();await c.run('openHistory()');assert.equal(c.run('state.history.entries.length'),50);
 await c.run('loadHistory(true)');assert.equal(c.run('state.history.entries.length'),100);
 await c.run('loadHistory(true)');assert.equal(c.run('state.history.entries.length'),125);assert.equal(c.run('state.history.hasMore'),false);
 c.context.form={values:{from:c.run('state.data.today'),to:c.run('state.data.today'),sort:'oldest',period:'custom'}};
 await c.run('applyHistoryFilters(form)');assert.equal(c.run('state.history.entries.length'),3);
 assert.ok(c.run('state.history.entries[0].created_at < state.history.entries[2].created_at'));
 c.context.form.values={from:'2026-12-01',to:'2026-01-01',sort:'oldest',period:'custom'};
 await c.run('applyHistoryFilters(form)');assert.match(c.nodes.get('history-validation').textContent,/يجب ألا/);assert.equal(c.run('state.history.entries.length'),3);
 c.context.form.values={from:'1990-01-01',to:'1990-01-02',sort:'newest',period:'custom'};
 await c.run('applyHistoryFilters(form)');assert.match(c.nodes.get('history-results').innerHTML,/لا توجد عمليات ضمن الفترة/);
});
test('Late history responses and responses after closing cannot overwrite the current view',async()=>{
 const c=client(),pending=[];c.context.fetch=()=>new Promise(resolve=>pending.push(resolve));c.run('state.demo=false');
 const older=c.run('openHistory()');
 c.run("state.history.sort='oldest'");const newer=c.run('loadHistory()');
 const result=id=>new Response(JSON.stringify({entries:[{id,action:'إضافة',target_type:'task',actor:'test',created_at:'2026-10-15T12:00:00.000Z'}],has_more:false,next_cursor:null}));
 pending[1](result('new'));await newer;pending[0](result('old'));await older;
 assert.equal(c.run('state.history.entries[0].id'),'new');
 const closing=c.run('loadHistory()');c.run('closeModal()');pending[2](result('closed'));await closing;
 assert.equal(c.nodes.get('modal').innerHTML,'');assert.equal(c.run('state.history.entries.length'),0);
});
test('Failed history requests offer retry and rendering escapes record text',async()=>{
 const c=client();c.run('state.demo=false');c.context.fetch=async()=>{throw Error('offline')};
 await c.run('openHistory()');assert.match(c.nodes.get('history-results').innerHTML,/historyRetry/);assert.match(c.nodes.get('history-results').innerHTML,/تعذر الاتصال/);
 const rendered=c.run(`historyEntry({action:'<script>alert(1)</script>',target_type:'task',actor:'<img src=x>',created_at:'2026-10-15T12:00:00Z'})`);
 assert.ok(!rendered.includes('<script>'));assert.ok(rendered.includes('&lt;script&gt;'));
});
test('Client retries retain a payment request id and block a concurrent submit',async()=>{
 const c=client(),submissions=[];c.run('state.demo=false');
 const submit={disabled:false};c.context.form={id:'payment-form',dataset:{agreement:'a1',slot:'0',expected:'10000'},values:{amount:'20',paid_at:'2026-10-15',note:''},querySelector(){return submit}};
 c.context.fetch=async(url,options)=>{submissions.push(JSON.parse(options.body));throw Error('response lost')};
 await assert.rejects(c.run('doSave(form)'));await assert.rejects(c.run('doSave(form)'));
 assert.equal(submissions.length,2);assert.equal(submissions[0].request_id,submissions[1].request_id);assert.equal(submit.disabled,false);
 let reject;c.context.fetch=async(url,options)=>{submissions.push(JSON.parse(options.body));return new Promise((_,r)=>{reject=r})};
 const first=c.run('doSave(form)');await c.run('doSave(form)');while(!reject)await new Promise(resolve=>setImmediate(resolve));assert.equal(submissions.length,3);
 reject(Error('response lost'));await assert.rejects(first);assert.equal(submit.disabled,false);
});
test('Offline preview embeds the current scripts and has no external module requirement',()=>{
 const html=fs.readFileSync(new URL('../معاينة_تفاعلية.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.ok(script.includes('function historyPeriod('));assert.ok(script.includes('globalThis.mahfazatiPreview='));
 assert.ok(!html.includes('<script src='));assert.ok(!html.includes('import {historyPeriod'));
});

for(const [label,ending] of [['LF','\n'],['CRLF','\r\n']])test(`Preview build produces a standalone executable script from ${label} source files`,()=>{
 const tempRoot=fs.realpathSync(os.tmpdir()),tempDir=fs.mkdtempSync(path.join(tempRoot,'mahfazati-preview-'));
 try{
  const files=['scripts/build-preview.mjs','public/style.css','public/history.mjs','public/writes.mjs','public/money-client.mjs','public/client-model.mjs','public/statements.mjs','src/finance.mjs','preview/demo.mjs','public/app.js'];
  for(const file of files){
   const target=path.join(tempDir,file);fs.mkdirSync(path.dirname(target),{recursive:true});
   const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/\r?\n/g,ending);
   fs.writeFileSync(target,source);
  }
  execFileSync(process.execPath,[path.join(tempDir,'scripts/build-preview.mjs')],{stdio:'pipe'});
  const html=fs.readFileSync(path.join(tempDir,'معاينة_تفاعلية.html'),'utf8'),script=html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(()=>new vm.Script(script));assert.doesNotMatch(script,/^import /m);
  assert.ok(script.includes('globalThis.mahfazatiPreview='));assert.ok(script.includes('function render('));
 }finally{
  assert.equal(path.dirname(path.resolve(tempDir)),tempRoot);
  fs.rmSync(tempDir,{recursive:true,force:true});
 }
});

test('Cash lists follow the selected month and do not truncate at forty entries',()=>{
 const c=client();c.run(`state.month='2026-10';state.data.payments=Array.from({length:45},(_,i)=>({id:'p'+i,agreement_id:'a1',paid_at:'2026-10-01',created_at:'2026-10-01',amount_cents:100,created_by:'visible-actor'}));state.data.payments.push({id:'outside',agreement_id:'a1',paid_at:'2026-09-01',created_at:'2026-09-01',amount_cents:100,created_by:'outside-month'});`);
 const html=c.run("cashPage('in')");assert.equal((html.match(/visible-actor/g)||[]).length,45);assert.ok(!html.includes('outside-month'));
 c.run(`state.data.dues=[{agreement_id:'a1',slot:0,direction:'in',due_date:'2026-09-01',title:'outside-due',amount_cents:100,status:'متأخر'}]`);
 assert.ok(!c.run("cashPage('in')").includes('outside-due'));
 c.run("state.dueScope='all'");assert.ok(c.run("cashPage('in')").includes('outside-due'));
});

test('Changing months cannot let an earlier response replace the newer snapshot',async()=>{
 const c=client(),pending=[];c.context.fetch=()=>new Promise(resolve=>pending.push(resolve));c.run('state.demo=false');
 const data=JSON.parse(c.run('JSON.stringify(state.data)'));
 c.run("state.month='2026-09'");const first=c.run('reload()');
 c.run("state.month='2026-10'");const second=c.run('reload()');
 pending[1](new Response(JSON.stringify({...data,month:'2026-10'})));await second;
 pending[0](new Response(JSON.stringify({...data,month:'2026-09'})));await first;
 assert.equal(c.run('state.data.month'),'2026-10');assert.equal(c.run('state.month'),'2026-10');
});

test('Expense retries survive a tab refresh using hashes without storing form data',async()=>{
 const stored=new Map(),storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
 const make=()=>{const c=client(storage);c.run('state.demo=false');c.context.form={id:'expense-form',dataset:{},values:{title:'وصف خاص لا يُخزن',amount:'20',paid_at:'2026-10-15'},querySelector(){return {disabled:false}}};return c};
 const c1=make(),c2requests=[];let first;
 c1.context.fetch=async(url,options)=>{first=JSON.parse(options.body);throw Error('lost')};
 await assert.rejects(c1.run('doSave(form)'));
 assert.ok(![...stored.values()].join('').includes('وصف خاص'));assert.ok(![...stored.values()].join('').includes('amount'));
 const c2=make();c2.context.fetch=async(url,options)=>{c2requests.push(JSON.parse(options.body));throw Error('lost')};
 await assert.rejects(c2.run('doSave(form)'));assert.equal(c2requests[0].request_id,first.request_id);
 c2.context.form.values.amount='21';await assert.rejects(c2.run('doSave(form)'),/لم تتأكد/);assert.equal(c2requests.length,1);
});

test('A confirmed save followed by a failed refresh reports the saved outcome accurately',async()=>{
 const c=client();c.run('state.demo=false');
 c.context.form={id:'expense-form',dataset:{},values:{title:'سفر',amount:'20',paid_at:'2026-10-15'},querySelector(){return {disabled:false}}};
 c.context.fetch=async(url,options)=>options.method==='POST'?new Response(JSON.stringify({id:'saved'}),{status:201}):Promise.reject(Error('offline'));
 await c.run('doSave(form)');assert.match(c.nodes.get('toast').textContent,/تم الحفظ.*تعذر تحديث العرض/);
 assert.match(c.nodes.get('app').innerHTML,/data-action="reload"/);assert.ok(!c.nodes.get('app').innerHTML.includes('onclick='));
});

test('Payment correction uses the original installment capacity and sends the viewed version',async()=>{
 const c=client();c.run("state.data.user.role='assistant';state.data.payment_contexts['payment-demo'].expected_cents=300000;openPayment(null,'payment-demo')");
 assert.match(c.nodes.get('modal').innerHTML,/data-expected="300000"/);assert.match(c.nodes.get('modal').innerHTML,/data-version="1"/);
 c.context.form={id:'payment-form',dataset:{id:'payment-demo',slot:'0',agreement:'a1',expected:'300000',version:'1'},values:{amount:'2000',paid_at:'2026-10-15',note:''},querySelector(){return {disabled:false}}};
 c.run('state.demo=false');let sent;c.context.fetch=async(url,options)=>{sent=JSON.parse(options.body);throw Error('lost')};
 await assert.rejects(c.run('doSave(form)'));assert.equal(sent.expected_version,1);assert.equal(sent.reschedule_method,null);
});

test('Managers can inspect agreements, audit changes escape text, and previews stay outside live assets',()=>{
 const c=client();assert.match(c.run("entityButtons(state.data.entities[0])"),/entityDetails/);
 assert.ok(!c.run("entityButtons(state.data.entities[0])").includes('entityEdit'));
 c.run("openAgreementDetails('a1')");assert.match(c.nodes.get('modal').innerHTML,/المتبقي/);assert.ok(!c.nodes.get('modal').innerHTML.includes('agreementCancel'));
 const html=c.run(`auditChanges({note:'<img src=x onerror=bad>'},{note:'<script>bad</script>'})`);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.ok(!source.includes('function demoData'));assert.ok(!source.includes("has('demo')"));assert.ok(!source.includes('عمارة النخيل'));
 assert.match(c.run("field('عدد الأقساط','count',1,'number')"),/step="1"/);assert.match(c.run("field('مبلغ','amount','20','number')"),/step="0.01"/);
});

test('Exact halalas do not force overpayment rescheduling',async()=>{
 const c=client();c.run('state.demo=false');let sent;
 c.context.form={id:'payment-form',dataset:{agreement:'a1',slot:'0',expected:'110',version:'1'},values:{amount:'1.10',paid_at:'2026-10-15',note:''},querySelector(){return {disabled:false}}};
 c.context.fetch=async(url,options)=>{sent=JSON.parse(options.body);throw Error('network interruption')};
 await assert.rejects(c.run('doSave(form)'),/لم يصل تأكيد الحفظ/);
 assert.equal(sent.amount,'1.10');assert.equal(sent.reschedule_method,null);
});

test('Expired authorization retains unknown-write identity until a confirmed response',async()=>{
 const c=client(),requests=[];c.run('state.demo=false');
 c.context.payload={title:'Trip',amount:'20',paid_at:'2026-10-15'};
 const statuses=[null,401,403,201,null];
 c.context.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));const status=statuses.shift();if(!status)throw Error('lost response');return new Response(JSON.stringify(status===201?{id:'saved'}:{error:'renew identity'}),{status})};
 for(let i=0;i<3;i++)await assert.rejects(c.run("api('/api/expenses','POST',payload)"));
 await c.run("api('/api/expenses','POST',payload)");
 assert.equal(new Set(requests.map(r=>r.request_id)).size,1);
 await assert.rejects(c.run("api('/api/expenses','POST',payload)"));
 assert.notEqual(requests[3].request_id,requests[4].request_id);
});

test('Month loading keeps old totals labelled with their snapshot and blocks exporting them as a new month',async()=>{
 const c=client();c.run('state.demo=false');const snapshot=JSON.parse(c.run('JSON.stringify(state.data)'));let resolve;
 c.context.fetch=()=>new Promise(r=>resolve=r);
 const waiting=c.run("reload('2026-09')");
 assert.equal(c.run('state.month'),snapshot.month);assert.equal(c.run('state.data.month'),snapshot.month);
 assert.equal(c.run('state.requestedMonth'),'2026-09');assert.throws(()=>c.run('openStatement()'),/انتظر/);
 assert.match(c.nodes.get('app').innerHTML,new RegExp('الأرقام المعروضة تخص '+snapshot.month));
 resolve(new Response(JSON.stringify({...snapshot,month:'2026-09'})));await waiting;
 assert.equal(c.run('state.month'),'2026-09');c.run('openStatement()');assert.equal(c.run('state.statement.month'),'2026-09');
});

test('Agreement detail exposes payments across months and honors closed/read-only states',()=>{
 const c=client();c.run(`state.data.payments.push({...state.data.payments[0],id:'older',paid_at:'2026-01-01',note:'old payment note'});openAgreementDetails('a1')`);
 assert.match(c.nodes.get('modal').innerHTML,/old payment note/);assert.ok(!c.nodes.get('modal').innerHTML.includes('data-action="payEdit"'));
 c.run(`state.data.user.role='assistant';openAgreementDetails('a1')`);assert.match(c.nodes.get('modal').innerHTML,/data-action="payEdit"/);
 c.run(`agreementById('a1').closed_at='2026-10-15T12:00:00Z';agreementById('a1').closed_by='assistant';openAgreementDetails('a1')`);
 assert.match(c.nodes.get('modal').innerHTML,/data-action="agreementReopen"/);assert.ok(!c.nodes.get('modal').innerHTML.includes('data-action="payEdit"'));
 assert.ok(!c.run("agreementButtons(agreementById('a1'))").includes('agreementEdit'));
});

test('Agreement close action sends its viewed version and restores its detail after refresh',async()=>{
 const c=client();c.run(`state.demo=false;state.data.user.role='assistant';openAgreementDetails('a1')`);c.context.confirm=()=>true;
 const snapshot=JSON.parse(c.run('JSON.stringify(state.data)'));snapshot.agreements.find(a=>a.id==='a1').closed_at='2026-10-15T12:00:00Z';let sent;
 c.context.fetch=async(url,options)=>{if(options.method==='POST'){sent={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({id:'a1'}))}return new Response(JSON.stringify(snapshot))};
 const button={dataset:{action:'agreementClose',id:'a1'}};
 await c.handlers.click({target:{closest:()=>button}});
 assert.equal(sent.url,'/api/agreements/a1/close');assert.equal(sent.body.expected_version,1);assert.ok(sent.body.request_id);
 assert.match(c.nodes.get('modal').innerHTML,/data-action="agreementReopen"/);
});

test('Render restores the initiating control after replacing the app tree',()=>{
 const c=client();let focused=false;
 const old={dataset:{action:'filter',id:'late'}};
 const replacement={dataset:{action:'filter',id:'late'},focus(){focused=true}};
 c.context.document.activeElement=old;c.nodes.get('app').contains=el=>el===old;c.nodes.get('app').querySelectorAll=()=>[replacement];
 c.run('render()');assert.equal(focused,true);
});
