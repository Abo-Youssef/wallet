const cache=new Map(),pending=new Map();
const fail=(message,code)=>Object.assign(new Error(message),{code});
const invalid=()=>fail('جلسة الدخول غير صالحة أو منتهية؛ أعد تسجيل الدخول',401);
const string=v=>typeof v==='string'?v.trim():'';
function decode(s){
  if(!/^[A-Za-z0-9_-]+$/.test(s))throw invalid();
  const b64=s.replace(/-/g,'+').replace(/_/g,'/');
  try{return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length/4)*4,'=')),c=>c.charCodeAt(0))}catch{throw invalid()}
}
async function keysFor(team,force=false){
  const old=cache.get(team),time=Date.now();
  if(old&&time<old.until&&(!force||time-old.refreshed<60_000))return old;
  if(pending.has(team))return pending.get(team);
  const request=(async()=>{
    try{
      const response=await fetch(`https://${team}/cdn-cgi/access/certs`,{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('certs unavailable');
      const doc=await response.json();
      if(!Array.isArray(doc.keys)||!doc.keys.length||doc.keys.length>100)throw new Error('invalid certs');
      const data={keys:doc.keys,until:Date.now()+15*60_000,refreshed:Date.now()};cache.set(team,data);return data;
    }catch{throw fail('تعذر التحقق من تسجيل الدخول مؤقتًا؛ حاول مرة أخرى',503)}
    finally{pending.delete(team)}
  })();pending.set(team,request);return request;
}
export async function authenticate(req,env){
  const team=string(env.ACCESS_TEAM_DOMAIN).replace(/^https:\/\//,'').replace(/\/$/,'');
  const aud=string(env.ACCESS_AUD),manager=string(env.MANAGER_EMAIL).toLowerCase(),assistant=string(env.ASSISTANT_EMAIL).toLowerCase();
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)||!aud||!manager||!assistant||manager===assistant)
    throw fail('يجب ضبط حماية الدخول والمستخدمين قبل التشغيل',503);
  const token=req.headers.get('Cf-Access-Jwt-Assertion');
  if(!token)throw fail('مطلوب تسجيل الدخول عبر Cloudflare Access',401);
  if(token.length>16_384)throw invalid();
  const parts=token.split('.');if(parts.length!==3)throw invalid();
  let header,body;
  try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));body=JSON.parse(new TextDecoder().decode(decode(parts[1])))}catch{throw invalid()}
  const time=Date.now()/1000;
  if(!header||!body||Array.isArray(header)||Array.isArray(body)||header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>200||
    body.iss!==`https://${team}`||!Array.isArray(body.aud)||!body.aud.includes(aud)||
    !Number.isFinite(body.exp)||body.exp<=time||
    (body.nbf!==undefined&&(!Number.isFinite(body.nbf)||body.nbf>time+60)))throw invalid();
  let keys=await keysFor(team);
  const matching=k=>k&&k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig');
  let jwk=keys.keys.find(matching);
  if(!jwk){keys=await keysFor(team,true);jwk=keys.keys.find(matching)}
  if(!jwk)throw invalid();
  let ok;
  try{
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  }catch{throw invalid()}
  if(!ok)throw invalid();
  const email=string(body.email).toLowerCase(),role=email===manager?'manager':email===assistant?'assistant':null;
  if(!role)throw fail('هذا الحساب غير مخول بدخول المحفظة',403);
  return {email,role};
}
