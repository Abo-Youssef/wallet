-- Closing is separate from cancellation: all financial records remain active
-- and retain their historical cash flow. Existing agreements remain open.
ALTER TABLE agreements ADD COLUMN closed_at TEXT;
ALTER TABLE agreements ADD COLUMN closed_by TEXT;
CREATE INDEX idx_agreements_open_entity ON agreements(entity_id,status,closed_at);

DROP TRIGGER entity_identity_update;
CREATE TRIGGER entity_identity_update BEFORE UPDATE ON entities BEGIN
  SELECT CASE WHEN NEW.kind!=OLD.kind OR NEW.parent_id IS NOT OLD.parent_id
  THEN RAISE(ABORT,'immutable entity identity') END;
  SELECT CASE WHEN NEW.archived=1 AND OLD.archived=0 AND
  (EXISTS(SELECT 1 FROM entities WHERE parent_id=OLD.id AND archived=0) OR
  EXISTS(SELECT 1 FROM agreements WHERE entity_id=OLD.id AND status='active' AND closed_at IS NULL))
  THEN RAISE(ABORT,'entity has active links') END;
END;

DROP TRIGGER agreement_link_update;
CREATE TRIGGER agreement_link_update BEFORE UPDATE ON agreements BEGIN
  SELECT CASE WHEN NEW.status='active' AND NEW.closed_at IS NULL AND (
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

CREATE TRIGGER agreement_closure_insert BEFORE INSERT ON agreements BEGIN
  SELECT CASE WHEN NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL
  THEN RAISE(ABORT,'invalid agreement closure') END;
END;
CREATE TRIGGER agreement_closure_update BEFORE UPDATE ON agreements BEGIN
  SELECT CASE WHEN (NEW.closed_at IS NULL)!=(NEW.closed_by IS NULL) OR
  (NEW.closed_at IS NOT NULL AND (NEW.status!='active' OR length(NEW.closed_at)=0 OR length(NEW.closed_by)=0))
  THEN RAISE(ABORT,'invalid agreement closure') END;
  SELECT CASE WHEN OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT NULL
  THEN RAISE(ABORT,'agreement closed') END;
  SELECT CASE WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND
  NEW.total_cents-NEW.opening_cents!=COALESCE((SELECT SUM(amount_cents) FROM payments WHERE agreement_id=OLD.id AND active=1),0)
  THEN RAISE(ABORT,'unpaid agreement closure') END;
  SELECT CASE WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.kind='rent' AND NEW.end_date>=date('now','+3 hours')
  THEN RAISE(ABORT,'unexpired rent closure') END;
END;

DROP TRIGGER rent_period_insert;
CREATE TRIGGER rent_period_insert BEFORE INSERT ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL BEGIN
  SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date
  THEN RAISE(ABORT,'invalid rent period') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.entity_id AND kind='rent' AND status='active' AND closed_at IS NULL
  AND start_date<=NEW.end_date AND end_date>=NEW.start_date)
  THEN RAISE(ABORT,'overlapping rent') END;
END;
DROP TRIGGER rent_period_update;
CREATE TRIGGER rent_period_update BEFORE UPDATE ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL BEGIN
  SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date
  THEN RAISE(ABORT,'invalid rent period') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE id!=NEW.id AND entity_id=NEW.entity_id AND kind='rent' AND status='active' AND closed_at IS NULL
  AND start_date<=NEW.end_date AND end_date>=NEW.start_date)
  THEN RAISE(ABORT,'overlapping rent') END;
END;

DROP TRIGGER payment_integrity_insert;
CREATE TRIGGER payment_integrity_insert BEFORE INSERT ON payments BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND closed_at IS NOT NULL)
  THEN RAISE(ABORT,'agreement closed') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND status='active' AND NEW.slot_index>=0 AND NEW.slot_index<installment_count)
  THEN RAISE(ABORT,'invalid payment agreement') END;
  SELECT CASE WHEN NEW.reschedule_method IS NOT NULL AND NEW.reschedule_method NOT IN ('shorten','spread')
  THEN RAISE(ABORT,'invalid reschedule method') END;
END;
DROP TRIGGER payment_integrity_update;
CREATE TRIGGER payment_integrity_update BEFORE UPDATE ON payments BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND closed_at IS NOT NULL)
  THEN RAISE(ABORT,'agreement closed') END;
  SELECT CASE WHEN NEW.agreement_id!=OLD.agreement_id OR NEW.request_id!=OLD.request_id OR NEW.created_at!=OLD.created_at
  THEN RAISE(ABORT,'immutable payment identity') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM agreements WHERE id=NEW.agreement_id AND status='active' AND NEW.slot_index>=0 AND NEW.slot_index<installment_count)
  THEN RAISE(ABORT,'invalid payment agreement') END;
  SELECT CASE WHEN NEW.reschedule_method IS NOT NULL AND NEW.reschedule_method NOT IN ('shorten','spread')
  THEN RAISE(ABORT,'invalid reschedule method') END;
END;
