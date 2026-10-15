// Keep only hashes, request IDs and versions in this tab's session storage.
// No names, amounts, identity numbers or form content are persisted here.
const storageKey='mahfazati-pending-writes-v1';
let pending=new Map();
try{
  const entries=JSON.parse(globalThis.sessionStorage?.getItem(storageKey)||'[]');
  if(Array.isArray(entries))pending=new Map(entries.filter(x=>Array.isArray(x)&&/^[a-f0-9]{64}$/.test(x[0])&&
    x[1]&&/^[a-f0-9-]{36}$/.test(x[1].id)&&(x[1].version===undefined||Number.isSafeInteger(x[1].version))));
}catch{}
const save=()=>{try{globalThis.sessionStorage?.setItem(storageKey,JSON.stringify([...pending]))}catch{}};
const stable=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))):v;
export async function prepareWrite(path,method,payload,actor){
  const {request_id,expected_version,...business}=payload;
  const bytes=new TextEncoder().encode(JSON.stringify(stable({path,method,actor,business})));
  const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  let entry=pending.get(key);
  if(!entry){entry={id:request_id||crypto.randomUUID(),...(expected_version===undefined?{}:{version:expected_version})};pending.set(key,entry);save()}
  return {key,body:{...business,...(entry.version===undefined?{}:{expected_version:entry.version}),request_id:entry.id}};
}
export function finishWrite(key){pending.delete(key);save()}
