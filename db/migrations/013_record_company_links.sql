ALTER TABLE failures ADD COLUMN company_id TEXT REFERENCES companies(id);
ALTER TABLE reminders ADD COLUMN company_id TEXT REFERENCES companies(id);
ALTER TABLE reports ADD COLUMN company_id TEXT REFERENCES companies(id);

CREATE INDEX failures_company_idx ON failures(company_id);
CREATE INDEX reminders_company_idx ON reminders(company_id);
CREATE INDEX reports_company_idx ON reports(company_id);
