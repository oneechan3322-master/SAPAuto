-- Migration 028: obligation resolution state machine (Opus5.5 C5).
-- An absent obligation only counts as resolved after N consecutive
-- successful full-section scans; until then it sits in the review queue.
ALTER TABLE obligations ADD COLUMN absent_scan_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE obligations ADD COLUMN review_state TEXT
  CHECK (review_state IN ('needs_review','confirmed_resolved','confirmed_open'));
ALTER TABLE obligations ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN review_updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN review_updated_by TEXT NOT NULL DEFAULT '';

ALTER TABLE payments ADD COLUMN absent_scan_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN review_state TEXT
  CHECK (review_state IN ('needs_review','confirmed_resolved','confirmed_open'));
