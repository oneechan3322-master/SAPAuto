-- Migration 025: Company Legal Documents Archive (أرشيف الوثائق والسجلات القانونية والمهل الرسمية)
-- Tracks core corporate legal documents and renewal deadlines:
-- 1. البطاقة الضريبية (Tax Card)
-- 2. السجل التجاري (Commercial Registry)
-- 3. شهادة تسجيل الضريبة على القيمة المضافة (VAT Registration Certificate)
-- 4. البطاقة الشخصية للمفوض/المدير (National ID of Authorized Signatory)
-- 5. التوقيع الإلكتروني / الختم الإلكتروني (E-Signature / E-Seal Certificate)

CREATE TABLE IF NOT EXISTS company_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  doc_number TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  assigned_role TEXT NOT NULL DEFAULT 'المحاسب القانوني للملف',
  status TEXT NOT NULL DEFAULT 'valid',
  notes TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_company_documents_company ON company_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_company_documents_type ON company_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_company_documents_expiry ON company_documents(expiry_date);
