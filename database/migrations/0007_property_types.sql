-- Descriptive classification only. Existing IDs, units, leases and balances
-- stay unchanged; unknown legacy types remain NULL rather than being guessed.
ALTER TABLE entities ADD COLUMN property_type TEXT
  CHECK(property_type IS NULL OR (kind='property' AND property_type IN ('building','house','rest_house')));
