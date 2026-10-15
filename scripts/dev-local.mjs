/**
 * Disposable browser-review server. Node 24+, with a completed Vite build.
 * This file is never a production entry point: only dist/ and src/worker.mjs
 * are deployed by Wrangler. Every run starts a fresh in-memory database.
 */
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createSign,randomUUID} from 'node:crypto';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../src/worker.mjs';

const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('Usage: node scripts/dev-local.mjs [--empty]\nPORT defaults to 43128. Bound to 127.0.0.1 only. Data is discarded on exit.');
  process.exit(0);
}
if(args.some(arg=>arg!=='--empty'))throw new Error('Only --empty and --help are supported');
const portText=process.env.PORT??'43128';
if(!/^\d+$/.test(portText)||Number(portText)<1||Number(portText)>65535)throw new Error('PORT must be an integer from 1 to 65535');
const port=Number(portText),origin=`http://127.0.0.1:${port}`;
const publicRoot=await realpath(fileURLToPath(new URL('../dist/',import.meta.url))).catch(()=>{throw new Error('The React build is missing. Run npm run build before starting the local server.')});
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
const migrationsRoot=new URL('../migrations/',import.meta.url);
for(const name of (await readdir(migrationsRoot)).filter(name=>/^\d.*\.sql$/.test(name)).sort()){
  sqlite.exec('BEGIN');
  try{sqlite.exec(await readFile(new URL(name,migrationsRoot),'utf8'));sqlite.exec('COMMIT')}
  catch(error){sqlite.exec('ROLLBACK');sqlite.close();throw error}
}

function queryBatch(statements){
  sqlite.exec('BEGIN');
  try{
    const results=statements.map(({sql,params})=>{
      const statement=sqlite.prepare(sql);
      if(statement.columns().length){
        const rows=statement.all(...params);return {success:true,results:rows,meta:{}};
      }
      const result=statement.run(...params);return {success:true,results:[],meta:{changes:result.changes}};
    });
    sqlite.exec('COMMIT');return results;
  }catch(error){sqlite.exec('ROLLBACK');throw error}
}
class LocalStatement{
  constructor(sql,params=[]){this.sql=sql;this.params=params}
  bind(...params){return new LocalStatement(this.sql,params)}
  async first(column){const row=queryBatch([this])[0].results[0]??null;return column&&row?row[column]:row}
  async all(){return queryBatch([this])[0]}
  async run(){return queryBatch([this])[0]}
}
const db={prepare:sql=>new LocalStatement(sql),batch:async statements=>queryBatch(statements)};

const team='mahfazati-local-review.cloudflareaccess.com';
const certUrl=`https://${team}/cdn-cgi/access/certs`;
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:randomUUID(),alg:'RS256',use:'sig'};
// Authentication still verifies real RSA signatures through the production
// module. The exact local certificate URL is served in-process; no network
// fallback exists, so an accidental external fetch fails closed.
globalThis.fetch=async input=>{
  const url=input instanceof Request?input.url:input instanceof URL?input.href:String(input);
  if(url!==certUrl)throw new Error('External network is disabled in the disposable review server');
  return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});
};
function token(role){
  const time=Math.floor(Date.now()/1000);
  const payload={iss:`https://${team}`,aud:['mahfazati-local-review'],email:`${role}@example.test`,nbf:time-1,exp:time+300};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const content=`${encode({alg:'RS256',kid:jwk.kid,typ:'JWT'})}.${encode(payload)}`;
  return `${content}.${createSign('RSA-SHA256').update(content).sign(privateKey).toString('base64url')}`;
}
function currentRole(cookie=''){
  return cookie.split(';').some(part=>part.trim()==='mahfazati_review_role=assistant')?'assistant':'manager';
}
function banner(role){
  const link=(value,label)=>`<a href="/__review/role?as=${value}"${role===value?' aria-current="true"':''}>${label}</a>`;
  return `<aside id="local-review-banner" role="note" dir="rtl"><span>معاينة محلية · بيانات تجريبية مؤقتة</span><nav aria-label="دور الاختبار">${link('manager','اختبار المدير')}${link('assistant','اختبار المساعد')}</nav></aside>`;
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
const env={DB:db,ASSETS:assets,ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:'mahfazati-local-review',MANAGER_EMAIL:'manager@example.test',ASSISTANT_EMAIL:'assistant@example.test'};

async function seedCall(role,path,body){
  const request=new Request(origin+path,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':token(role),Origin:origin,'Content-Type':'application/json','X-Mahfazati-Action':'1'},body:JSON.stringify({request_id:randomUUID(),...body})});
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
  const property=await entity({kind:'property',name:'عمارة النخيل — تجريبي',location:'موقع توضيحي',reference_value_cents:'950000'});
  const unit=await entity({kind:'unit',name:'شقة 101 — تجريبي',parent_id:property.id,status:'rented',electricity_meter:'DEMO-101'});
  await entity({kind:'unit',name:'شقة 102 — تجريبي',parent_id:property.id,status:'available',electricity_meter:'DEMO-102'});
  const car=await entity({kind:'car',name:'سيارة المحفظة — تجريبي',plate:'تجريبي 123',reference_value_cents:'84000',odometer_km:45000,maintenance_due_km:50000,insurance_expiry:dateRiyadh(new Date(Date.now()+20*86400000))});
  await entity({kind:'worker',name:'عامل توضيحي',work_location:'عمارة النخيل — تجريبي',iqama_number:'DEMO-ONLY',iqama_expiry:dateRiyadh(new Date(Date.now()+45*86400000))});
  const rent=await agreement({kind:'rent',entity_id:unit.id,title:'إيجار الشقة 101 — تجريبي',counterparty:'مستأجر توضيحي',contract_number:'DEMO-RENT',total:'3000',opening:'0',count:1,frequency:1,start_date:`${month}-01`,end_date:monthEnd,first_due_date:`${month}-05`});
  await seedCall('assistant',`/api/agreements/${rent.id}/payments`,{amount:'1200',paid_at:today,slot:0,expected_version:0,note:'تحصيل جزئي توضيحي'});
  await agreement({kind:'purchase',entity_id:car.id,title:'أقساط السيارة — تجريبي',total:'84000',opening:'24000',count:24,frequency:1,first_due_date:`${month}-20`});
  await agreement({kind:'other',title:'التزام الهاتف — تجريبي',total:'1200',opening:'0',count:12,frequency:1,first_due_date:`${month}-25`});
  await seedCall('assistant','/api/expenses',{title:'صيانة توضيحية',amount:'240',paid_at:today,entity_id:property.id,note:'بيانات اختبار محلية'});
  await seedCall('manager','/api/tasks',{title:'متابعة المتبقي من إيجار الشقة — تجريبي',description:'مهمة توضيحية لا تتضمن تواصلًا حقيقيًا',due_date:dateRiyadh(new Date(Date.now()+3*86400000))});
}
if(!args.includes('--empty'))await seed();

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
    if(url.pathname==='/__review/role'){
      const role=url.searchParams.get('as');
      if(incoming.method!=='GET'||!['manager','assistant'].includes(role)){
        outgoing.writeHead(400);outgoing.end('Choose manager or assistant');return;
      }
      outgoing.writeHead(303,{'Set-Cookie':`mahfazati_review_role=${role}; Path=/; HttpOnly; SameSite=Strict`,'Location':'/','Cache-Control':'no-store'});outgoing.end();return;
    }
    const chunks=[];let length=0;
    for await(const chunk of incoming){
      length+=chunk.length;
      if(length>65536){outgoing.writeHead(413);outgoing.end('Request body too large');return}
      chunks.push(chunk);
    }
    const headers=new Headers();
    for(const [name,value] of Object.entries(incoming.headers))if(value!==undefined&&name!=='host')headers.set(name,Array.isArray(value)?value.join(','):value);
    headers.set('Cf-Access-Jwt-Assertion',token(currentRole(incoming.headers.cookie??'')));
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
server.on('error',error=>{console.error(`Local review server failed: ${error.code??'unknown error'}`);sqlite.close();process.exitCode=1});
server.listen(port,'127.0.0.1',()=>{
  console.log(`Local review ready: ${origin}`);
  console.log(`Mode: ${args.includes('--empty')?'empty database':'synthetic example data'}; SQLite is in memory. Stop the server to discard all changes.`);
  console.log('Role switch: /__review/role?as=manager or /__review/role?as=assistant');
});
function shutdown(){server.close(()=>{sqlite.close();process.exit(0)});server.closeAllConnections()}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
