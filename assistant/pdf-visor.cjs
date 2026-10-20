'use strict';

/**
 * Tax Visor - structured exhibit helpers for studying official PDF documents.
 * One model call per study: the document text (real PDF content, not the
 * path) plus a strict-JSON exhibit request. Unparsable output degrades to
 * the raw paragraph (never invented facts), and read failures are recorded
 * as events so the accountant sees the truth instead of silence.
 */

const { PdfReadError } = require('./pdf-reader.cjs');

const isoDatePattern = /\d{4}-\d{2}-\d{2}/;

function extractJsonObject(text) {
  if (typeof text !== 'string' || !text.includes('{')) return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          const value = JSON.parse(cleaned.slice(start, index + 1));
          return value && typeof value === 'object' ? value : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function buildDocumentExhibitPrompt({ doc, pdf, pdfIssue }) {
  const company = doc.company || doc.account_key || '';
  const title = doc.title || doc.doc_number || '';
  const recordedDate = doc.date || doc.deadline || '';
  const action = doc.required_action || doc.headline || '';

  const lines = [
    `ادرس هذا المستند الضريبي الرسمي الصادر من مصلحة الضرائب المصرية:`,
    `الشركة: ${company}`,
    `عنوان/نوع المستند: ${doc_numberSafe(title)}`,
    `التاريخ المسجل في النظام: ${recordedDate}`,
    `الإجراء النظامي المطلوب مسبقًا: ${action}`
  ];

  if (pdf && pdf.slice && pdf.slice.text) {
    lines.push('نص المستند المستخرج من ملف PDF كما في النسخة الأصلية:');
    lines.push('<<<PDF_TEXT>>>');
    lines.push(pdf.slice.text);
    lines.push('<<<PDF_TEXT_END>>>');
    if (pdf.slice.truncated) {
      lines.push('تنبيه: النص مقتطع لأقصى حد يسمح به سياق النموذج؛ جدول التواريخ أو المبالغ الظاهر كاملًا يظل وثيقة اعتماد.');
    }
  } else {
    lines.push(`لم يتوفر نص PDF قراءته${pdfIssue ? ` (سبب: ${pdfIssue})` : '.'}`);
  }

  lines.push('المطلوب: درّس المستند كعين خبير قانوني مصري ثم أعد إجابة مكونة من JSON فقط دون أي نص خارجها بالمفاتيح الآتية:');
  lines.push('{');
  lines.push('"document_type": "إخطار|ربط|نموذج فحص|مطالبة سداد|طلب|غير محدد",');
  lines.push('"action_summary": "سطر أو سطران يشرحان ما يجري بالضبط",');
  lines.push('"dates_on_paper": [ { "raw": "التاريخ كما ورد", "iso": "YYYY-MM-DD أو نص فارغ إن لم يتأكد", "meaning": "معناه (مثال: نهاية مهلة، تاريخ الفحص، تاريخ الإشعار)" } ],');
  lines.push('"legal_status": "نهائي | قابل للطعن | غير محدد",');
  lines.push('"next_owner_action": "الإجراء التنفيذي التالي للمحاسب"');
  lines.push('}');
  lines.push('التزم: ISO يكتب فقط إن تكد من التاريخ، ولا تختلق تواريخ غير مذكورة في نص المستند؛ ما لا يذكره النص قيمته نص فارغ.');
  return lines.join('\n');
}

function doc_numberSafe(title) {
  return String(title ?? '').replace(/\n+/g, ' ').slice(0, 200);
}

function composeExhibitStudy(exhibit) {
  if (!exhibit || typeof exhibit !== 'object') return '';
  const dates = Array.isArray(exhibit.dates_on_paper)
    ? exhibit.dates_on_paper.filter((item) => item && (item.raw || item.iso))
      .map((item) => `${item.raw || ''}${item.iso ? ` (${item.iso})` : ''}${item.meaning ? ` — ${item.meaning}` : ''}`)
      .join('، ')
    : '';
  const parts = [];
  if (exhibit.document_type) {
    parts.push(`📋 المستند المطلوب (النوع: ${exhibit.document_type}): ${exhibit.action_summary ? exhibit.action_summary : ''}`.trim());
  } else if (exhibit.action_summary) {
    parts.push(`📋 المستند المطلوب: ${exhibit.action_summary}`);
  }
  if (dates || exhibit.legal_status) {
    parts.push(`⏳ المهلة القانونية: ${dates ? dates : 'وفقاً لقانون الإجراءات الضريبية الموحد 206/2020'} ${exhibit.legal_status ? `(الحالة: ${exhibit.legal_status})` : ''}`.trim());
  }
  if (exhibit.next_owner_action) {
    parts.push(`⚡ الإجراء التنفيذي: ${exhibit.next_owner_action}`);
  }
  parts.push(`👤 المسؤول المكلف: مدير المكتب`);
  return parts.join('\n').trim();
}

function normalizeEventIsoDate(iso) {
  const candidate = String(iso || '').trim();
  return isoDatePattern.test(candidate) ? candidate : '';
}

function persistTaskExhibit(db, taskRow, { analysis, exhibit, pdfMeta, pdfIssue }) {
  if (!db || !taskRow || !taskRow.id) return null;
  const nowIso = new Date().toISOString();
  const run = db.transaction(() => {
    const assignments = ['ai_study = ?', 'ai_studied_at = ?', 'updated_at = ?'];
    const values = [analysis, nowIso, nowIso];
    const deadlineWasEmpty = `${taskRow.deadline ?? ''}`.trim() === '';
    const exhibitIsoDate = exhibit && Array.isArray(exhibit.dates_on_paper)
      ? exhibit.dates_on_paper.map((item) => normalizeEventIsoDate(item && item.iso)).find(Boolean)
      : '';
    const dateApplied = Boolean(exhibitIsoDate && deadlineWasEmpty);
    if (dateApplied) {
      assignments.push('deadline = ?', 'urgency = ?');
      values.push(exhibitIsoDate, 'review');
    }
    db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values, taskRow.id);

    if (pdfIssue) {
      db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at)
        VALUES(?,?,?,?,?)`).run(`evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        'pdf_read_failed', taskRow.id, JSON.stringify({ taskId: taskRow.id, reason: pdfIssue }), nowIso);
    } else {
      db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at)
        VALUES(?,?,?,?,?)`).run(`evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        'pdf_studied', taskRow.id, JSON.stringify({
        taskId: taskRow.id,
        pages: pdfMeta && pdfMeta.pages,
        chars: pdfMeta && pdfMeta.chars,
        exhibited_date: exhibitIsoDate || '',
        deadline_filled: dateApplied,
        source: 'pdf-visor'
      }), nowIso);
      if (dateApplied) {
        db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at)
          VALUES(?,?,?,?,?)`).run(`evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          'task_date_extracted', taskRow.id,
          JSON.stringify({
          taskId: taskRow.id,
          iso: exhibitIsoDate,
          pages: pdfMeta && pdfMeta.pages,
          source: 'pdf-visor'
        }), nowIso);
      }
    }
  });
  run.immediate();
  return { analysis, exhibit };
}

/**
 * The visor normally runs as part of a fresh scrape, but documents can land in
 * the database without ever being studied (pause, restarts, older runs). The
 * assistant manager calls this small sweep each interval so no PDF sits unread
 * forever; each call studies at most `limit` documents and records the paper
 * trail event pieces that persistTaskExhibit produces.
 * @param {import('better-sqlite3').Database} db
 * @param {{ analyst?: { studyDocument: (row: object) => Promise<{ analysis?: string }> | { analysis?: string } }, limit?: number }} [options]
 * @returns {Promise<number>} how many documents were studied in this sweep
 */
async function sweepUnstudiedDocuments(db, { analyst, limit = 2 } = {}) {
  if (!db || typeof limit !== 'number' || limit < 1 || limit > 20) return 0;
  const rows = db.prepare(`
    SELECT id, company_id, account_key, doc_number, title, deadline, status, urgency, required_action, pdf_path
    FROM tasks
    WHERE pdf_path != '' AND (ai_study = '' OR ai_study IS NULL)
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT ?
  `).all(limit);
  let studied = 0;
  for (const row of rows) {
    const instance = analyst || new (require('./live-analyst.js').LiveAiAnalyst)({ db });
    try {
      const result = await instance.studyDocument(row);
      if (result && result.analysis) studied += 1;
    } catch (error) {
      console.warn(`[pdf-visor] sweep could not study task ${row.id}: ${error.message}`);
    }
  }
  return studied;
}

module.exports = {
  PdfReadError,
  extractJsonObject,
  buildDocumentExhibitPrompt,
  composeExhibitStudy,
  persistTaskExhibit,
  normalizeEventIsoDate,
  sweepUnstudiedDocuments
};
