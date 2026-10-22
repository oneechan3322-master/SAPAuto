-- Migration 035 (v8.2 C.3): payments got absent_scan_streak/review_state in
-- 028 but not the bookkeeping columns the review queue shares with
-- obligations (review_note / review_updated_at / review_updated_by). The
-- ingestion absence pass and the payment-paid confirmation both write them.
ALTER TABLE payments ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN review_updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN review_updated_by TEXT NOT NULL DEFAULT '';
