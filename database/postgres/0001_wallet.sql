-- PostgreSQL schema for wallet JSON schema version 9.
-- Migrators apply this file once, in a transaction, as the schema owner.
-- Runtime writes must lock restore_control(id=1) before reading or validating
-- business rows. This preserves the single-wallet serial write semantics.
-- SET LOCAL wallet.restore_mode='on' is reserved for the validated restore
-- transaction. It bypasses business triggers, never CHECK or foreign keys.
-- Text dates and JSON preserve the existing API and exported backup format.
-- All integer fields use BIGINT to retain SQLite's range; the API rejects any
-- value outside JavaScript's safe integer range when decoding query results.


CREATE TABLE entities (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('property','unit','car','worker')),
 name TEXT NOT NULL, parent_id TEXT REFERENCES entities(id) DEFERRABLE INITIALLY IMMEDIATE, status TEXT DEFAULT 'available',
 reference_value_cents BIGINT, location TEXT, electricity_meter TEXT, plate TEXT,
 insurance_expiry TEXT, maintenance_date TEXT, odometer_km BIGINT, maintenance_due_km BIGINT,
 phone TEXT, work_location TEXT, iqama_number TEXT, iqama_expiry TEXT,
 passport_number TEXT, passport_expiry TEXT, notes TEXT,
 archived BIGINT NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
 version BIGINT NOT NULL DEFAULT 0, property_type TEXT
  CHECK(property_type IS NULL OR (kind='property' AND property_type IN ('building','house','rest_house'))));

CREATE TABLE agreements (
 id TEXT PRIMARY KEY, entity_id TEXT REFERENCES entities(id) DEFERRABLE INITIALLY IMMEDIATE,
 kind TEXT NOT NULL CHECK(kind IN ('purchase','sale','rent','other')),
 direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 title TEXT NOT NULL, contract_number TEXT, counterparty TEXT, phone TEXT,
 start_date TEXT, end_date TEXT, first_due_date TEXT NOT NULL,
 total_cents BIGINT NOT NULL CHECK(total_cents>=0), opening_cents BIGINT NOT NULL CHECK(opening_cents>=0 AND opening_cents<=total_cents),
 installment_count BIGINT NOT NULL CHECK(installment_count>0 AND installment_count<=600),
 frequency_months BIGINT NOT NULL CHECK(frequency_months IN (1,3,6,12)),
 note TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
 version BIGINT NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 closed_at TEXT, closed_by TEXT, vacated_on TEXT, vacated_at TEXT, vacated_by TEXT, vacate_note TEXT, rental_mode TEXT NOT NULL DEFAULT 'period' CHECK(rental_mode IN ('period','daily')), booking_cancelled_at TEXT, booking_cancelled_by TEXT, booking_cancel_note TEXT);

CREATE TABLE payments (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, agreement_id TEXT NOT NULL REFERENCES agreements(id) DEFERRABLE INITIALLY IMMEDIATE,
 slot_index BIGINT NOT NULL, amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
 paid_at TEXT NOT NULL, reschedule_method TEXT, note TEXT, active BIGINT NOT NULL DEFAULT 1,
 observed_version BIGINT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 updated_at TEXT,
 schedule_end_date TEXT
  CHECK(schedule_end_date IS NULL OR
    (length(schedule_end_date)=10 AND schedule_end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')));

CREATE TABLE expenses (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'out' CHECK(direction IN ('out','in')),
 amount_cents BIGINT NOT NULL CHECK(amount_cents>0), paid_at TEXT NOT NULL, entity_id TEXT REFERENCES entities(id) DEFERRABLE INITIALLY IMMEDIATE,
 note TEXT, active BIGINT NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 version BIGINT NOT NULL DEFAULT 0);

CREATE TABLE tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, due_date TEXT, assigned_to TEXT NOT NULL CHECK(assigned_to IN ('manager','assistant')),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','done')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, completed_by TEXT,
 version BIGINT NOT NULL DEFAULT 0);

CREATE TABLE dismissed_alerts (
 alert_key TEXT PRIMARY KEY, actor TEXT NOT NULL, dismissed_at TEXT NOT NULL
);

CREATE TABLE audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
 target_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
);

CREATE TABLE hidden_audit (
 audit_id TEXT PRIMARY KEY REFERENCES audit(id) DEFERRABLE INITIALLY IMMEDIATE, hidden_by TEXT NOT NULL, hidden_at TEXT NOT NULL
);

CREATE TABLE mutation_requests (
 request_id TEXT PRIMARY KEY, actor TEXT NOT NULL, scope TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE restore_control (
 id BIGINT PRIMARY KEY CHECK(id=1),
 generation TEXT NOT NULL DEFAULT '',
 revision BIGINT NOT NULL DEFAULT 0,
 last_request TEXT, last_actor TEXT, last_fingerprint TEXT,
 recovery_json TEXT, restored_at TEXT
);

INSERT INTO restore_control(id) VALUES (1);

CREATE INDEX idx_entities_kind ON entities(kind,archived);

CREATE INDEX idx_agreements_entity ON agreements(entity_id);

CREATE INDEX idx_payments_agreement ON payments(agreement_id,active);

CREATE INDEX idx_audit_at ON audit(created_at DESC);

CREATE INDEX idx_audit_at_id ON audit(created_at DESC,id DESC);

CREATE INDEX idx_rent_period ON agreements(entity_id,kind,status,start_date,end_date);

CREATE INDEX idx_agreements_open_entity ON agreements(entity_id,status,closed_at);

CREATE FUNCTION wallet_today() RETURNS TEXT
LANGUAGE sql STABLE
AS $$ SELECT to_char(statement_timestamp() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') $$;

CREATE FUNCTION wallet_date(value TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT
AS $$
DECLARE parsed DATE;
BEGIN
  IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  BEGIN
    parsed := value::DATE;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN NULL;
  END;
  IF to_char(parsed, 'YYYY-MM-DD') != value THEN RETURN NULL; END IF;
  RETURN value;
END;
$$;

CREATE FUNCTION wallet_previous_day(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT
AS $$ SELECT to_char(wallet_date(value)::DATE - 1, 'YYYY-MM-DD') $$;

CREATE FUNCTION wallet_ensure_insert_version() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF (SELECT version FROM agreements WHERE id=NEW.agreement_id)!= NEW.observed_version + 1
 THEN
    RAISE EXCEPTION 'stale agreement write' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ensure_insert_version BEFORE INSERT ON payments
FOR EACH ROW EXECUTE FUNCTION wallet_ensure_insert_version();

CREATE FUNCTION wallet_ensure_update_version() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF (SELECT version FROM agreements WHERE id=NEW.agreement_id)!=NEW.observed_version + 1
 THEN
    RAISE EXCEPTION 'stale agreement write' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ensure_update_version BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION wallet_ensure_update_version();

CREATE FUNCTION wallet_audit_no_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'audit is immutable' USING ERRCODE = '23514';
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
FOR EACH ROW EXECUTE FUNCTION wallet_audit_no_update();

CREATE FUNCTION wallet_audit_no_delete() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'audit is immutable' USING ERRCODE = '23514';
  RETURN OLD;
END;
$$;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
FOR EACH ROW EXECUTE FUNCTION wallet_audit_no_delete();

CREATE FUNCTION wallet_expense_link_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.entity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND kind IN ('property','unit','car'))
 THEN
    RAISE EXCEPTION 'invalid expense entity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER expense_link_insert BEFORE INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION wallet_expense_link_insert();

CREATE FUNCTION wallet_entity_identity_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.kind!=OLD.kind OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
  THEN
    RAISE EXCEPTION 'immutable entity identity' USING ERRCODE = '23514';
  END IF;
  IF NEW.archived=1 AND OLD.archived=0 AND
  (EXISTS(SELECT 1 FROM entities WHERE parent_id=OLD.id AND archived=0) OR
  EXISTS(SELECT 1 FROM agreements WHERE entity_id=OLD.id AND status='active' AND closed_at IS NULL))
  THEN
    RAISE EXCEPTION 'entity has active links' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER entity_identity_update BEFORE UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION wallet_entity_identity_update();

CREATE FUNCTION wallet_agreement_closure_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid agreement closure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agreement_closure_insert BEFORE INSERT ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_agreement_closure_insert();

CREATE FUNCTION wallet_payment_integrity_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND closed_at IS NOT NULL)
  THEN
    RAISE EXCEPTION 'agreement closed' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND status='active' AND NEW.slot_index>=0 AND NEW.slot_index<installment_count)
  THEN
    RAISE EXCEPTION 'invalid payment agreement' USING ERRCODE = '23514';
  END IF;
  IF NEW.reschedule_method IS NOT NULL AND NEW.reschedule_method NOT IN ('shorten','spread')
  THEN
    RAISE EXCEPTION 'invalid reschedule method' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_integrity_insert BEFORE INSERT ON payments
FOR EACH ROW EXECUTE FUNCTION wallet_payment_integrity_insert();

CREATE FUNCTION wallet_payment_integrity_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND closed_at IS NOT NULL)
  THEN
    RAISE EXCEPTION 'agreement closed' USING ERRCODE = '23514';
  END IF;
  IF NEW.agreement_id!=OLD.agreement_id OR NEW.request_id!=OLD.request_id OR NEW.created_at!=OLD.created_at
  THEN
    RAISE EXCEPTION 'immutable payment identity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND status='active' AND NEW.slot_index>=0 AND NEW.slot_index<installment_count)
  THEN
    RAISE EXCEPTION 'invalid payment agreement' USING ERRCODE = '23514';
  END IF;
  IF NEW.reschedule_method IS NOT NULL AND NEW.reschedule_method NOT IN ('shorten','spread')
  THEN
    RAISE EXCEPTION 'invalid reschedule method' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_integrity_update BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION wallet_payment_integrity_update();

CREATE FUNCTION wallet_rental_vacancy_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.vacated_on IS NOT NULL OR NEW.vacated_at IS NOT NULL OR NEW.vacated_by IS NOT NULL OR NEW.vacate_note IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid rental vacancy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rental_vacancy_insert BEFORE INSERT ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_rental_vacancy_insert();

CREATE FUNCTION wallet_rental_vacancy_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF (NEW.vacated_at IS NULL)!=(NEW.vacated_on IS NULL) OR (NEW.vacated_at IS NULL)!=(NEW.vacated_by IS NULL) OR
    (NEW.vacated_at IS NULL AND NEW.vacate_note IS NOT NULL) OR
    (NEW.vacated_at IS NOT NULL AND (NEW.kind!='rent' OR NEW.status!='active' OR length(NEW.vacated_at)=0 OR length(NEW.vacated_by)=0 OR
      wallet_date(NEW.vacated_on) IS DISTINCT FROM NEW.vacated_on OR NEW.vacated_on<NEW.start_date OR NEW.vacated_on>wallet_today()))
  THEN
    RAISE EXCEPTION 'invalid rental vacancy' USING ERRCODE = '23514';
  END IF;
  IF OLD.vacated_at IS NOT NULL AND (NEW.vacated_on IS DISTINCT FROM OLD.vacated_on OR NEW.vacated_at IS DISTINCT FROM OLD.vacated_at OR
    NEW.vacated_by IS DISTINCT FROM OLD.vacated_by OR NEW.vacate_note IS DISTINCT FROM OLD.vacate_note OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR
    NEW.total_cents!=OLD.total_cents OR NEW.opening_cents!=OLD.opening_cents OR NEW.installment_count!=OLD.installment_count OR
    NEW.frequency_months!=OLD.frequency_months OR NEW.first_due_date!=OLD.first_due_date OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date)
  THEN
    RAISE EXCEPTION 'vacated rental locked' USING ERRCODE = '23514';
  END IF;
  IF OLD.kind='rent' AND OLD.status='active' AND NEW.status!='active' AND OLD.start_date<=wallet_today()
  THEN
    RAISE EXCEPTION 'rental requires vacancy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rental_vacancy_update BEFORE UPDATE ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_rental_vacancy_update();

CREATE FUNCTION wallet_agreement_link_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF (NEW.kind='other' AND NEW.entity_id IS NOT NULL) OR
 (NEW.kind!='other' AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND
 ((NEW.kind='rent' AND ((NEW.rental_mode='period' AND kind='unit') OR (NEW.rental_mode='daily' AND kind='property' AND property_type='rest_house')))
 OR (NEW.kind IN ('purchase','sale') AND kind IN ('property','unit','car'))))) OR
 (NEW.direction!=CASE WHEN NEW.kind IN ('sale','rent') THEN 'in' ELSE 'out' END) THEN
    RAISE EXCEPTION 'invalid agreement entity' USING ERRCODE = '23514';
  END IF;
 IF (NEW.rental_mode='daily' AND (NEW.kind!='rent' OR NEW.status!='active' OR NEW.start_date IS NULL OR NEW.start_date IS DISTINCT FROM NEW.end_date
 OR NEW.first_due_date IS DISTINCT FROM NEW.start_date OR NEW.installment_count!=1 OR NEW.frequency_months!=1 OR NEW.opening_cents!=0 OR NEW.total_cents<=0 OR NEW.vacated_at IS NOT NULL)) OR (NEW.rental_mode!='daily' AND (NEW.booking_cancelled_at IS NOT NULL OR NEW.booking_cancelled_by IS NOT NULL OR NEW.booking_cancel_note IS NOT NULL))
 OR NEW.booking_cancelled_at IS NOT NULL OR NEW.booking_cancelled_by IS NOT NULL OR NEW.booking_cancel_note IS NOT NULL
 THEN
    RAISE EXCEPTION 'invalid daily booking' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agreement_link_insert BEFORE INSERT ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_agreement_link_insert();

CREATE FUNCTION wallet_agreement_link_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.status='active' AND NEW.closed_at IS NULL AND ((NEW.kind='other' AND NEW.entity_id IS NOT NULL) OR
 (NEW.kind!='other' AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND
 ((NEW.kind='rent' AND ((NEW.rental_mode='period' AND kind='unit') OR (NEW.rental_mode='daily' AND kind='property' AND property_type='rest_house')))
 OR (NEW.kind IN ('purchase','sale') AND kind IN ('property','unit','car'))))) OR
 (NEW.direction!=CASE WHEN NEW.kind IN ('sale','rent') THEN 'in' ELSE 'out' END)) THEN
    RAISE EXCEPTION 'invalid agreement entity' USING ERRCODE = '23514';
  END IF;
 IF EXISTS(SELECT 1 FROM payments WHERE agreement_id=OLD.id AND active=1) AND
 (NEW.status!='active' OR NEW.kind!=OLD.kind OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.total_cents!=OLD.total_cents OR NEW.opening_cents!=OLD.opening_cents OR NEW.installment_count!=OLD.installment_count OR NEW.frequency_months!=OLD.frequency_months OR NEW.first_due_date!=OLD.first_due_date OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date) THEN
    RAISE EXCEPTION 'paid agreement schedule locked' USING ERRCODE = '23514';
  END IF;
 IF NEW.rental_mode!=OLD.rental_mode OR (NEW.rental_mode='daily' AND (NEW.kind!='rent' OR NEW.status!='active' OR NEW.start_date IS NULL OR NEW.start_date IS DISTINCT FROM NEW.end_date
 OR NEW.first_due_date IS DISTINCT FROM NEW.start_date OR NEW.installment_count!=1 OR NEW.frequency_months!=1 OR NEW.opening_cents!=0 OR NEW.total_cents<=0 OR NEW.vacated_at IS NOT NULL))
 OR (OLD.rental_mode='daily' AND (NEW.kind!=OLD.kind OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.total_cents!=OLD.total_cents OR NEW.opening_cents!=OLD.opening_cents OR NEW.installment_count!=OLD.installment_count OR NEW.frequency_months!=OLD.frequency_months OR NEW.first_due_date!=OLD.first_due_date OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.status!=OLD.status))
 OR (NEW.rental_mode!='daily' AND (NEW.booking_cancelled_at IS NOT NULL OR NEW.booking_cancelled_by IS NOT NULL OR NEW.booking_cancel_note IS NOT NULL))
 OR ((NEW.booking_cancelled_at IS NULL)!=(NEW.booking_cancelled_by IS NULL))
 OR (NEW.booking_cancelled_at IS NULL AND NEW.booking_cancel_note IS NOT NULL)
 OR (NEW.booking_cancelled_at IS NOT NULL AND (length(NEW.booking_cancelled_at)=0 OR length(NEW.booking_cancelled_by)=0 OR length(trim(COALESCE(NEW.booking_cancel_note,'')))=0))
 OR (OLD.booking_cancelled_at IS NOT NULL AND (NEW.booking_cancelled_at IS DISTINCT FROM OLD.booking_cancelled_at OR NEW.booking_cancelled_by IS DISTINCT FROM OLD.booking_cancelled_by OR NEW.booking_cancel_note IS DISTINCT FROM OLD.booking_cancel_note))
 THEN
    RAISE EXCEPTION 'invalid daily booking' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agreement_link_update BEFORE UPDATE ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_agreement_link_update();

CREATE FUNCTION wallet_rent_period_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL THEN
  IF NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date THEN
    RAISE EXCEPTION 'invalid rent period' USING ERRCODE = '23514';
  END IF;
 IF EXISTS(SELECT 1 FROM agreements a WHERE a.id!=NEW.id AND a.kind='rent' AND a.status='active' AND a.closed_at IS NULL AND a.booking_cancelled_at IS NULL
 AND (a.vacated_on IS NULL OR a.vacated_on>a.start_date)
 AND (a.entity_id=NEW.entity_id
   OR (NEW.rental_mode='daily' AND a.entity_id IN (SELECT id FROM entities WHERE parent_id=NEW.entity_id))
   OR (a.rental_mode='daily' AND a.entity_id=(SELECT parent_id FROM entities WHERE id=NEW.entity_id)))
 AND a.start_date<=CASE WHEN NEW.rental_mode='daily' THEN NEW.end_date WHEN NEW.vacated_on IS NOT NULL THEN wallet_previous_day(NEW.vacated_on) ELSE greatest(NEW.end_date,wallet_today()) END AND CASE WHEN a.rental_mode='daily' THEN a.end_date WHEN a.vacated_on IS NOT NULL THEN wallet_previous_day(a.vacated_on) ELSE greatest(a.end_date,wallet_today()) END>=NEW.start_date) THEN
    RAISE EXCEPTION 'overlapping rent' USING ERRCODE = '23514';
  END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rent_period_insert BEFORE INSERT ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_rent_period_insert();

CREATE FUNCTION wallet_rent_availability_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL THEN
  IF EXISTS(SELECT 1 FROM entities WHERE (id=NEW.entity_id OR (NEW.rental_mode='daily' AND parent_id=NEW.entity_id AND archived=0))
 AND status IN ('maintenance','personal_use','unavailable')) THEN
    RAISE EXCEPTION 'unit unavailable for rent' USING ERRCODE = '23514';
  END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rent_availability_insert BEFORE INSERT ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_rent_availability_insert();

CREATE FUNCTION wallet_rent_period_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL AND NEW.vacated_at IS NULL AND (NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.kind!=OLD.kind OR NEW.status!=OLD.status OR OLD.closed_at IS NOT NULL) THEN
  IF NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date THEN
    RAISE EXCEPTION 'invalid rent period' USING ERRCODE = '23514';
  END IF;
 IF EXISTS(SELECT 1 FROM agreements a WHERE a.id!=NEW.id AND a.kind='rent' AND a.status='active' AND a.closed_at IS NULL AND a.booking_cancelled_at IS NULL
 AND (a.vacated_on IS NULL OR a.vacated_on>a.start_date)
 AND (a.entity_id=NEW.entity_id
   OR (NEW.rental_mode='daily' AND a.entity_id IN (SELECT id FROM entities WHERE parent_id=NEW.entity_id))
   OR (a.rental_mode='daily' AND a.entity_id=(SELECT parent_id FROM entities WHERE id=NEW.entity_id)))
 AND a.start_date<=CASE WHEN NEW.rental_mode='daily' THEN NEW.end_date WHEN NEW.vacated_on IS NOT NULL THEN wallet_previous_day(NEW.vacated_on) ELSE greatest(NEW.end_date,wallet_today()) END AND CASE WHEN a.rental_mode='daily' THEN a.end_date WHEN a.vacated_on IS NOT NULL THEN wallet_previous_day(a.vacated_on) ELSE greatest(a.end_date,wallet_today()) END>=NEW.start_date) THEN
    RAISE EXCEPTION 'overlapping rent' USING ERRCODE = '23514';
  END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rent_period_update BEFORE UPDATE ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_rent_period_update();

CREATE FUNCTION wallet_rent_availability_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL AND NEW.vacated_at IS NULL AND (NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.kind!=OLD.kind OR NEW.status!=OLD.status OR OLD.closed_at IS NOT NULL) THEN
  IF EXISTS(SELECT 1 FROM entities WHERE (id=NEW.entity_id OR (NEW.rental_mode='daily' AND parent_id=NEW.entity_id AND archived=0))
 AND status IN ('maintenance','personal_use','unavailable')) THEN
    RAISE EXCEPTION 'unit unavailable for rent' USING ERRCODE = '23514';
  END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rent_availability_update BEFORE UPDATE ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_rent_availability_update();

CREATE FUNCTION wallet_agreement_closure_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF (NEW.closed_at IS NULL)!=(NEW.closed_by IS NULL) OR (NEW.closed_at IS NOT NULL AND (NEW.status!='active' OR length(NEW.closed_at)=0 OR length(NEW.closed_by)=0))
 THEN
    RAISE EXCEPTION 'invalid agreement closure' USING ERRCODE = '23514';
  END IF;
 IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'agreement closed' USING ERRCODE = '23514';
  END IF;
 IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.total_cents-NEW.opening_cents!=COALESCE((SELECT SUM(amount_cents) FROM payments WHERE agreement_id=OLD.id AND active=1),0)
 THEN
    RAISE EXCEPTION 'unpaid agreement closure' USING ERRCODE = '23514';
  END IF;
 IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.kind='rent' AND NEW.rental_mode='period' AND NEW.vacated_at IS NULL THEN
    RAISE EXCEPTION 'rental requires vacancy' USING ERRCODE = '23514';
  END IF;
 IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.rental_mode='daily' AND NEW.booking_cancelled_at IS NULL AND NEW.end_date>=wallet_today() THEN
    RAISE EXCEPTION 'unexpired rent closure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agreement_closure_update BEFORE UPDATE ON agreements
FOR EACH ROW EXECUTE FUNCTION wallet_agreement_closure_update();

CREATE FUNCTION wallet_unit_use_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.kind='unit' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('maintenance','personal_use','unavailable') THEN
  IF EXISTS(SELECT 1 FROM agreements WHERE kind='rent' AND status='active' AND closed_at IS NULL AND booking_cancelled_at IS NULL
 AND ((entity_id=NEW.id AND vacated_at IS NULL) OR (rental_mode='daily' AND entity_id=NEW.parent_id AND end_date>=wallet_today())))
 THEN
    RAISE EXCEPTION 'unit has current rent' USING ERRCODE = '23514';
  END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER unit_use_update BEFORE UPDATE OF status ON entities
FOR EACH ROW EXECUTE FUNCTION wallet_unit_use_update();

CREATE FUNCTION wallet_rest_house_type_update() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.property_type IS DISTINCT FROM OLD.property_type AND EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.id AND rental_mode='daily') THEN
  RAISE EXCEPTION 'rest house has bookings' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rest_house_type_update BEFORE UPDATE OF property_type ON entities
FOR EACH ROW EXECUTE FUNCTION wallet_rest_house_type_update();

CREATE FUNCTION wallet_entity_parent_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('wallet.restore_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.parent_id IS NOT NULL AND (NEW.kind!='unit' OR NOT EXISTS
 (SELECT 1 FROM entities WHERE id=NEW.parent_id AND kind='property' AND archived=0))
 THEN
    RAISE EXCEPTION 'invalid entity parent' USING ERRCODE = '23514';
  END IF;
 IF NEW.kind='unit' AND NEW.status IN ('maintenance','personal_use','unavailable') AND
 EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.parent_id AND rental_mode='daily' AND status='active' AND closed_at IS NULL
 AND booking_cancelled_at IS NULL AND end_date>=wallet_today())
 THEN
    RAISE EXCEPTION 'unit has current rent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER entity_parent_insert BEFORE INSERT ON entities
FOR EACH ROW EXECUTE FUNCTION wallet_entity_parent_insert();
