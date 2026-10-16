-- Plan 2.3 §2 "truth over polish" — the upstream portal store flags a claim it
-- could no longer read completely (`stale`). Ingesting that as a normal payment
-- would let an unreadable observation be counted as a clean overdue record.
-- Kept separate from both the source status and the local review lane.

ALTER TABLE payments ADD COLUMN source_stale INTEGER NOT NULL DEFAULT 0
  CHECK(source_stale IN (0,1));

CREATE INDEX payments_source_stale_idx ON payments(source_stale, due_date);