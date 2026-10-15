import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyPeriod,parseHistoryFilters,filterHistory} from '../public/history.mjs';
const parse = values => parseHistoryFilters(new URLSearchParams(values));
test('History periods cross month/year and leap-day boundaries in Riyadh calendar',()=>{
  assert.deepEqual(historyPeriod('week','2026-01-02'),{from:'2025-12-27',to:'2026-01-02'});
  assert.deepEqual(historyPeriod('week','2024-03-01'),{from:'2024-02-24',to:'2024-03-01'});
  assert.deepEqual(historyPeriod('month','2026-10-15'),{from:'2026-10-01',to:'2026-10-15'});
  assert.deepEqual(historyPeriod('year','2026-10-15'),{from:'2026-01-01',to:'2026-10-15'});
  assert.deepEqual(historyPeriod('today','2026-10-15'),{from:'2026-10-15',to:'2026-10-15'});
  assert.deepEqual(historyPeriod('all','2026-10-15'),{from:'',to:''});
});
test('History includes the full Riyadh day including UTC previous evening',()=>{
  const q=parse({from:'2026-10-15',to:'2026-10-15'});
  assert.equal(q.fromUTC,'2026-10-14T21:00:00.000Z');
  assert.equal(q.toUTC,'2026-10-15T20:59:59.999Z');
  const rows=['2026-10-14T20:59:59.999Z',q.fromUTC,q.toUTC,'2026-10-15T21:00:00.000Z'].map((created_at,i)=>({id:String(i),created_at}));
  assert.deepEqual(filterHistory(rows,q).entries.map(r=>r.id),['2','1']);
});
test('History rejects impossible dates, reversed periods, unsupported sort and unsafe limits',()=>{
  for(const values of [{from:'2026-02-30'},{to:'2026-13-01'},{from:'15/10/2026'},{from:'2026-10-16',to:'2026-10-15'},{sort:'DESC;DROP TABLE audit'},{limit:'0'},{limit:'101'},{limit:'1.5'},{cursor:'not-a-cursor'}])assert.throws(()=>parse(values));
  assert.doesNotThrow(()=>parse({from:'2024-02-29'}));
  assert.doesNotThrow(()=>parse({to:'2026-10-15'}));
});
test('History cursor pages timestamp ties without missing or repeating rows in either order',()=>{
  const rows=Array.from({length:105},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,created_at:'2026-10-15T10:00:00.000Z'}));
  for(const sort of ['oldest','newest']){
    const seen=[];let cursor;
    do{
      const result=filterHistory(rows,parse({sort,limit:'50',...(cursor?{cursor}:{})}));
      seen.push(...result.entries.map(r=>r.id));cursor=result.next_cursor;
    }while(cursor);
    assert.equal(seen.length,105);assert.equal(new Set(seen).size,105);
    assert.deepEqual(seen,rows.map(r=>r.id).sort((a,b)=>sort==='oldest'?a.localeCompare(b):b.localeCompare(a)));
  }
  const page=filterHistory(rows,parse({limit:'1'}));
  assert.throws(()=>parse({cursor:page.next_cursor,from:'2026-10-01'}),/متابعة/);
  assert.throws(()=>parse({cursor:page.next_cursor,sort:'oldest'}),/متابعة/);
});
