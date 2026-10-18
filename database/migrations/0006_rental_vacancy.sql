-- Possession ends independently from the original financial agreement.
ALTER TABLE agreements ADD COLUMN vacated_on TEXT;
ALTER TABLE agreements ADD COLUMN vacated_at TEXT;
ALTER TABLE agreements ADD COLUMN vacated_by TEXT;
ALTER TABLE agreements ADD COLUMN vacate_note TEXT;

DROP TRIGGER agreement_closure_update;
-- Previously closed leases already released their units. Preserve that decision;
-- this date is the recorded closure date, not an invented physical handover date.
UPDATE agreements SET vacated_on=date(closed_at,'+3 hours'), vacated_at=closed_at,
  vacated_by=closed_by, vacate_note='إخلاء موروث من إغلاق العقد قبل إضافة تأكيد الإخلاء'
WHERE kind='rent' AND closed_at IS NOT NULL;

CREATE TRIGGER rental_vacancy_insert BEFORE INSERT ON agreements BEGIN
  SELECT CASE WHEN NEW.vacated_on IS NOT NULL OR NEW.vacated_at IS NOT NULL OR NEW.vacated_by IS NOT NULL OR NEW.vacate_note IS NOT NULL
  THEN RAISE(ABORT,'invalid rental vacancy') END;
END;
CREATE TRIGGER rental_vacancy_update BEFORE UPDATE ON agreements BEGIN
  SELECT CASE WHEN (NEW.vacated_at IS NULL)!=(NEW.vacated_on IS NULL) OR (NEW.vacated_at IS NULL)!=(NEW.vacated_by IS NULL) OR
    (NEW.vacated_at IS NULL AND NEW.vacate_note IS NOT NULL) OR
    (NEW.vacated_at IS NOT NULL AND (NEW.kind!='rent' OR NEW.status!='active' OR length(NEW.vacated_at)=0 OR length(NEW.vacated_by)=0 OR
      date(NEW.vacated_on) IS NOT NEW.vacated_on OR NEW.vacated_on<NEW.start_date OR NEW.vacated_on>date('now','+3 hours')))
  THEN RAISE(ABORT,'invalid rental vacancy') END;
  SELECT CASE WHEN OLD.vacated_at IS NOT NULL AND (NEW.vacated_on IS NOT OLD.vacated_on OR NEW.vacated_at IS NOT OLD.vacated_at OR
    NEW.vacated_by IS NOT OLD.vacated_by OR NEW.vacate_note IS NOT OLD.vacate_note OR NEW.entity_id IS NOT OLD.entity_id OR
    NEW.total_cents!=OLD.total_cents OR NEW.opening_cents!=OLD.opening_cents OR NEW.installment_count!=OLD.installment_count OR
    NEW.frequency_months!=OLD.frequency_months OR NEW.first_due_date!=OLD.first_due_date OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date)
  THEN RAISE(ABORT,'vacated rental locked') END;
  SELECT CASE WHEN OLD.kind='rent' AND OLD.status='active' AND NEW.status!='active' AND OLD.start_date<=date('now','+3 hours')
  THEN RAISE(ABORT,'rental requires vacancy') END;
END;

CREATE TRIGGER agreement_closure_update BEFORE UPDATE ON agreements BEGIN
  SELECT CASE WHEN (NEW.closed_at IS NULL)!=(NEW.closed_by IS NULL) OR
    (NEW.closed_at IS NOT NULL AND (NEW.status!='active' OR length(NEW.closed_at)=0 OR length(NEW.closed_by)=0))
  THEN RAISE(ABORT,'invalid agreement closure') END;
  SELECT CASE WHEN OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT NULL THEN RAISE(ABORT,'agreement closed') END;
  SELECT CASE WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND
    NEW.total_cents-NEW.opening_cents!=COALESCE((SELECT SUM(amount_cents) FROM payments WHERE agreement_id=OLD.id AND active=1),0)
  THEN RAISE(ABORT,'unpaid agreement closure') END;
  SELECT CASE WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.kind='rent' AND NEW.vacated_at IS NULL
  THEN RAISE(ABORT,'rental requires vacancy') END;
END;

DROP TRIGGER unit_use_update;
CREATE TRIGGER unit_use_update BEFORE UPDATE OF status ON entities
WHEN NEW.kind='unit' AND NEW.status IS NOT OLD.status AND NEW.status IN ('maintenance','personal_use','unavailable') BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.id AND kind='rent'
    AND status='active' AND closed_at IS NULL AND vacated_at IS NULL)
  THEN RAISE(ABORT,'unit has current rent') END;
END;

DROP TRIGGER rent_period_insert;
CREATE TRIGGER rent_period_insert BEFORE INSERT ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL BEGIN
  SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date THEN RAISE(ABORT,'invalid rent period') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.entity_id AND kind='rent' AND status='active' AND closed_at IS NULL
    AND (vacated_on IS NULL OR vacated_on>start_date) AND start_date<=max(NEW.end_date,date('now','+3 hours'))
    AND CASE WHEN vacated_on IS NOT NULL THEN date(vacated_on,'-1 day') ELSE max(end_date,date('now','+3 hours')) END>=NEW.start_date)
  THEN RAISE(ABORT,'overlapping rent') END;
END;
DROP TRIGGER rent_period_update;
CREATE TRIGGER rent_period_update BEFORE UPDATE ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.vacated_at IS NULL AND
  (NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.entity_id IS NOT OLD.entity_id OR
   NEW.kind!=OLD.kind OR NEW.status!=OLD.status OR OLD.closed_at IS NOT NULL) BEGIN
  SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date THEN RAISE(ABORT,'invalid rent period') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE id!=NEW.id AND entity_id=NEW.entity_id AND kind='rent' AND status='active' AND closed_at IS NULL
    AND (vacated_on IS NULL OR vacated_on>start_date) AND start_date<=max(NEW.end_date,date('now','+3 hours'))
    AND CASE WHEN vacated_on IS NOT NULL THEN date(vacated_on,'-1 day') ELSE max(end_date,date('now','+3 hours')) END>=NEW.start_date)
  THEN RAISE(ABORT,'overlapping rent') END;
END;
DROP TRIGGER rent_availability_update;
CREATE TRIGGER rent_availability_update BEFORE UPDATE ON agreements
WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.vacated_at IS NULL AND
  (OLD.kind!='rent' OR OLD.status!='active' OR OLD.closed_at IS NOT NULL OR
   NEW.entity_id IS NOT OLD.entity_id OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date) BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND status IN ('maintenance','personal_use','unavailable'))
  THEN RAISE(ABORT,'unit unavailable for rent') END;
END;
