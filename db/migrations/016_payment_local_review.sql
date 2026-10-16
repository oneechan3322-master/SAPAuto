-- Plan 2.1 §4.3 / §8.1 — source status and local review are two different facts.
-- Additive only: the source status that the portal supplied is never rewritten.

ALTER TABLE payments ADD COLUMN local_review_status TEXT NOT NULL DEFAULT 'not_reviewed'
  CHECK(local_review_status IN ('not_reviewed','needs_review','evidence_pending','paid_locally'));
ALTER TABLE payments ADD COLUMN local_paid_at TEXT;
ALTER TABLE payments ADD COLUMN local_paid_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN source_observed_at TEXT;

-- Preserve any local review that was previously written over the source status
-- so the distinction survives instead of being silently lost.
UPDATE payments
   SET local_review_status = 'paid_locally',
       local_paid_at = COALESCE(local_paid_at, updated_at)
 WHERE LOWER(status) IN ('paid','مسدد','مدفوع','تم السداد','مسدد بالكامل');

CREATE INDEX payments_local_review_idx ON payments(local_review_status, due_date);