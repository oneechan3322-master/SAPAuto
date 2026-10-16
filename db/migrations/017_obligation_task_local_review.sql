-- Plan 2.3 §2 / §5.2 — the office must never overwrite the source observation.
-- Extends the payment lane (016) to obligations and tasks. Additive only.

ALTER TABLE obligations ADD COLUMN local_review_status TEXT NOT NULL DEFAULT 'not_reviewed'
  CHECK(local_review_status IN ('not_reviewed','needs_review','evidence_pending','completed_locally'));
ALTER TABLE obligations ADD COLUMN local_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN local_reviewed_at TEXT;
ALTER TABLE obligations ADD COLUMN local_reviewed_by TEXT NOT NULL DEFAULT '';

ALTER TABLE tasks ADD COLUMN local_review_status TEXT NOT NULL DEFAULT 'not_reviewed'
  CHECK(local_review_status IN ('not_reviewed','needs_review','evidence_pending','completed_locally'));
ALTER TABLE tasks ADD COLUMN local_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN local_reviewed_at TEXT;
ALTER TABLE tasks ADD COLUMN local_reviewed_by TEXT NOT NULL DEFAULT '';

-- Preserve any local completion that was previously written over the source lane.
UPDATE obligations
   SET local_review_status = 'completed_locally', local_reviewed_at = COALESCE(local_reviewed_at, updated_at)
 WHERE LOWER(status) IN ('done','submitted','resolved','مكتمل','تم التقديم');

UPDATE tasks
   SET local_review_status = 'completed_locally', local_reviewed_at = COALESCE(local_reviewed_at, updated_at)
 WHERE LOWER(status) = 'done' AND origin = 'portal';

CREATE INDEX obligations_local_review_idx ON obligations(local_review_status, deadline);
CREATE INDEX tasks_local_review_idx ON tasks(local_review_status, deadline);