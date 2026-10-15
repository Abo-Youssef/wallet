import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {project} from '../src/finance.mjs';
const migration=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
test('Migration 0003 preserves existing records and adds integrity guards to a populated database',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(migration('0001_initial.sql'));db.exec(migration('0002_history_pagination.sql'));
  db.exec(`INSERT INTO entities(id,kind,name,created_at,updated_at,created_by) VALUES ('car','car','أصل قائم','2026-01-01','2026-01-01','assistant@example.com');
    INSERT INTO agreements(id,entity_id,kind,direction,title,first_due_date,total_cents,opening_cents,installment_count,frequency_months,version,created_by,created_at)
    VALUES ('a','car','purchase','out','التزام قائم','2026-01-01',10000,0,1,1,1,'assistant@example.com','2026-01-01');
    INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at)
    VALUES ('p','original-request','a',0,3000,'2026-01-01',0,'assistant@example.com','2026-01-01T09:00:00.000Z');
    INSERT INTO audit(id,actor,action,target_type,target_id,created_at) VALUES ('audit','assistant@example.com','تسجيل حركة','payment','p','2026-01-01T09:00:00.000Z');`);
  const before=Object.fromEntries(['entities','agreements','payments','audit'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));
  db.exec('BEGIN');db.exec(migration('0003_integrity.sql'));db.exec('COMMIT');
  for(const [table,rows] of Object.entries(before))for(const row of rows){
    const after=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(row.id);
    for(const key of Object.keys(row))assert.equal(after[key],row[key],`${table}.${key}`);
  }
  assert.equal(db.prepare("SELECT version FROM entities WHERE id='car'").get().version,0);
  const a=db.prepare("SELECT * FROM agreements WHERE id='a'").get(),payments=db.prepare('SELECT * FROM payments').all();
  assert.equal(project(a,payments).remaining_cents,7000);
  assert.throws(()=>db.exec("UPDATE entities SET archived=1 WHERE id='car'"),/active links/);
  assert.throws(()=>db.exec("UPDATE agreements SET total_cents=20000 WHERE id='a'"),/schedule locked/);
  assert.throws(()=>db.exec("DELETE FROM audit WHERE id='audit'"),/immutable/);
 }finally{db.close()}
});
