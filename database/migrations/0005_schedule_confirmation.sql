-- Preserve legacy payments exactly. New receipts store the explicitly confirmed
-- payment schedule end separately from agreements.end_date (the rental period).
ALTER TABLE payments ADD COLUMN schedule_end_date TEXT
  CHECK(schedule_end_date IS NULL OR
    (length(schedule_end_date)=10 AND schedule_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));

-- Availability checks must remain atomic when two assistants save concurrently.
CREATE TRIGGER unit_use_update BEFORE UPDATE OF status ON entities
WHEN NEW.kind='unit' AND NEW.status IS NOT OLD.status AND NEW.status IN ('maintenance','personal_use','unavailable') BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM agreements WHERE entity_id=NEW.id AND kind='rent'
    AND status='active' AND closed_at IS NULL AND end_date>=date('now','+3 hours'))
  THEN RAISE(ABORT,'unit has current rent') END;
END;
CREATE TRIGGER rent_availability_insert BEFORE INSERT ON agreements
WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND status IN ('maintenance','personal_use','unavailable'))
  THEN RAISE(ABORT,'unit unavailable for rent') END;
END;
CREATE TRIGGER rent_availability_update BEFORE UPDATE ON agreements
WHEN NEW.kind='rent' AND NEW.status='active' AND NEW.closed_at IS NULL AND
  (OLD.kind!='rent' OR OLD.status!='active' OR OLD.closed_at IS NOT NULL OR
   NEW.entity_id IS NOT OLD.entity_id OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date) BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND status IN ('maintenance','personal_use','unavailable'))
  THEN RAISE(ABORT,'unit unavailable for rent') END;
END;
