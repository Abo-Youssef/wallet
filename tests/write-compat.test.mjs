import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const currentKey='wallet-pending-writes-v1';
// These legacy literals are migration fixtures, not the current product name.
const legacyKey='mahfazati-pending-writes-v1';
const requestId='10000000-0000-4000-8000-000000000001';
const path='/api/entities/10000000-0000-4000-8000-000000000002';
const actor='manager@example.test';
const business={name:'اسم الأصل'};
const fingerprint=createHash('sha256').update(JSON.stringify({actor,business,method:'PATCH',path})).digest('hex');
const receipt=[fingerprint,{id:requestId,version:7}];
let moduleNumber=0;
const fresh=()=>import(new URL(`../src/shared/writes.mjs?compat=${++moduleNumber}`,import.meta.url));
const fakeStorage=(values={})=>{
  const items=new Map(Object.entries(values));
  return {items,getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key)};
};
async function withStorage(storage,run){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{value:storage,configurable:true});
  try{return await run()}finally{
    if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);
    else delete globalThis.sessionStorage;
  }
}

test('Brand rename migrates unresolved request identity and version without changing its fingerprint',async()=>{
  const storage=fakeStorage({[legacyKey]:JSON.stringify([receipt])});
  await withStorage(storage,async()=>{
    const writes=await fresh();
    const result=await writes.prepareWrite(path,'PATCH',{...business,expected_version:99},actor);
    assert.equal(result.key,fingerprint);
    assert.deepEqual(result.body,{...business,expected_version:7,request_id:requestId});
    assert.deepEqual(JSON.parse(storage.getItem(currentKey)),[receipt]);
    assert.equal(storage.getItem(legacyKey),null);
    assert.ok(!storage.getItem(currentKey).includes(business.name));
  });
});

test('Finishing a migrated request cannot resurrect it from an undeletable legacy key',async()=>{
  const storage=fakeStorage({[legacyKey]:JSON.stringify([receipt])});
  storage.removeItem=()=>{throw new Error('remove denied')};
  await withStorage(storage,async()=>{
    const writes=await fresh();
    assert.equal((await writes.prepareWrite(path,'PATCH',business,actor)).body.request_id,requestId);
    writes.finishWrite(fingerprint);
    assert.equal(storage.getItem(currentKey),'[]');
    assert.ok(storage.getItem(legacyKey));
    const reloaded=await fresh();
    const next=await reloaded.prepareWrite(path,'PATCH',{...business,expected_version:8},actor);
    assert.notEqual(next.body.request_id,requestId);
    assert.equal(next.body.expected_version,8);
  });
});

test('The canonical key wins over legacy state, including malformed legacy content',async()=>{
  const canonical=[fingerprint,{id:'10000000-0000-4000-8000-000000000003',version:8}];
  const storage=fakeStorage({[currentKey]:JSON.stringify([canonical]),[legacyKey]:'not JSON'});
  await withStorage(storage,async()=>{
    const writes=await fresh();
    const next=await writes.prepareWrite(path,'PATCH',business,actor);
    assert.equal(next.body.request_id,canonical[1].id);
    assert.equal(next.body.expected_version,8);
    assert.equal(storage.getItem(legacyKey),'not JSON');
  });
});

test('Malformed stored state remains nonfatal and invalid entries are not migrated',async()=>{
  for(const value of ['not JSON','null',JSON.stringify([[fingerprint,{id:'bad'}],['bad',{id:requestId}],receipt])]){
    const storage=fakeStorage({[legacyKey]:value});
    await withStorage(storage,async()=>{
      const writes=await fresh();
      const next=await writes.prepareWrite(path,'PATCH',{...business,expected_version:8},actor);
      assert.match(next.body.request_id,/^[a-f0-9-]{36}$/);
      assert.equal(JSON.parse(storage.getItem(currentKey)).length,1);
      if(value.startsWith('['))assert.equal(next.body.request_id,requestId);
    });
  }
});

test('Blocked migration storage keeps the old receipt and preserves its identity in memory',async()=>{
  const storage=fakeStorage({[legacyKey]:JSON.stringify([receipt])});
  storage.setItem=()=>{throw new Error('storage full')};
  await withStorage(storage,async()=>{
    const writes=await fresh();
    const next=await writes.prepareWrite(path,'PATCH',{...business,expected_version:8},actor);
    assert.equal(next.body.request_id,requestId);
    assert.equal(next.body.expected_version,7);
    assert.equal(storage.getItem(currentKey),null);
    assert.ok(storage.getItem(legacyKey));
    assert.doesNotThrow(()=>writes.finishWrite(fingerprint));
  });
});

test('Unavailable session storage retains same-page retry behavior',async()=>{
  const storage={getItem(){throw new Error('storage denied')},setItem(){throw new Error('storage denied')}};
  await withStorage(storage,async()=>{
    const writes=await fresh();
    const first=await writes.prepareWrite(path,'PATCH',{...business,expected_version:7},actor);
    const second=await writes.prepareWrite(path,'PATCH',{...business,expected_version:8},actor);
    assert.deepEqual(second,first);
    assert.doesNotThrow(()=>writes.finishWrite(first.key));
  });
});
