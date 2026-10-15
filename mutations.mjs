import {assert} from './finance.mjs';
const conflict=()=>Object.assign(new Error('معرف الإرسال مرتبط بطلب مختلف؛ حدّث البيانات وراجع السجل'),{code:409});
const canonical=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))):v;
export function expectedVersion(body,row){
  assert(Number.isSafeInteger(body.expected_version)&&body.expected_version>=0,'نسخة السجل مفقودة؛ أعد فتحه قبل التعديل');
  if(body.expected_version!==row.version)throw Object.assign(new Error('تغير السجل منذ فتحه؛ حدّث البيانات ثم راجع التعديل'),{code:409});
}
export async function runMutation(db,user,scope,body,operation){
  const id=body.request_id;
  assert(typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),'معرف الإرسال مفقود أو غير صحيح');
  const bytes=new TextEncoder().encode(JSON.stringify(canonical(body)));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  async function receipt(){
    const prior=await db.prepare('SELECT * FROM mutation_requests WHERE request_id=?').bind(id).first();
    if(!prior)return null;
    if(prior.actor!==user.email||prior.scope!==scope||prior.fingerprint!==fingerprint)throw conflict();
    return {...JSON.parse(prior.response_json),idempotent:true};
  }
  const prior=await receipt();if(prior)return prior;
  const commit=async(result,statements)=>{
    const record=db.prepare('INSERT INTO mutation_requests(request_id,actor,scope,fingerprint,response_json,created_at) VALUES (?,?,?,?,?,?)')
      .bind(id,user.email,scope,fingerprint,JSON.stringify(result),new Date().toISOString());
    await db.batch([record,...statements]);return result;
  };
  try{return await operation(commit)}catch(error){
    // Another identical request may have committed while this one was reading.
    const completed=await receipt();if(completed)return completed;throw error;
  }
}
