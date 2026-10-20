'use strict';

const { extractPdfText } = require('../assistant/pdf-reader.cjs');

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractInspectionFacts(text) {
  const source = clean(text);
  const officer = source.match(/(?:مأمور(?:\s+الفحص)?|مسؤول\s+الفحص|الفاحص)\s*[:：-]?\s*([^\n،.]{3,80})/i)?.[1] || '';
  const range = source.match(/(?:من\s+(?:سنة\s*)?)(\d{4})\s*(?:إلى|الي|حتى|ـ|-)\s*(?:سنة\s*)?(\d{4})/);
  const booksMentioned = /دفاتر|سجلات\s+محاسبية|فحص/.test(source);
  return {
    inspection_officer: clean(officer),
    books_from_year: range?.[1] || '',
    books_to_year: range?.[2] || '',
    inspection_notes: booksMentioned ? 'تم رصد إشارة إلى الفحص أو الدفاتر من نص ملف PDF المحفوظ.' : ''
  };
}

async function analyzeCompanyDocument(db, documentId) {
  const document = db.prepare(`SELECT id,company_id,file_path FROM company_documents WHERE id=?`).get(documentId);
  if (!document || !document.file_path) return { updated: false, reason: 'no_pdf' };
  const now = new Date().toISOString();
  try {
    const pdf = await extractPdfText(document.file_path);
    const text = clean(pdf.text);
    const ocrState = text ? 'text_extracted' : 'needs_ocr';
    db.prepare(`UPDATE company_documents SET ocr_state=?,ocr_text=?,ocr_updated_at=?,updated_at=? WHERE id=?`)
      .run(ocrState, text.slice(0, 40000), now, now, document.id);
    const facts = extractInspectionFacts(text);
    if (facts.inspection_officer || facts.books_from_year || facts.books_to_year || facts.inspection_notes) {
      db.prepare(`INSERT INTO company_inspection_profiles(company_id,inspection_officer,books_from_year,books_to_year,inspection_notes,source_document_id,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(company_id) DO UPDATE SET inspection_officer=excluded.inspection_officer,books_from_year=excluded.books_from_year,
          books_to_year=excluded.books_to_year,inspection_notes=excluded.inspection_notes,source_document_id=excluded.source_document_id,updated_at=excluded.updated_at`)
        .run(document.company_id, facts.inspection_officer, facts.books_from_year, facts.books_to_year, facts.inspection_notes, document.id, now);
    }
    return { updated: true, state: ocrState, facts };
  } catch (error) {
    db.prepare(`UPDATE company_documents SET ocr_state='failed',ocr_text='',ocr_updated_at=?,updated_at=? WHERE id=?`)
      .run(now, now, document.id);
    return { updated: false, reason: error.code || 'read_failed' };
  }
}

async function analyzePendingCompanyDocuments(db, limit = 10) {
  const rows = db.prepare(`SELECT id FROM company_documents WHERE file_path<>'' AND ocr_state IN ('pending','needs_ocr','failed') ORDER BY updated_at DESC LIMIT ?`).all(limit);
  const results = [];
  for (const row of rows) results.push(await analyzeCompanyDocument(db, row.id));
  return { examined: rows.length, extracted: results.filter((item) => item.state === 'text_extracted').length, needsOcr: results.filter((item) => item.state === 'needs_ocr').length, failed: results.filter((item) => item.reason && item.reason !== 'no_pdf').length };
}

module.exports = { analyzePendingCompanyDocuments, extractInspectionFacts };
