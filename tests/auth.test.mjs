import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {authenticate} from '../src/server/auth.mjs';
const pair=()=>generateKeyPairSync('rsa',{modulusLength:2048});
const key1=pair(),key2=pair();
const jwk=(key,kid)=>({...key.publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'});
let published=[jwk(key1,'one')],fetches=0,unavailable=false;
globalThis.fetch=async()=>{fetches++;if(unavailable)throw Error('offline');return new Response(JSON.stringify({keys:published}))};
const env=team=>({ACCESS_TEAM_DOMAIN:`${team}.cloudflareaccess.com`,ACCESS_AUD:'wallet',MANAGER_EMAIL:'manager@example.com',ASSISTANT_EMAIL:'assistant@example.com'});
function request(team,claims={},header={},key=key1){
 const body={iss:`https://${team}.cloudflareaccess.com`,aud:['wallet'],exp:Math.floor(Date.now()/1000)+3600,email:'assistant@example.com',...claims};
 const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const text=b64({alg:'RS256',kid:'one',...header})+'.'+b64(body);
 return new Request('https://wallet.test/',{headers:{'Cf-Access-Jwt-Assertion':text+'.'+createSign('RSA-SHA256').update(text).sign(key.privateKey).toString('base64url')}});
}
test('Signed tokens validate audience, issuer, lifetime, account and signature',async()=>{
 assert.equal((await authenticate(request('valid'),env('valid'))).role,'assistant');
 for(const claims of [{aud:['other']},{iss:'https://other.cloudflareaccess.com'},{exp:0},{exp:'99999999999'},{nbf:'invalid'},{nbf:Date.now()/1000+120}])
  await assert.rejects(authenticate(request('valid',claims),env('valid')),e=>e.code===401);
 await assert.rejects(authenticate(request('valid',{email:'unknown@example.com'}),env('valid')),e=>e.code===403);
 await assert.rejects(authenticate(request('valid',{}, {},key2),env('valid')),e=>e.code===401);
 for(const header of [{alg:'none'},{alg:'HS256'},{kid:null}])await assert.rejects(authenticate(request('valid',{},header),env('valid')),e=>e.code===401);
});
test('Malformed token structures fail closed without runtime errors',async()=>{
 for(const value of ['x','a.b.c','bnVsbA.bnVsbA.eA','x'.repeat(17_000)]){
  const req=new Request('https://wallet.test/',{headers:{'Cf-Access-Jwt-Assertion':value}});
  await assert.rejects(authenticate(req,env('malformed')),e=>e.code===401);
 }
 await assert.rejects(authenticate(new Request('https://wallet.test/'),env('malformed')),e=>e.code===401);
 await assert.rejects(authenticate(request('valid'),{...env('valid'),ASSISTANT_EMAIL:'manager@example.com'}),e=>e.code===503);
});
test('Display identity comes from a verified optional name with email fallback',async()=>{
 const user=await authenticate(request('identity',{name:'  أحمد يوسف  '}),env('identity'));
 assert.deepEqual(user,{email:'assistant@example.com',role:'assistant',name:'أحمد يوسف'});
 for(const name of [undefined,null,{},['admin'],'   ']){
  const fallback=await authenticate(request('identity',{name,email:'ASSISTANT@example.com'}),env('identity'));
  assert.equal(fallback.name,'assistant@example.com');
  assert.equal(fallback.role,'assistant');
 }
 const managerLabel=await authenticate(request('identity',{name:'المدير'}),env('identity'));
 assert.equal(managerLabel.role,'assistant');
 await assert.rejects(authenticate(request('identity',{name:'مدير',email:'unknown@example.com'}),env('identity')),e=>e.code===403);
 await assert.rejects(authenticate(request('identity',{name:'مدير'},{},key2),env('identity')),e=>e.code===401);
});
test('Key rotation refreshes unknown keys while repeated misses are rate-limited',async()=>{
 const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
 try{
  published=[jwk(key1,'one')];await authenticate(request('rotate'),env('rotate'));
  const before=fetches;published=[jwk(key2,'two')];clock+=61_000;
  assert.equal((await authenticate(request('rotate',{}, {kid:'two'},key2),env('rotate'))).role,'assistant');
  assert.equal(fetches,before+1);
  for(let n=0;n<4;n++)await assert.rejects(authenticate(request('rotate',{}, {kid:'missing'+n}),env('rotate')),e=>e.code===401);
  assert.equal(fetches,before+1);
 }finally{Date.now=realNow;published=[jwk(key1,'one')]}
});
test('Certificate service failures produce a temporary error, never an auth bypass',async()=>{
 unavailable=true;try{await assert.rejects(authenticate(request('offline'),env('offline')),e=>e.code===503)}finally{unavailable=false}
});
