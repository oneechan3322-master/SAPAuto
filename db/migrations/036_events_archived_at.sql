-- Migration 036 (v8.2 A10): the events dispatcher backlog only ever drains
-- when at least one user channel is linked, so old events pile up as
-- announced=0 forever with nobody to receive them. `archived_at` moves them
-- out of the live delivery path (dispatcher reads exclude archived rows)
-- without destroying them — the rows stay in the database for review and
-- travel with the backups. Only stale, never-delivered events are archived.
ALTER TABLE events ADD COLUMN archived_at TEXT NOT NULL DEFAULT '';
