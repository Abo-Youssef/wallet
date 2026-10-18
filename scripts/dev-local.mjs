/**
 * Local PostgreSQL development server. Node 24+, with a completed Vite build.
 * This file is never a production entry point: only dist/ and src/server/worker.mjs
 * are deployed by Wrangler. Data persists in the configured PostgreSQL database.
 */
import {createServer} from 'node:http';
import {generateKeyPairSync,createSign,randomUUID} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../src/server/worker.mjs';
import {MAX_RESTORE_BYTES} from '../src/shared/backup-limits.mjs';
import {connectDatabase} from '../src/server/postgres.mjs';

const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('Usage: node --env-file=.env scripts/dev-local.mjs [--seed-demo]\nDATABASE_URL is required; apply PostgreSQL migrations first. PORT defaults to 43128. Bound to 127.0.0.1 only. Data persists.\n--seed-demo explicitly adds synthetic records to an empty database. --empty is a compatibility no-op and never clears data.');
  process.exit(0);
}
if(args.some(arg=>!['--empty','--seed-demo'].includes(arg)))throw new Error('Only --seed-demo, --empty and --help are supported');
if(args.includes('--empty')&&args.includes('--seed-demo'))throw new Error('Choose either --empty or --seed-demo');
const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw new Error('DATABASE_URL is required. Copy .env.example to .env and run with node --env-file=.env');
const portText=process.env.PORT??'43128';
if(!/^\d+$/.test(portText)||Number(portText)<1||Number(portText)>65535)throw new Error('PORT must be an integer from 1 to 65535');
const port=Number(portText),origin=`http://127.0.0.1:${port}`;
// Review-only fixtures for long account names and a slow bootstrap. Neither is
// part of the Worker or client build; production has no artificial delay.
const reviewDelay=Number(process.env.WALLET_REVIEW_DELAY_MS??0);
if(!Number.isInteger(reviewDelay)||reviewDelay<0||reviewDelay>10000)throw new Error('WALLET_REVIEW_DELAY_MS must be between 0 and 10000');
const publicRoot=await realpath(fileURLToPath(new URL('../dist/',import.meta.url))).catch(()=>{throw new Error('The React build is missing. Run npm run build before starting the local server.')});
// Read-only startup validation. Schema changes are an explicit migration step.
// This must never initialize, truncate, or seed a database merely on startup.
const startupDb=await connectDatabase({DATABASE_URL:connectionString});
let seedGeneration;
try{
  seedGeneration=(await startupDb.prepare('SELECT generation FROM restore_control WHERE id=1').first())?.generation;
  if(typeof seedGeneration!=='string')throw new Error('PostgreSQL schema is missing its restore control row; run the migration command first');
  if(args.includes('--seed-demo')){
    const tables=['entities','agreements','payments','expenses','tasks','dismissed_alerts','audit','hidden_audit','mutation_requests'];
    const counts=await startupDb.batch(tables.map(table=>startupDb.prepare(`SELECT count(*) AS count FROM ${table}`)));
    if(counts.some(result=>result.results[0].count!==0))throw new Error('--seed-demo requires an empty database. Existing data was not modified.');
  }
}finally{await startupDb.close()}

const team='wallet-local-review.cloudflareaccess.com';
const certUrl=`https://${team}/cdn-cgi/access/certs`;
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:randomUUID(),alg:'RS256',use:'sig'};
// Authentication still verifies real RSA signatures through the production
// module. The exact local certificate URL is served in-process; no network
// fallback exists, so an accidental external fetch fails closed.
globalThis.fetch=async input=>{
  const url=input instanceof Request?input.url:input instanceof URL?input.href:String(input);
  if(url!==certUrl)throw new Error('External HTTP is disabled in the local development server');
  return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});
};
function token(role,expired=false){
  const time=Math.floor(Date.now()/1000);
  const payload={iss:`https://${team}`,aud:['wallet-local-review'],email:`${role}@example.test`,nbf:time-300,exp:expired?time-120:time+300,
    ...(process.env.WALLET_REVIEW_NAME?{name:process.env.WALLET_REVIEW_NAME}:{})};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const content=`${encode({alg:'RS256',kid:jwk.kid,typ:'JWT'})}.${encode(payload)}`;
  return `${content}.${createSign('RSA-SHA256').update(content).sign(privateKey).toString('base64url')}`;
}
function currentRole(cookie=''){
  return cookie.split(';').some(part=>part.trim()==='wallet_review_role=assistant')?'assistant':'manager';
}
function sessionEnded(cookie=''){
  return cookie.split(';').some(part=>part.trim()==='wallet_review_session=ended');
}
function sessionPage(){
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>جلسة الاختبار المحلي</title><body>
  <main><h1>انتهت جلسة الاختبار المحلي</h1><p>هذه محاكاة محلية لبوابة الدخول. بيانات PostgreSQL محفوظة بعد إغلاق الخادم. في التطبيق المحمي يتولى Cloudflare Access إنهاء الجلسة.</p>
  <p><a href="/__review/role?as=manager">دخول تجريبي كمدير</a></p><p><a href="/__review/role?as=assistant">دخول تجريبي كمساعد</a></p></main></body></html>`;
}
function banner(role){
  const link=(value,label)=>`<a href="/__review/role?as=${value}"${role===value?' aria-current="true"':''}>${label}</a>`;
  return `<aside id="local-review-banner" role="note" dir="rtl"><span>تطوير محلي · بيانات PostgreSQL محفوظة</span><nav aria-label="دور الاختبار">${link('manager','اختبار المدير')}${link('assistant','اختبار المساعد')}</nav></aside>`;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
function isInsidePublic(path){const part=relative(publicRoot,path);return !part.startsWith('..')&&!isAbsolute(part)}
const assets={async fetch(request){
  let pathname;
  try{pathname=decodeURIComponent(new URL(request.url).pathname)}catch{return new Response('Bad path',{status:400})}
  if(pathname.includes('\0'))return new Response('Bad path',{status:400});
  const candidate=resolve(publicRoot,`.${pathname==='/'?'/index.html':pathname}`);
  if(!isInsidePublic(candidate))return new Response('Not found',{status:404});
  try{
    const path=await realpath(candidate);
    if(!isInsidePublic(path)||!(await stat(path)).isFile())return new Response('Not found',{status:404});
    let body=await readFile(path);
    if(extname(path)==='.html')body=Buffer.from(body.toString('utf8').replace('<body>',`<body>${banner(currentRole(request.headers.get('cookie')??''))}`));
    return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store'}});
  }catch(error){if(['ENOENT','ENOTDIR','EACCES'].includes(error.code))return new Response('Not found',{status:404});throw error}
}};
const env={DATABASE_URL:connectionString,ASSETS:assets,ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:'wallet-local-review',MANAGER_EMAIL:'manager@example.test',ASSISTANT_EMAIL:'assistant@example.test'};

async function seedCall(role,path,body){
  const request=new Request(origin+path,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':token(role),Origin:origin,'Content-Type':'application/json','X-Wallet-Action':'1','X-Wallet-Mode':'assistant'},body:JSON.stringify({request_id:randomUUID(),database_generation:seedGeneration,...body})});
  const response=await worker.fetch(request,env),result=await response.json();
  if(!response.ok)throw new Error(`Local demo seed failed: ${path} (${response.status}) ${JSON.stringify(result)}`);
  return result;
}
function dateRiyadh(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
async function seed(){
  const today=dateRiyadh(),month=today.slice(0,7),[year,monthNumber]=month.split('-').map(Number);
  const monthEnd=`${month}-${new Date(Date.UTC(year,monthNumber,0,12)).getUTCDate()}`;
  const entity=body=>seedCall('assistant','/api/entities',body);
  const agreement=body=>seedCall('assistant','/api/agreements',body);
  const property=await entity({kind:'property',property_type:'building',name:'عمارة النخيل — تجريبي',location:'موقع توضيحي',reference_value_cents:'950000'});
  const unit=await entity({kind:'unit',name:'شقة 101 — تجريبي',parent_id:property.id,status:'rented',electricity_meter:'DEMO-101'});
  await entity({kind:'unit',name:'شقة 102 — تجريبي',parent_id:property.id,status:'available',electricity_meter:'DEMO-102'});
  const house=await entity({kind:'property',property_type:'house',name:'بيت الروضة — تجريبي',location:'موقع توضيحي',electricity_meter:'000123'});
  await entity({kind:'unit',name:'البيت كاملًا — تجريبي',parent_id:house.id,status:'available'});
  const rest=await entity({kind:'property',property_type:'rest_house',name:'استراحة الواحة — تجريبي',location:'موقع توضيحي'});
  await entity({kind:'unit',name:'الاستراحة كاملة — تجريبي',parent_id:rest.id,status:'personal_use'});
  await entity({kind:'property',property_type:'rest_house',name:'استراحة الحجز اليومي — تجريبي',location:'موقع اختبار الحجز'});
  const car=await entity({kind:'car',name:'سيارة المحفظة — تجريبي',plate:'تجريبي 123',reference_value_cents:'84000',odometer_km:45000,maintenance_due_km:50000,insurance_expiry:dateRiyadh(new Date(Date.now()+20*86400000))});
  await entity({kind:'worker',name:'عامل توضيحي',work_location:'عمارة النخيل — تجريبي',iqama_number:'DEMO-ONLY',iqama_expiry:dateRiyadh(new Date(Date.now()+45*86400000))});
  const rent=await agreement({kind:'rent',entity_id:unit.id,title:'إيجار الشقة 101 — تجريبي',counterparty:'مستأجر توضيحي',contract_number:'DEMO-RENT',total:'3000',opening:'0',count:1,frequency:1,start_date:`${month}-01`,end_date:monthEnd,first_due_date:`${month}-05`});
  await seedCall('assistant',`/api/agreements/${rent.id}/payments`,{amount:'1200',paid_at:today,slot:0,expected_version:0,schedule_end_date:`${month}-05`,note:'تحصيل جزئي توضيحي'});
  await agreement({kind:'purchase',entity_id:car.id,title:'أقساط السيارة — تجريبي',total:'84000',opening:'24000',count:24,frequency:1,first_due_date:`${month}-20`});
  await agreement({kind:'other',title:'التزام الهاتف — تجريبي',total:'1200',opening:'0',count:12,frequency:1,first_due_date:`${month}-25`});
  await seedCall('assistant','/api/expenses',{title:'صيانة توضيحية',amount:'240',paid_at:today,entity_id:property.id,note:'بيانات اختبار محلية'});
  await seedCall('manager','/api/tasks',{title:'متابعة المتبقي من إيجار الشقة — تجريبي',description:'مهمة توضيحية لا تتضمن تواصلًا حقيقيًا',due_date:dateRiyadh(new Date(Date.now()+3*86400000))});
}
if(args.includes('--seed-demo'))await seed();

const server=createServer(async(incoming,outgoing)=>{
  try{
    // Refuse remote hosts/DNS rebinding even though the listener is loopback.
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(incoming.headers.host)){
      outgoing.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});outgoing.end('Local host required');return;
    }
    const requestOrigin=`http://${incoming.headers.host}`;
    if(!incoming.url?.startsWith('/')||incoming.url.startsWith('//')){
      outgoing.writeHead(400);outgoing.end('Bad request target');return;
    }
    const url=new URL(incoming.url,requestOrigin);
    if(url.pathname==='/api/bootstrap'&&reviewDelay)await new Promise(resolve=>setTimeout(resolve,reviewDelay));
    if(url.pathname==='/__review/role'){
      const role=url.searchParams.get('as');
      if(incoming.method!=='GET'||!['manager','assistant'].includes(role)){
        outgoing.writeHead(400);outgoing.end('Choose manager or assistant');return;
      }
      outgoing.writeHead(303,{'Set-Cookie':[`wallet_review_role=${role}; Path=/; HttpOnly; SameSite=Strict`,'wallet_review_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'],'Location':'/','Cache-Control':'no-store'});outgoing.end();return;
    }
    // Test gateway only. Production sends this reserved path to Cloudflare
    // Access before the Worker; no local session cookie is used in production.
    if(['/cdn-cgi/access/logout','/__review/expire'].includes(url.pathname)){
      if(incoming.method!=='GET'){outgoing.writeHead(405);outgoing.end();return}
      outgoing.writeHead(200,{'Set-Cookie':'wallet_review_session=ended; Path=/; HttpOnly; SameSite=Strict','Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      outgoing.end(sessionPage());return;
    }
    const expired=sessionEnded(incoming.headers.cookie??'');
    if(expired&&['/','/index.html'].includes(url.pathname)&&incoming.method==='GET'){
      outgoing.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      outgoing.end(sessionPage());return;
    }
    const bodyLimit=['/api/backup/preview','/api/backup/restore'].includes(url.pathname)?MAX_RESTORE_BYTES+100_000:65536;
    const chunks=[];let length=0;
    for await(const chunk of incoming){
      length+=chunk.length;
      if(length>bodyLimit){outgoing.writeHead(413,{'Content-Type':'application/json; charset=utf-8'});outgoing.end(JSON.stringify({error:'الطلب كبير جدًا'}));return}
      chunks.push(chunk);
    }
    const headers=new Headers();
    for(const [name,value] of Object.entries(incoming.headers))if(value!==undefined&&name!=='host')headers.set(name,Array.isArray(value)?value.join(','):value);
    headers.set('Cf-Access-Jwt-Assertion',token(currentRole(incoming.headers.cookie??''),expired));
    const method=incoming.method??'GET';
    // Preserve the browser's Origin/action headers. The production worker's
    // secureWrite checks remain active and reject cross-origin or bare writes.
    const request=new Request(url,{method,headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});
    const response=await worker.fetch(request,env);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    outgoing.end(method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
  }catch{
    if(!outgoing.headersSent)outgoing.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
    outgoing.end('Local review request failed');
  }
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.on('error',error=>{console.error(`Local development server failed: ${error.code??'unknown error'}`);process.exitCode=1});
server.listen(port,'127.0.0.1',()=>{
  console.log(`Local PostgreSQL development ready: ${origin}`);
  console.log(`Mode: ${args.includes('--seed-demo')?'synthetic example data explicitly added':'existing data preserved'}; all database changes persist after shutdown.`);
  console.log('Role switch: /__review/role?as=manager or /__review/role?as=assistant');
});
function shutdown(){server.close(()=>{process.exit(0)});server.closeAllConnections()}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
