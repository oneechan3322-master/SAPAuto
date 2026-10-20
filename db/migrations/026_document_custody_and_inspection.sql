-- Real portal-document custody, direction, and OCR/inspection metadata.
ALTER TABLE company_documents ADD COLUMN direction TEXT NOT NULL DEFAULT 'incoming';
ALTER TABLE company_documents ADD COLUMN received_at TEXT NOT NULL DEFAULT '';
ALTER TABLE company_documents ADD COLUMN sent_at TEXT NOT NULL DEFAULT '';
ALTER TABLE company_documents ADD COLUMN registered_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE company_documents ADD COLUMN custodian TEXT NOT NULL DEFAULT '';
ALTER TABLE company_documents ADD COLUMN last_resaved_at TEXT NOT NULL DEFAULT '';
ALTER TABLE company_documents ADD COLUMN last_resaved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE company_documents ADD COLUMN ocr_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE company_documents ADD COLUMN ocr_text TEXT NOT NULL DEFAULT '';
ALTER TABLE company_documents ADD COLUMN ocr_updated_at TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS company_document_history (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES company_documents(id) ON DELETE CASCADE,
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_company_document_history_document ON company_document_history(document_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS company_inspection_profiles (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  inspection_officer TEXT NOT NULL DEFAULT '',
  books_from_year TEXT NOT NULL DEFAULT '',
  books_to_year TEXT NOT NULL DEFAULT '',
  inspection_notes TEXT NOT NULL DEFAULT '',
  source_document_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
