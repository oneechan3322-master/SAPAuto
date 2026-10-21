-- Migration 029: hot read-path indexes for dashboard and scheduler queries.
CREATE INDEX IF NOT EXISTS ix_obl_company_deadline ON obligations(company_id, deadline);
CREATE INDEX IF NOT EXISTS ix_obl_status_deadline  ON obligations(status, deadline);
CREATE INDEX IF NOT EXISTS ix_obl_review_state    ON obligations(review_state) WHERE review_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tasks_status_deadline ON tasks(status, deadline);
CREATE INDEX IF NOT EXISTS ix_tasks_account_status  ON tasks(account_key, status);
CREATE INDEX IF NOT EXISTS ix_payments_account_status ON payments(account_key, due_date);
CREATE INDEX IF NOT EXISTS ix_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS ix_messages_account ON messages(account_key, created_at);
CREATE INDEX IF NOT EXISTS ix_reminders_user_due ON reminders(user_id, due_at);
