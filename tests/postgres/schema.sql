-- Run only against a freshly migrated disposable database:
-- psql -X -v ON_ERROR_STOP=1 -d <test_database> -f tests/postgres/schema.sql
-- Fixtures and temporary assertion helpers are rolled back on success.
BEGIN;
SELECT id FROM restore_control WHERE id=1 FOR UPDATE;

CREATE FUNCTION pg_temp.expect_true(condition BOOLEAN, description TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', description; END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_error(command TEXT, fragment TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF strpos(SQLERRM, fragment)>0 THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected error containing "%", received "%"', fragment, SQLERRM;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %', command;
END;
$$;

SELECT pg_temp.expect_true((SELECT count(*)=10 FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('entities','agreements','payments','expenses','tasks','audit','hidden_audit','dismissed_alerts','mutation_requests','restore_control')), 'all ten tables');
SELECT pg_temp.expect_true((SELECT count(*)=21 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal), 'all twenty-one business triggers');
SELECT pg_temp.expect_true((SELECT count(*)=5 AND bool_and(condeferrable AND NOT condeferred)
  FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace), 'all five foreign keys remain deferrable and initially immediate');
SELECT pg_temp.expect_true(wallet_date('2028-02-29')='2028-02-29' AND wallet_date('2026-02-30') IS NULL
  AND wallet_date('not-a-date') IS NULL AND wallet_previous_day('2028-03-01')='2028-02-29', 'ISO date behavior');
SELECT pg_temp.expect_true(wallet_today()=to_char(statement_timestamp() AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD'), 'Riyadh business date');

INSERT INTO entities(id,kind,name,parent_id,property_type,created_at,updated_at,created_by) VALUES
 ('p','property','Building',NULL,'building','2001-01-01','2001-01-01','assistant'),
 ('rest','property','Daily property',NULL,'rest_house','2001-01-01','2001-01-01','assistant'),
 ('u','unit','Unit','p',NULL,'2001-01-01','2001-01-01','assistant'),
 ('du','unit','Daily property child','rest',NULL,'2001-01-01','2001-01-01','assistant'),
 ('car','car','Vehicle',NULL,NULL,'2001-01-01','2001-01-01','assistant'),
 ('worker','worker','Person',NULL,NULL,'2001-01-01','2001-01-01','assistant');

SELECT pg_temp.expect_error($q$INSERT INTO entities(id,kind,name,parent_id,created_at,updated_at,created_by)
 VALUES ('bad-parent','unit','Invalid child','worker','2001-01-01','2001-01-01','assistant')$q$, 'invalid entity parent');
SELECT pg_temp.expect_error($q$UPDATE entities SET parent_id='rest' WHERE id='u'$q$, 'immutable entity identity');
SELECT pg_temp.expect_error($q$UPDATE entities SET kind='car' WHERE id='u'$q$, 'immutable entity identity');
SELECT pg_temp.expect_error($q$UPDATE entities SET property_type='house' WHERE id='worker'$q$, 'check constraint');
SELECT pg_temp.expect_error($q$UPDATE entities SET archived=1 WHERE id='p'$q$, 'entity has active links');

INSERT INTO agreements(id,entity_id,kind,direction,title,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('purchase','car','purchase','out','Vehicle purchase','2001-01-01',1000,0,1,1,'assistant','2001-01-01');
SELECT pg_temp.expect_error($q$INSERT INTO agreements(id,entity_id,kind,direction,title,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('invalid-worker','worker','purchase','out','Invalid purchase','2001-01-01',1000,0,1,1,'assistant','2001-01-01')$q$, 'invalid agreement entity');
SELECT pg_temp.expect_error($q$UPDATE agreements SET direction='in' WHERE id='purchase'$q$, 'invalid agreement entity');
SELECT pg_temp.expect_error($q$INSERT INTO agreements(id,kind,direction,title,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at,closed_at,closed_by)
 VALUES ('preclosed','other','out','Preclosed','2001-01-01',0,0,1,1,'assistant','2001-01-01','2001-02-01','assistant')$q$, 'invalid agreement closure');
SELECT pg_temp.expect_error($q$INSERT INTO agreements(id,kind,direction,title,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at,vacated_on,vacated_at,vacated_by)
 VALUES ('prevacated','other','out','Prevacated','2001-01-01',0,0,1,1,'assistant','2001-01-01','2001-02-01','2001-02-01','assistant')$q$, 'invalid rental vacancy');
SELECT pg_temp.expect_error($q$UPDATE entities SET archived=1 WHERE id='car'$q$, 'entity has active links');
SELECT pg_temp.expect_error($q$INSERT INTO expenses(id,title,amount_cents,paid_at,entity_id,created_by,created_at)
 VALUES ('worker-money','Invalid person expense',100,'2001-01-01','worker','assistant','2001-01-01')$q$, 'invalid expense entity');

SELECT pg_temp.expect_error($q$INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at)
 VALUES ('stale','stale','purchase',0,400,'2001-01-01',0,'assistant','2001-01-01')$q$, 'stale agreement write');
UPDATE agreements SET version=version+1 WHERE id='purchase';
INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at)
 VALUES ('payment','payment-request','purchase',0,400,'2001-01-01',0,'assistant','2001-01-01');
SELECT pg_temp.expect_error($q$INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at)
 VALUES ('duplicate','payment-request','purchase',0,400,'2001-01-01',0,'assistant','2001-01-01')$q$, 'unique constraint');
SELECT pg_temp.expect_error($q$UPDATE payments SET request_id='replaced' WHERE id='payment'$q$, 'immutable payment identity');
SELECT pg_temp.expect_error($q$UPDATE payments SET reschedule_method='invalid' WHERE id='payment'$q$, 'invalid reschedule method');
SELECT pg_temp.expect_error($q$UPDATE payments SET slot_index=1 WHERE id='payment'$q$, 'invalid payment agreement');
SELECT pg_temp.expect_error($q$UPDATE payments SET schedule_end_date='2001/01/01' WHERE id='payment'$q$, 'check constraint');
SELECT pg_temp.expect_error($q$UPDATE agreements SET total_cents=2000 WHERE id='purchase'$q$, 'paid agreement schedule locked');
SELECT pg_temp.expect_error($q$UPDATE agreements SET closed_at='2001-02-01',closed_by='assistant' WHERE id='purchase'$q$, 'unpaid agreement closure');

INSERT INTO mutation_requests(request_id,actor,scope,fingerprint,response_json,created_at)
 VALUES ('request','assistant','POST /api/entities','fingerprint','{"id":"p"}','2001-01-01');
SELECT pg_temp.expect_error($q$INSERT INTO mutation_requests(request_id,actor,scope,fingerprint,response_json,created_at)
 VALUES ('request','assistant','POST /api/entities','different','{}','2001-01-01')$q$, 'unique constraint');
INSERT INTO audit(id,actor,action,target_type,target_id,before_json,after_json,created_at)
 VALUES ('audit','assistant','create','entity','p',NULL,'{"name":"Building"}','2001-01-01');
SELECT pg_temp.expect_error($q$UPDATE audit SET action='rewritten' WHERE id='audit'$q$, 'audit is immutable');
SELECT pg_temp.expect_error($q$DELETE FROM audit WHERE id='audit'$q$, 'audit is immutable');
INSERT INTO hidden_audit(audit_id,hidden_by,hidden_at) VALUES ('audit','manager','2001-01-02');
SELECT pg_temp.expect_true((SELECT count(*)=1 FROM audit WHERE id='audit'), 'hiding keeps audit history');

-- A failure after the receipt, version bump and audit must undo every change.
DO $$
DECLARE prior_version BIGINT;
BEGIN
  SELECT version INTO prior_version FROM agreements WHERE id='purchase';
  BEGIN
    INSERT INTO mutation_requests(request_id,actor,scope,fingerprint,response_json,created_at)
      VALUES ('atomic','assistant','POST /api/payments','fingerprint','{}','2001-01-01');
    UPDATE agreements SET version=version+1 WHERE id='purchase';
    INSERT INTO audit(id,actor,action,target_type,created_at) VALUES ('atomic-audit','assistant','invalid','payment','2001-01-01');
    INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at)
      VALUES ('invalid-amount','invalid-amount','purchase',0,-1,'2001-01-01',prior_version,'assistant','2001-01-01');
    RAISE EXCEPTION 'Invalid amount unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM pg_temp.expect_true(NOT EXISTS(SELECT 1 FROM mutation_requests WHERE request_id='atomic')
    AND NOT EXISTS(SELECT 1 FROM audit WHERE id='atomic-audit')
    AND (SELECT version=prior_version FROM agreements WHERE id='purchase'), 'atomic rollback retains no partial receipt, audit or version');
END;
$$;

-- Ended periodic contracts continue to occupy a unit until vacancy is confirmed.
INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('rent','u','rent','in','Periodic rent','2001-01-01','2001-01-31','2001-01-01',1000,1000,1,1,'assistant','2001-01-01');
SELECT pg_temp.expect_error($q$INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('overlap','u','rent','in','Held unit','2002-01-01','2002-01-31','2002-01-01',1000,0,1,1,'assistant','2001-01-01')$q$, 'overlapping rent');
SELECT pg_temp.expect_error($q$UPDATE entities SET status='maintenance' WHERE id='u'$q$, 'unit has current rent');
SELECT pg_temp.expect_error($q$UPDATE agreements SET status='cancelled' WHERE id='rent'$q$, 'rental requires vacancy');
SELECT pg_temp.expect_error($q$UPDATE agreements SET closed_at='2001-02-01',closed_by='assistant' WHERE id='rent'$q$, 'rental requires vacancy');
SELECT pg_temp.expect_error($q$UPDATE agreements SET vacated_on='2001-02-30',vacated_at='2001-03-01',vacated_by='assistant' WHERE id='rent'$q$, 'invalid rental vacancy');
UPDATE agreements SET vacated_on='2001-02-01',vacated_at='2001-02-01',vacated_by='assistant' WHERE id='rent';
SELECT pg_temp.expect_error($q$UPDATE agreements SET total_cents=2000 WHERE id='rent'$q$, 'vacated rental locked');
SELECT pg_temp.expect_error($q$UPDATE agreements SET vacated_on=NULL,vacated_at=NULL,vacated_by=NULL WHERE id='rent'$q$, 'vacated rental locked');
UPDATE agreements SET closed_at='2001-02-01',closed_by='assistant' WHERE id='rent';
SELECT pg_temp.expect_error($q$UPDATE agreements SET title='changed closed rent' WHERE id='rent'$q$, 'agreement closed');
UPDATE entities SET archived=1 WHERE id='u';
SELECT pg_temp.expect_error($q$UPDATE agreements SET closed_at=NULL,closed_by=NULL WHERE id='rent'$q$, 'invalid agreement entity');

-- A daily booking conflicts with any child unit on its day, including held old rents.
INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,rental_mode,created_by,created_at)
 VALUES ('daily','rest','rent','in','Daily booking',wallet_today(),wallet_today(),wallet_today(),500,0,1,1,'daily','assistant','2001-01-01');
SELECT pg_temp.expect_error($q$INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('daily-child-overlap','du','rent','in','Child rental',wallet_today(),wallet_today(),wallet_today(),1000,0,1,1,'assistant','2001-01-01')$q$, 'overlapping rent');
SELECT pg_temp.expect_error($q$UPDATE entities SET status='maintenance' WHERE id='du'$q$, 'unit has current rent');
SELECT pg_temp.expect_error($q$INSERT INTO entities(id,kind,name,parent_id,status,created_at,updated_at,created_by)
 VALUES ('new-blocked-child','unit','Blocked child','rest','personal_use','2001-01-01','2001-01-01','assistant')$q$, 'unit has current rent');
SELECT pg_temp.expect_error($q$UPDATE entities SET property_type='house' WHERE id='rest'$q$, 'rest house has bookings');
SELECT pg_temp.expect_error($q$UPDATE agreements SET total_cents=600 WHERE id='daily'$q$, 'invalid daily booking');
SELECT pg_temp.expect_error($q$UPDATE agreements SET booking_cancelled_at='2001-01-01',booking_cancelled_by='assistant',booking_cancel_note='' WHERE id='daily'$q$, 'invalid daily booking');
UPDATE agreements SET booking_cancelled_at='2001-01-01',booking_cancelled_by='assistant',booking_cancel_note='Requested cancellation' WHERE id='daily';
SELECT pg_temp.expect_error($q$UPDATE agreements SET booking_cancelled_at=NULL,booking_cancelled_by=NULL,booking_cancel_note=NULL WHERE id='daily'$q$, 'invalid daily booking');
INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('after-cancellation','du','rent','in','Child rental',wallet_today(),wallet_today(),wallet_today(),1000,0,1,1,'assistant','2001-01-01');

INSERT INTO entities(id,kind,name,status,created_at,updated_at,created_by) VALUES
 ('available','unit','Available unit','available','2001-01-01','2001-01-01','assistant'),
 ('blocked','unit','Unavailable unit','maintenance','2001-01-01','2001-01-01','assistant');
SELECT pg_temp.expect_error($q$INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('blocked-rent','blocked','rent','in','Blocked rental',wallet_today(),wallet_today(),wallet_today(),1000,0,1,1,'assistant','2001-01-01')$q$, 'unit unavailable for rent');
INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,created_by,created_at)
 VALUES ('movable-rent','available','rent','in','Open rental',wallet_today(),wallet_today(),wallet_today(),1000,0,1,1,'assistant','2001-01-01');
SELECT pg_temp.expect_error($q$UPDATE agreements SET entity_id='blocked' WHERE id='movable-rent'$q$, 'unit unavailable for rent');
SELECT pg_temp.expect_error($q$UPDATE agreements SET entity_id='du' WHERE id='movable-rent'$q$, 'overlapping rent');

INSERT INTO entities(id,kind,name,property_type,created_at,updated_at,created_by)
 VALUES ('rest-paid','property','Paid daily property','rest_house','2001-01-01','2001-01-01','assistant');
INSERT INTO agreements(id,entity_id,kind,direction,title,start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,rental_mode,created_by,created_at)
 VALUES ('paid-daily','rest-paid','rent','in','Paid daily booking',wallet_today(),wallet_today(),wallet_today(),500,0,1,1,'daily','assistant','2001-01-01');
UPDATE agreements SET version=1 WHERE id='paid-daily';
INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,observed_version,created_by,created_at)
 VALUES ('daily-payment','daily-payment','paid-daily',0,500,wallet_today(),0,'assistant','2001-01-01');
SELECT pg_temp.expect_error($q$UPDATE agreements SET closed_at='2001-02-01',closed_by='assistant' WHERE id='paid-daily'$q$, 'unexpired rent closure');
UPDATE agreements SET booking_cancelled_at='2001-01-01',booking_cancelled_by='assistant',booking_cancel_note='Cancelled paid reservation' WHERE id='paid-daily';
UPDATE agreements SET closed_at='2001-02-01',closed_by='assistant' WHERE id='paid-daily';
SELECT pg_temp.expect_error($q$UPDATE payments SET note='closed agreement payment' WHERE id='daily-payment'$q$, 'agreement closed');

-- Restore bypass permits historical rows but never bypasses FKs or CHECKs.
SET LOCAL wallet.restore_mode='on';
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO entities(id,kind,name,parent_id,created_at,updated_at,created_by)
 VALUES ('restore-child','unit','Child before parent','restore-parent','2001-01-01','2001-01-01','assistant');
SELECT pg_temp.expect_error('SET CONSTRAINTS ALL IMMEDIATE', 'foreign key constraint');
INSERT INTO entities(id,kind,name,property_type,created_at,updated_at,created_by)
 VALUES ('restore-parent','property','Restored parent','house','2001-01-01','2001-01-01','assistant');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.expect_error($q$UPDATE entities SET property_type='house' WHERE id='worker'$q$, 'check constraint');
SELECT pg_temp.expect_error($q$UPDATE agreements SET opening_cents=total_cents+1 WHERE id='purchase'$q$, 'check constraint');
SELECT pg_temp.expect_error($q$UPDATE restore_control SET generation=NULL WHERE id=1$q$, 'not-null constraint');
SELECT pg_temp.expect_error($q$UPDATE payments SET amount_cents=-1 WHERE id='payment'$q$, 'check constraint');
UPDATE payments SET observed_version=-100 WHERE id='payment';
DELETE FROM hidden_audit WHERE audit_id='audit';
DELETE FROM audit WHERE id='audit';
INSERT INTO audit(id,actor,action,target_type,created_at) VALUES ('restored-audit','assistant','restored','backup','2001-01-01');
UPDATE agreements SET closed_at='2001-02-01',closed_by='assistant' WHERE id='purchase';
SET LOCAL wallet.restore_mode='off';
SELECT pg_temp.expect_error($q$DELETE FROM audit WHERE id='restored-audit'$q$, 'audit is immutable');
SELECT pg_temp.expect_error($q$UPDATE payments SET note='modified historical payment' WHERE id='payment'$q$, 'stale agreement write');
SELECT pg_temp.expect_true((SELECT amount_cents=400 FROM payments WHERE id='payment'), 'restore kept original money exactly');

-- Beyond 32-bit integers, values remain exact; the application owns JS-safe limits.
UPDATE entities SET reference_value_cents=9007199254740991 WHERE id='car';
SELECT pg_temp.expect_true((SELECT reference_value_cents=9007199254740991 FROM entities WHERE id='car'), 'BIGINT money is exact');

ROLLBACK;
SELECT 'PostgreSQL schema integrity checks passed; fixtures rolled back.' AS result;
