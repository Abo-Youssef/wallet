import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {project} from '../src/shared/finance.mjs';
import {effectiveUnitStatus} from '../src/shared/unit-status.mjs';
const migration=name=>readFileSync(new URL('../database/migrations/'+name,import.meta.url),'utf8');

test('Property type migration preserves existing rows and rejects classification on other entity kinds',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const file of ['0001_initial.sql','0002_history_pagination.sql','0003_integrity.sql','0004_agreement_closure.sql','0005_schedule_confirmation.sql','0006_rental_vacancy.sql'])db.exec(migration(file));
  db.exec("INSERT INTO entities(id,kind,name,created_at,updated_at,created_by) VALUES ('p','property','بيت قديم','2026-01-01','2026-01-01','assistant'),('u','unit','وحدة','2026-01-01','2026-01-01','assistant')");
  const before=db.prepare('SELECT * FROM entities ORDER BY id').all();
  db.exec(migration('0007_property_types.sql'));
  const after=db.prepare('SELECT * FROM entities ORDER BY id').all();
  for(let i=0;i<before.length;i++){assert.equal(after[i].property_type,null);delete after[i].property_type;assert.deepEqual(after[i],before[i])}
  db.exec("UPDATE entities SET property_type='house' WHERE id='p'");
  assert.throws(()=>db.exec("UPDATE entities SET property_type='building' WHERE id='u'"),/CHECK/);
  assert.throws(()=>db.exec("UPDATE entities SET property_type='unknown' WHERE id='p'"),/CHECK/);
 }finally{db.close()}
});

test('Migration 0006 preserves money and old closures while requiring vacancy for open expired rents',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const file of ['0001_initial.sql','0002_history_pagination.sql','0003_integrity.sql','0004_agreement_closure.sql','0005_schedule_confirmation.sql'])db.exec(migration(file));
  for(const id of ['held','closed']){
   db.prepare("INSERT INTO entities(id,kind,name,created_at,updated_at,created_by) VALUES (?,'unit',?,'2001-01-01','2001-01-01','assistant')").run(id,id);
   db.prepare("INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at) VALUES (?,?,'rent','in',?,'2001-01-01','2001-01-31','2001-01-01',10000,?,1,1,'assistant','2001-01-01')").run(id,id,id,id==='closed'?10000:0);
  }
  db.exec("UPDATE agreements SET closed_at='2001-02-01T09:00:00.000Z',closed_by='manager' WHERE id='closed'");
  const before=db.prepare('SELECT * FROM agreements ORDER BY id').all();
  db.exec('BEGIN');db.exec(migration('0006_rental_vacancy.sql'));db.exec('COMMIT');
  const after=db.prepare('SELECT * FROM agreements ORDER BY id').all();
  for(const old of before){const current=after.find(a=>a.id===old.id);for(const key of Object.keys(old))assert.equal(current[key],old[key]);assert.deepEqual(project(current),project(old))}
  const legacy=after.find(a=>a.id==='closed');assert.equal(legacy.vacated_on,'2001-02-01');assert.equal(legacy.vacated_by,'manager');
  assert.equal(effectiveUnitStatus({id:'closed'},after,'2026-10-17'),'available');
  assert.equal(effectiveUnitStatus({id:'held'},after,'2026-10-17'),'rented');
  assert.throws(()=>db.exec("UPDATE entities SET status='maintenance' WHERE id='held'"),/unit has current rent/);
  assert.throws(()=>db.exec("UPDATE agreements SET status='cancelled' WHERE id='held'"),/rental requires vacancy/);
  db.exec("UPDATE agreements SET vacated_on='2001-02-01',vacated_at='2001-02-01T09:00:00.000Z',vacated_by='assistant' WHERE id='held'");
  assert.throws(()=>db.exec("UPDATE agreements SET total_cents=0 WHERE id='held'"),/vacated rental locked/);
  assert.throws(()=>db.exec("UPDATE agreements SET vacated_on=NULL,vacated_at=NULL,vacated_by=NULL WHERE id='held'"),/vacated rental locked/);
  assert.equal(project(db.prepare("SELECT * FROM agreements WHERE id='held'").get()).remaining_cents,10000);
 }finally{db.close()}
});
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

test('Migration 0005 preserves historical schedules and receipts while adding separate schedule confirmation',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const file of ['0001_initial.sql','0002_history_pagination.sql','0003_integrity.sql','0004_agreement_closure.sql'])db.exec(migration(file));
  db.exec(`INSERT INTO entities(id,kind,name,status,created_at,updated_at,created_by)
    VALUES ('unit','unit','وحدة قائمة','rented','2001-01-01','2001-01-01','assistant@example.com');
    INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,version,created_by,created_at)
    VALUES ('rent','unit','rent','in','عقد قديم','2001-01-01','2001-12-31','2001-01-01',30000,0,3,1,1,'assistant@example.com','2001-01-01');
    INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,reschedule_method,observed_version,created_by,created_at)
    VALUES ('paid','original-receipt','rent',0,20000,'2001-01-10','shorten',0,'assistant@example.com','2001-01-10T09:00:00.000Z');
    INSERT INTO audit(id,actor,action,target_type,target_id,created_at)
    VALUES ('audit','assistant@example.com','تسجيل حركة','payment','paid','2001-01-10T09:00:00.000Z');`);
  const before=Object.fromEntries(['entities','agreements','payments','audit'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
  db.exec('BEGIN');db.exec(migration('0005_schedule_confirmation.sql'));db.exec('COMMIT');
  for(const [table,rows] of Object.entries(before))for(const row of rows){
    const after=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(row.id);
    for(const key of Object.keys(row))assert.equal(after[key],row[key],`${table}.${key}`);
  }
  const agreement=db.prepare("SELECT * FROM agreements WHERE id='rent'").get(),payments=db.prepare('SELECT * FROM payments').all();
  assert.equal(payments[0].schedule_end_date,null);
  const schedule=project(agreement,payments);
  assert.equal(schedule.remaining_cents,10000);assert.equal(schedule.schedule_end_date,'2001-02-01');
  assert.equal(agreement.end_date,'2001-12-31');
  db.exec("UPDATE entities SET status='personal_use' WHERE id='unit'");
  assert.equal(db.prepare("SELECT status FROM entities WHERE id='unit'").get().status,'personal_use');
  assert.throws(()=>db.exec(`INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
    VALUES ('blocked','unit','rent','in','إيجار محجوب','2002-01-01','2002-01-31','2002-01-01',10000,0,1,1,'assistant@example.com','2002-01-01')`),/unit unavailable/);
 }finally{db.close()}
});
