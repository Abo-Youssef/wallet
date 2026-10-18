-- Daily reservations use the existing rent ledger; cancellation releases the day only.
-- Existing agreements retain their period/vacancy behavior and every financial row.
ALTER TABLE agreements ADD COLUMN rental_mode TEXT NOT NULL DEFAULT 'period' CHECK(rental_mode IN ('period','daily'));
ALTER TABLE agreements ADD COLUMN booking_cancelled_at TEXT;
ALTER TABLE agreements ADD COLUMN booking_cancelled_by TEXT;
ALTER TABLE agreements ADD COLUMN booking_cancel_note TEXT;

DROP TRIGGER agreement_link_insert;
CREATE TRIGGER agreement_link_insert BEFORE INSERT ON agreements BEGIN
 SELECT CASE WHEN (NEW.kind='other' AND NEW.entity_id IS NOT NULL) OR
 (NEW.kind!='other' AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND
 ((NEW.kind='rent' AND ((NEW.rental_mode='period' AND kind='unit') OR (NEW.rental_mode='daily' AND kind='property' AND property_type='rest_house')))
 OR (NEW.kind IN ('purchase','sale') AND kind IN ('property','unit','car'))))) OR
 (NEW.direction!=CASE WHEN NEW.kind IN ('sale','rent') THEN 'in' ELSE 'out' END) THEN RAISE(ABORT,'invalid agreement entity') END;
 SELECT CASE WHEN (NEW.rental_mode='daily' AND (NEW.kind!='rent' OR NEW.status!='active' OR NEW.start_date IS NULL OR NEW.start_date IS NOT NEW.end_date
 OR NEW.first_due_date IS NOT NEW.start_date OR NEW.installment_count!=1 OR NEW.frequency_months!=1 OR NEW.opening_cents!=0 OR NEW.total_cents<=0 OR NEW.vacated_at IS NOT NULL)) OR (NEW.rental_mode!='daily' AND (NEW.booking_cancelled_at IS NOT NULL OR NEW.booking_cancelled_by IS NOT NULL OR NEW.booking_cancel_note IS NOT NULL))
 OR NEW.booking_cancelled_at IS NOT NULL OR NEW.booking_cancelled_by IS NOT NULL OR NEW.booking_cancel_note IS NOT NULL
 THEN RAISE(ABORT,'invalid daily booking') END;
END;
DROP TRIGGER agreement_link_update;
CREATE TRIGGER agreement_link_update BEFORE UPDATE ON agreements BEGIN
 SELECT CASE WHEN NEW.status='active' AND NEW.closed_at IS NULL AND ((NEW.kind='other' AND NEW.entity_id IS NOT NULL) OR
 (NEW.kind!='other' AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND archived=0 AND
 ((NEW.kind='rent' AND ((NEW.rental_mode='period' AND kind='unit') OR (NEW.rental_mode='daily' AND kind='property' AND property_type='rest_house')))
 OR (NEW.kind IN ('purchase','sale') AND kind IN ('property','unit','car'))))) OR
 (NEW.direction!=CASE WHEN NEW.kind IN ('sale','rent') THEN 'in' ELSE 'out' END)) THEN RAISE(ABORT,'invalid agreement entity') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM payments WHERE agreement_id=OLD.id AND active=1) AND
 (NEW.status!='active' OR NEW.kind!=OLD.kind OR NEW.entity_id IS NOT OLD.entity_id OR NEW.total_cents!=OLD.total_cents OR NEW.opening_cents!=OLD.opening_cents OR NEW.installment_count!=OLD.installment_count OR NEW.frequency_months!=OLD.frequency_months OR NEW.first_due_date!=OLD.first_due_date OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date) THEN RAISE(ABORT,'paid agreement schedule locked') END;
 SELECT CASE WHEN NEW.rental_mode!=OLD.rental_mode OR (NEW.rental_mode='daily' AND (NEW.kind!='rent' OR NEW.status!='active' OR NEW.start_date IS NULL OR NEW.start_date IS NOT NEW.end_date
 OR NEW.first_due_date IS NOT NEW.start_date OR NEW.installment_count!=1 OR NEW.frequency_months!=1 OR NEW.opening_cents!=0 OR NEW.total_cents<=0 OR NEW.vacated_at IS NOT NULL))
 OR (OLD.rental_mode='daily' AND (NEW.kind!=OLD.kind OR NEW.entity_id IS NOT OLD.entity_id OR NEW.total_cents!=OLD.total_cents OR NEW.opening_cents!=OLD.opening_cents OR NEW.installment_count!=OLD.installment_count OR NEW.frequency_months!=OLD.frequency_months OR NEW.first_due_date!=OLD.first_due_date OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.status!=OLD.status))
 OR (NEW.rental_mode!='daily' AND (NEW.booking_cancelled_at IS NOT NULL OR NEW.booking_cancelled_by IS NOT NULL OR NEW.booking_cancel_note IS NOT NULL))
 OR ((NEW.booking_cancelled_at IS NULL)!=(NEW.booking_cancelled_by IS NULL))
 OR (NEW.booking_cancelled_at IS NULL AND NEW.booking_cancel_note IS NOT NULL)
 OR (NEW.booking_cancelled_at IS NOT NULL AND (length(NEW.booking_cancelled_at)=0 OR length(NEW.booking_cancelled_by)=0 OR length(trim(COALESCE(NEW.booking_cancel_note,'')))=0))
 OR (OLD.booking_cancelled_at IS NOT NULL AND (NEW.booking_cancelled_at IS NOT OLD.booking_cancelled_at OR NEW.booking_cancelled_by IS NOT OLD.booking_cancelled_by OR NEW.booking_cancel_note IS NOT OLD.booking_cancel_note))
 THEN RAISE(ABORT,'invalid daily booking') END;
END;

DROP TRIGGER rent_period_insert;
CREATE TRIGGER rent_period_insert BEFORE INSERT ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL  BEGIN
 SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date THEN RAISE(ABORT,'invalid rent period') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements a WHERE a.id!=NEW.id AND a.kind='rent' AND a.status='active' AND a.closed_at IS NULL AND a.booking_cancelled_at IS NULL
 AND (a.vacated_on IS NULL OR a.vacated_on>a.start_date)
 AND (a.entity_id=NEW.entity_id
   OR (NEW.rental_mode='daily' AND a.entity_id IN (SELECT id FROM entities WHERE parent_id=NEW.entity_id))
   OR (a.rental_mode='daily' AND a.entity_id=(SELECT parent_id FROM entities WHERE id=NEW.entity_id)))
 AND a.start_date<=CASE WHEN NEW.rental_mode='daily' THEN NEW.end_date WHEN NEW.vacated_on IS NOT NULL THEN date(NEW.vacated_on,'-1 day') ELSE max(NEW.end_date,date('now','+3 hours')) END AND CASE WHEN a.rental_mode='daily' THEN a.end_date WHEN a.vacated_on IS NOT NULL THEN date(a.vacated_on,'-1 day') ELSE max(a.end_date,date('now','+3 hours')) END>=NEW.start_date) THEN RAISE(ABORT,'overlapping rent') END;
END;
DROP TRIGGER rent_availability_insert;
CREATE TRIGGER rent_availability_insert BEFORE INSERT ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL  BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM entities WHERE (id=NEW.entity_id OR (NEW.rental_mode='daily' AND parent_id=NEW.entity_id AND archived=0))
 AND status IN ('maintenance','personal_use','unavailable')) THEN RAISE(ABORT,'unit unavailable for rent') END;
END;
DROP TRIGGER rent_period_update;
CREATE TRIGGER rent_period_update BEFORE UPDATE ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL AND NEW.vacated_at IS NULL AND (NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.entity_id IS NOT OLD.entity_id OR NEW.kind!=OLD.kind OR NEW.status!=OLD.status OR OLD.closed_at IS NOT NULL) BEGIN
 SELECT CASE WHEN NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date>NEW.end_date THEN RAISE(ABORT,'invalid rent period') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements a WHERE a.id!=NEW.id AND a.kind='rent' AND a.status='active' AND a.closed_at IS NULL AND a.booking_cancelled_at IS NULL
 AND (a.vacated_on IS NULL OR a.vacated_on>a.start_date)
 AND (a.entity_id=NEW.entity_id
   OR (NEW.rental_mode='daily' AND a.entity_id IN (SELECT id FROM entities WHERE parent_id=NEW.entity_id))
   OR (a.rental_mode='daily' AND a.entity_id=(SELECT parent_id FROM entities WHERE id=NEW.entity_id)))
 AND a.start_date<=CASE WHEN NEW.rental_mode='daily' THEN NEW.end_date WHEN NEW.vacated_on IS NOT NULL THEN date(NEW.vacated_on,'-1 day') ELSE max(NEW.end_date,date('now','+3 hours')) END AND CASE WHEN a.rental_mode='daily' THEN a.end_date WHEN a.vacated_on IS NOT NULL THEN date(a.vacated_on,'-1 day') ELSE max(a.end_date,date('now','+3 hours')) END>=NEW.start_date) THEN RAISE(ABORT,'overlapping rent') END;
END;
DROP TRIGGER rent_availability_update;
CREATE TRIGGER rent_availability_update BEFORE UPDATE ON agreements WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND NEW.booking_cancelled_at IS NULL AND NEW.vacated_at IS NULL AND (NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.entity_id IS NOT OLD.entity_id OR NEW.kind!=OLD.kind OR NEW.status!=OLD.status OR OLD.closed_at IS NOT NULL) BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM entities WHERE (id=NEW.entity_id OR (NEW.rental_mode='daily' AND parent_id=NEW.entity_id AND archived=0))
 AND status IN ('maintenance','personal_use','unavailable')) THEN RAISE(ABORT,'unit unavailable for rent') END;
END;

DROP TRIGGER agreement_closure_update;
CREATE TRIGGER agreement_closure_update BEFORE UPDATE ON agreements BEGIN
 SELECT CASE WHEN (NEW.closed_at IS NULL)!=(NEW.closed_by IS NULL) OR (NEW.closed_at IS NOT NULL AND (NEW.status!='active' OR length(NEW.closed_at)=0 OR length(NEW.closed_by)=0))
 THEN RAISE(ABORT,'invalid agreement closure') END;
 SELECT CASE WHEN OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT NULL THEN RAISE(ABORT,'agreement closed') END;
 SELECT CASE WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.total_cents-NEW.opening_cents!=COALESCE((SELECT SUM(amount_cents) FROM payments WHERE agreement_id=OLD.id AND active=1),0)
 THEN RAISE(ABORT,'unpaid agreement closure') END;
 SELECT CASE WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.kind='rent' AND NEW.rental_mode='period' AND NEW.vacated_at IS NULL THEN RAISE(ABORT,'rental requires vacancy') END;
 SELECT CASE WHEN OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.rental_mode='daily' AND NEW.booking_cancelled_at IS NULL AND NEW.end_date>=date('now','+3 hours') THEN RAISE(ABORT,'unexpired rent closure') END;
END;

DROP TRIGGER unit_use_update;
CREATE TRIGGER unit_use_update BEFORE UPDATE OF status ON entities
WHEN NEW.kind='unit' AND NEW.status IS NOT OLD.status AND NEW.status IN ('maintenance','personal_use','unavailable') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE kind='rent' AND status='active' AND closed_at IS NULL AND booking_cancelled_at IS NULL
 AND ((entity_id=NEW.id AND vacated_at IS NULL) OR (rental_mode='daily' AND entity_id=NEW.parent_id AND end_date>=date('now','+3 hours'))))
 THEN RAISE(ABORT,'unit has current rent') END;
END;

CREATE TRIGGER rest_house_type_update BEFORE UPDATE OF property_type ON entities
WHEN NEW.property_type IS NOT OLD.property_type AND EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.id AND rental_mode='daily') BEGIN
 SELECT RAISE(ABORT,'rest house has bookings');
END;

DROP TRIGGER entity_parent_insert;
CREATE TRIGGER entity_parent_insert BEFORE INSERT ON entities BEGIN
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND (NEW.kind!='unit' OR NOT EXISTS
 (SELECT 1 FROM entities WHERE id=NEW.parent_id AND kind='property' AND archived=0))
 THEN RAISE(ABORT,'invalid entity parent') END;
 SELECT CASE WHEN NEW.kind='unit' AND NEW.status IN ('maintenance','personal_use','unavailable') AND
 EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.parent_id AND rental_mode='daily' AND status='active' AND closed_at IS NULL
 AND booking_cancelled_at IS NULL AND end_date>=date('now','+3 hours'))
 THEN RAISE(ABORT,'unit has current rent') END;
END;
