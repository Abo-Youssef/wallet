-- Operational state is deliberately not replayed from uploaded backups.
-- A new generation invalidates every form opened before a restore.
CREATE TABLE restore_control (
 id INTEGER PRIMARY KEY CHECK(id=1),
 generation TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0,
 last_request TEXT, last_actor TEXT, last_fingerprint TEXT,
 recovery_json TEXT, restored_at TEXT
);
INSERT INTO restore_control(id) VALUES (1);
