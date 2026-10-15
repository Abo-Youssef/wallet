PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS entities (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('property','unit','car','worker')),
 name TEXT NOT NULL, parent_id TEXT REFERENCES entities(id), status TEXT DEFAULT 'available',
 reference_value_cents INTEGER, location TEXT, electricity_meter TEXT, plate TEXT,
 insurance_expiry TEXT, maintenance_date TEXT, odometer_km INTEGER, maintenance_due_km INTEGER,
 phone TEXT, work_location TEXT, iqama_number TEXT, iqama_expiry TEXT,
 passport_number TEXT, passport_expiry TEXT, notes TEXT,
 archived INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind,archived);
CREATE TABLE IF NOT EXISTS agreements (
 id TEXT PRIMARY KEY, entity_id TEXT REFERENCES entities(id),
 kind TEXT NOT NULL CHECK(kind IN ('purchase','sale','rent','other')),
 direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 title TEXT NOT NULL, contract_number TEXT, counterparty TEXT, phone TEXT,
 start_date TEXT, end_date TEXT, first_due_date TEXT NOT NULL,
 total_cents INTEGER NOT NULL CHECK(total_cents>=0), opening_cents INTEGER NOT NULL CHECK(opening_cents>=0 AND opening_cents<=total_cents),
 installment_count INTEGER NOT NULL CHECK(installment_count>0 AND installment_count<=600),
 frequency_months INTEGER NOT NULL CHECK(frequency_months IN (1,3,6,12)),
 note TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
 version INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agreements_entity ON agreements(entity_id);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, agreement_id TEXT NOT NULL REFERENCES agreements(id),
 slot_index INTEGER NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 paid_at TEXT NOT NULL, reschedule_method TEXT, note TEXT, active INTEGER NOT NULL DEFAULT 1,
 observed_version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_agreement ON payments(agreement_id,active);
CREATE TRIGGER IF NOT EXISTS ensure_insert_version BEFORE INSERT ON payments BEGIN
 SELECT CASE WHEN (SELECT version FROM agreements WHERE id=NEW.agreement_id)!= NEW.observed_version + 1
 THEN RAISE(ABORT,'stale agreement write') END;
END;
CREATE TRIGGER IF NOT EXISTS ensure_update_version BEFORE UPDATE ON payments BEGIN
 SELECT CASE WHEN (SELECT version FROM agreements WHERE id=NEW.agreement_id)!=NEW.observed_version + 1
 THEN RAISE(ABORT,'stale agreement write') END;
END;
CREATE TABLE IF NOT EXISTS expenses (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'out' CHECK(direction IN ('out','in')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), paid_at TEXT NOT NULL, entity_id TEXT REFERENCES entities(id),
 note TEXT, active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, due_date TEXT, assigned_to TEXT NOT NULL CHECK(assigned_to IN ('manager','assistant')),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','done')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, completed_by TEXT
);
CREATE TABLE IF NOT EXISTS dismissed_alerts (
 alert_key TEXT PRIMARY KEY, actor TEXT NOT NULL, dismissed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
 target_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(created_at DESC);
CREATE TABLE IF NOT EXISTS hidden_audit (
 audit_id TEXT PRIMARY KEY REFERENCES audit(id), hidden_by TEXT NOT NULL, hidden_at TEXT NOT NULL
);
-- Audit is append-only; hiding an entry is recorded in hidden_audit instead.
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;
