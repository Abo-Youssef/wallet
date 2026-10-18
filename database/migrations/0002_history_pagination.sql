-- Stable, indexed pagination for both chronological orders, including timestamp ties.
CREATE INDEX IF NOT EXISTS idx_audit_at_id ON audit(created_at DESC,id DESC);
