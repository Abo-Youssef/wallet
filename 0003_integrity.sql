-- Additive migration: existing financial records and audit history are retained.
ALTER TABLE entities ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- The request receipt is committed in the SAME transaction as its business
-- changes and audit entry. A retry can never execute the operation twice.
CREATE TABLE mutation_requests (
 request_id TEXT PRIMARY KEY, actor TEXT NOT NULL, scope TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_rent_period ON agreements(entity_id,kind,status,start_date,end_date);

CREATE TRIGGER entity_parent_insert BEFORE INSERT ON entities BEGIN
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND (NEW.kind!='unit' OR NOT EXISTS
 (SELECT 1 FROM entities WHERE id=NEW.parent_id AND kind='property' AND archived=0))
 THEN RAISE(ABORT,'invalid entity parent') END;
END;
CREATE TRIGGER entity_identity_update BEFORE UPDATE ON entities BEGIN
 SELECT CASE WHEN NEW.kind!=OLD.kind OR NEW.parent_id IS NOT OLD.parent_id
 THEN RAISE(ABORT,'immutable entity identity') END;
 SELECT CASE WHEN NEW.archived=1 AND OLD.archived=0 AND
 (EXISTS(SELECT 1 FROM entities WHERE parent_id=OLD.id AND archived=0) OR
 EXISTS(SELECT 1 FROM agreements WHERE entity_id=OLD.id AND status='active'))
 THEN RAISE(ABORT,'entity has active links') END;
END;

CREATE TRIGGER agreement_link_insert BEFORE INSERT ON agreements BEGIN
 SELECT CASE WHEN
 (NEW.kind='other' AND NEW.entity_id IS NOT NULL) OR
 (NEW.kind!='other' AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND
 ((NEW.kind='rent' AND kind='unit') OR (NEW.kind IN ('purchase','sale') AND kind IN ('property','unit','car'))))) OR
 (NEW.direction != CASE WHEN NEW.kind IN ('sale','rent') THEN 'in' ELSE 'out' END)
 THEN RAISE(ABORT,'invalid agreement entity') END;
END;
CREATE TRIGGER agreement_link_update BEFORE UPDATE ON agreements BEGIN
 SELECT CASE WHEN NEW.status='active' AND (
 (NEW.kind='other' AND NEW.entity_id IS NOT NULL) OR
 (NEW.kind!='other' AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND
 ((NEW.kind='rent' AND kind='unit') OR (NEW.kind IN ('purchase','sale') AND kind IN ('property','unit','car'))))) OR
 (NEW.direction != CASE WHEN NEW.kind IN ('sale','rent') THEN 'in' ELSE 'out' END))
 THEN RAISE(ABORT,'invalid agreement entity') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM payments WHERE agreement_id=OLD.id AND active=1) AND
 (NEW.status!='active' OR NEW.kind!=OLD.kind OR NEW.entity_id IS NOT OLD.entity_id OR
 NEW.total_cents!=OLD.total_cents OR NEW.opening_cents!=OLD.opening_cents OR
 NEW.installment_count!=OLD.installment_count OR NEW.frequency_months!=OLD.frequency_months OR
 NEW.first_due_date!=OLD.first_due_date OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date)
 THEN RAISE(ABORT,'paid agreement schedule locked') END;
END;
CREATE TRIGGER rent_period_insert BEFORE INSERT ON agreements WHEN NEW.kind='rent' AND NEW.status='active' BEGIN
 SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date
 THEN RAISE(ABORT,'invalid rent period') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.entity_id AND kind='rent' AND status='active'
 AND start_date<=NEW.end_date AND end_date>=NEW.start_date)
 THEN RAISE(ABORT,'overlapping rent') END;
END;
CREATE TRIGGER rent_period_update BEFORE UPDATE ON agreements WHEN NEW.kind='rent' AND NEW.status='active' BEGIN
 SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date
 THEN RAISE(ABORT,'invalid rent period') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE id!=NEW.id AND entity_id=NEW.entity_id AND kind='rent' AND status='active'
 AND start_date<=NEW.end_date AND end_date>=NEW.start_date)
 THEN RAISE(ABORT,'overlapping rent') END;
END;
CREATE TRIGGER payment_integrity_insert BEFORE INSERT ON payments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND status='active' AND NEW.slot_index>=0 AND NEW.slot_index<installment_count)
 THEN RAISE(ABORT,'invalid payment agreement') END;
 SELECT CASE WHEN NEW.reschedule_method IS NOT NULL AND NEW.reschedule_method NOT IN ('shorten','spread')
 THEN RAISE(ABORT,'invalid reschedule method') END;
END;
CREATE TRIGGER payment_integrity_update BEFORE UPDATE ON payments BEGIN
 SELECT CASE WHEN NEW.agreement_id!=OLD.agreement_id OR NEW.request_id!=OLD.request_id OR NEW.created_at!=OLD.created_at
 THEN RAISE(ABORT,'immutable payment identity') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND status='active' AND NEW.slot_index>=0 AND NEW.slot_index<installment_count)
 THEN RAISE(ABORT,'invalid payment agreement') END;
 SELECT CASE WHEN NEW.reschedule_method IS NOT NULL AND NEW.reschedule_method NOT IN ('shorten','spread')
 THEN RAISE(ABORT,'invalid reschedule method') END;
END;
CREATE TRIGGER expense_link_insert BEFORE INSERT ON expenses BEGIN
 SELECT CASE WHEN NEW.entity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND kind IN ('property','unit','car'))
 THEN RAISE(ABORT,'invalid expense entity') END;
END;
