-- Migration 024: portal-date anchoring + definite-article portal forms (Plan 4.5 §2)
-- The live portal writes the tax-card status row as "البطاقة الضريبية سارية"
-- with the validity date embedded in the obligation code (e.g. 20280102).
-- That date IS the deadline the owner must act before (renew before expiry);
-- it comes from the portal, not from a law-computed 15-day window. A second
-- anchor mode is therefore recorded so the engine never invents a date the
-- record does not carry: law_window (creation day + rule days) as before,
-- portal_date (the exact date found in the record text, no fallback).
ALTER TABLE legal_deadlines ADD COLUMN anchor_mode TEXT NOT NULL DEFAULT 'law_window';
ALTER TABLE obligations ADD COLUMN anchor_mode TEXT NOT NULL DEFAULT '';
UPDATE obligations SET anchor_mode = '' WHERE anchor_mode IS NULL;

INSERT INTO legal_deadlines(match_key, doc_name, legal_days, basis, anchor_mode) VALUES
  ('البطاقة الضريبية سارية', 'بطاقة تعريف ضريبية', 15,
    'قانون الإجراءات الضريبية الموحد 206/2020 - المادة 21 (قاعدة الإخطار بالتغييرات)؛ التجديد مطلوب قبل انتهاء الصلاحية المدونة في البوابة',
    'portal_date');
