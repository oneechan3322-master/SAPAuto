-- Migration 023: legal deadline engine (Plan 4.5)
-- Plan 4.5 §18 follow-up ("الالتزامات المدروسة"): after the AI studies an
-- obligation, the record must state WHICH document the obligation demands,
-- the days the law gives to deliver it, and what the countdown is.
-- The engine (harness/deadlines.js) stamps these columns once per obligation;
-- the days live in legal_deadlines and stay editable DB rows — a change in
-- the law is a data update, not a code change. Values are Cairo-practice
-- defaults following Law 206/2020 and are explicitly marked as editable
-- baseline figures; escalation bands (fines up to 50,000 / 200,000 EGP after
-- 60 days for missing documents per the unified-law penalty tables) are
-- written into the basis text so the card shows the stakes, not just a count.
ALTER TABLE obligations ADD COLUMN required_doc TEXT NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN legal_days INTEGER;
ALTER TABLE obligations ADD COLUMN respond_by TEXT;
ALTER TABLE obligations ADD COLUMN deadline_basis TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS obligations_respond_by_idx ON obligations(respond_by);

CREATE TABLE legal_deadlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key TEXT NOT NULL UNIQUE,
  doc_name TEXT NOT NULL,
  legal_days INTEGER NOT NULL CHECK (legal_days > 0),
  basis TEXT NOT NULL
);

INSERT INTO legal_deadlines(match_key, doc_name, legal_days, basis) VALUES
  ('بطاقة ضريبية', 'بطاقة تعريف ضريبية', 15,
    'قانون الإجراءات الضريبية الموحد 206/2020 - المادة 21: إخطار المصلحة بالتغييرات خلال 15 يوماً من تاريخها (قاعدة مبدئية قابلة للتعديل)'),
  ('تجهيز مستندات', 'المستندات والدفاتر المطلوبة', 15,
    'قانون 206/2020 - المواد 7 و11 و42: تسليم المستندات والدفاتر عند الطلب؛ ميعاد التجهيز 15 يوماً من تاريخ الإخطار (مبدئي)، والغرامة الإدارية 3,000–50,000 جنيه تتصاعد بعد 60 يوماً من التأخر'),
  ('نموذج رقم (15) فحص', 'دفاتر ومستندات الفحص الضريبي', 15,
    'قانون 206/2020 - المواد 7 و11: استيفاء الدفاتر والمستندات عند مقابلة الفحص؛ ميعاد التجهيز 15 يوماً من إخطار الفحص (مبدئي)'),
  ('مستند مصلحة', 'مستند صادر عن المصلحة', 15,
    'قانون 206/2020 - قاعدة مبدئية 15 يوماً قابلة للتعديل بحسب نوع المستند والقرار الصادر به: راجع نص الإخطار قبل الاعتماد');
