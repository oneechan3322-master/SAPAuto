'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { getDatabase } = require('../db/connect')
const { extractPdfText } = require('../assistant/pdf-reader.cjs')

/**
 * Normalizes Arabic-Indic digits (٠-٩) to ASCII (0-9).
 * @param {string} str
 * @returns {string}
 */
function normalizeDigits(str) {
  if (typeof str !== 'string' || !str) return ''
  return str.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
}

/**
 * Sanitizes a string for safe usage as a filename across Windows / Linux.
 * @param {string} str
 * @returns {string}
 */
function sanitizeFilename(str) {
  if (typeof str !== 'string') return ''
  return str
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolves the official Egyptian Tax Authority (ETA) document title, company,
 * and clean display filename from task metadata and PDF content.
 * 
 * @param {object} params
 * @param {object} params.task - The DB task row
 * @param {string} [params.filePath] - Optional path to the PDF file
 * @param {object} params.db - Database instance
 * @returns {Promise<{ officialTitle: string, company: string, refNumber: string, displayFilename: string, caption: string }>}
 */
async function resolveOfficialPdfDetails({ task, filePath, db }) {
  if (!task || typeof task !== 'object') {
    throw new Error('resolveOfficialPdfDetails: task object is required')
  }
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('resolveOfficialPdfDetails: db instance is required')
  }

  const pdfTarget = filePath || task.pdf_path || ''
  let pdfText = ''
  if (pdfTarget && typeof pdfTarget === 'string' && fs.existsSync(pdfTarget)) {
    try {
      const extracted = await extractPdfText(pdfTarget)
      if (extracted && typeof extracted.text === 'string') {
        pdfText = extracted.text
      }
    } catch (err) {
      // Non-fatal: fallback to task metadata if PDF text extraction fails
      console.warn(`[resolveOfficialPdfDetails] Could not extract text for task ${task.id}: ${err.message}`)
    }
  }

  const rawNormalizedText = String(pdfText || '').normalize('NFKC')
  const taskTitle = String(task.title || '')
  const combinedText = `${taskTitle} ${rawNormalizedText}`
  const asciiCombined = normalizeDigits(combinedText)

  // 1. Resolve Company Name
  let company = ''
  if (task.account_key) {
    try {
      const compRow = db.prepare('SELECT name, portal_name FROM companies WHERE account_key = ? COLLATE NOCASE').get(task.account_key)
      if (compRow) {
        company = (compRow.name || compRow.portal_name || '').trim()
      }
    } catch (_) {}
  }
  if (!company && task.raw_json) {
    try {
      const parsed = JSON.parse(task.raw_json)
      if (parsed.company) company = String(parsed.company).trim()
      else if (parsed.company_name) company = String(parsed.company_name).trim()
    } catch (_) {}
  }
  if (!company && rawNormalizedText) {
    // Attempt extraction from PDF text
    const compMatch = rawNormalizedText.match(/(?:اسم\s+املمول|اسم\s+الممول|رشكة|شركة|الممول)\s*[:\/]\s*([^\n\r,]+)/i)
    if (compMatch && compMatch[1]) {
      const candidate = compMatch[1].replace(/[:\/]/g, '').trim()
      if (candidate.length >= 3 && candidate.length <= 80) {
        company = candidate
      }
    }
  }

  // 2. Resolve Official Document Title
  let officialTitle = ''
  const t = rawNormalizedText.toLowerCase()

  // Case A: نظام الدفعات المقدمة (Advance payments approval / renewal)
  if ((t.includes('دفعات') || combinedText.includes('دفعات')) && 
      (t.includes('تجديد') || t.includes('موافق') || t.includes('قبول') || combinedText.includes('قبول'))) {
    officialTitle = 'إخطار بالموافقة على تجديد نظام الدفعات المقدمة'
  } else if ((t.includes('دفعات') || combinedText.includes('دفعات')) && (t.includes('رفض') || combinedText.includes('رفض'))) {
    officialTitle = 'إخطار برفض تجديد نظام الدفعات المقدمة'
  }
  // Case B: قرار أو جلسة لجنة الطعن (Appeals committee)
  else if (t.includes('طعن') || combinedText.includes('طعن')) {
    if (t.includes('8/1') || t.includes('1/8') || t.includes('٨/١') || combinedText.includes('8/1')) {
      officialTitle = 'إعلان بقرار لجنة الطعن — نموذج (8-1)'
    } else if (t.includes('جلسة') || t.includes('تحديد') || combinedText.includes('جلسة')) {
      officialTitle = 'إخطار تحديد جلسة أمام لجنة الطعن الضريبي'
    } else {
      officialTitle = 'إعلان بقرار لجنة الطعن الضريبي'
    }
  }
  // Case C: نموذج 19 ربط الضريبة
  else if ((t.includes('19') || t.includes('١٩') || combinedText.includes('19') || combinedText.includes('١٩')) && 
           (t.includes('ربط') || t.includes('عناصر') || t.includes('دمغة') || combinedText.includes('ربط') || combinedText.includes('عناصر'))) {
    if (t.includes('دمغة') || combinedText.includes('دمغة')) {
      officialTitle = 'نموذج (19) دمغة — ربط ضريبة الدمغة والطعن'
    } else {
      officialTitle = 'نموذج (19) ضرائب — إخطار بعناصر ربط الضريبة'
    }
  }
  // Case D: نموذج 15 فحص ضريبي
  else if ((t.includes('15') || t.includes('١٥') || combinedText.includes('15') || combinedText.includes('١٥')) && 
           (t.includes('فحص') || combinedText.includes('فحص'))) {
    officialTitle = 'نموذج (15) فحص ضريبي — إخطار بالفحص الميداني'
  }
  // Case E: طلب تجهيز المستندات للفحص
  else if (t.includes('تجهيز') || combinedText.includes('تجهيز') || t.includes('دفاتر') || combinedText.includes('المادة 11')) {
    officialTitle = 'إخطار تجهيز المستندات والدفاتر للفحص الضريبي'
  }
  // Case F: تأكيد استلام المستندات
  else if (t.includes('استلام') || t.includes('إستلام') || combinedText.includes('استلام') || combinedText.includes('إستلام') || t.includes('تاكيد')) {
    officialTitle = 'إخطار تأكيد استلام المستندات'
  }
  // Case G: نموذج 38 مرتبات
  else if ((t.includes('38') || t.includes('٣٨')) && (t.includes('مرتبات') || combinedText.includes('مرتبات'))) {
    officialTitle = 'نموذج (38) ضريبة المرتبات وما في حكمها'
  }
  // Case H: ملاحظات قبول الفحص
  else if (taskTitle.includes('ملاحظات قبول') || t.includes('ملاحظات قبول')) {
    officialTitle = 'إشعار ملاحظات قبول الفحص الإلكتروني'
  }
  // Case I: أسباب الرفض
  else if (taskTitle.includes('اسباب الرفض') || taskTitle.includes('أسباب الرفض') || t.includes('اسباب الرفض')) {
    officialTitle = 'إشعار أسباب رفض المستندات الإلكترونية'
  }

  // Fallback clean title
  if (!officialTitle) {
    const cleaned = taskTitle
      .replace(/\(\d+\)/g, '')
      .replace(/[-_]\s*\d{8,14}/g, '')
      .trim()
    officialTitle = cleaned || 'مستند رسمي من مصلحة الضرائب المصرية'
  }

  // 3. Resolve Reference / Request Number
  let refNumber = ''
  const numMatch = asciiCombined.match(/(?:طلب|مرجعي|طعن|رقم|مستند|كود)?\s*[:\-_]?\s*(\d{8,14})/)
  if (numMatch && numMatch[1]) {
    refNumber = numMatch[1]
  }

  // 4. Construct Clean Display Filename
  const safeTitle = sanitizeFilename(officialTitle)
  const safeComp = sanitizeFilename(company)
  const displayFilename = safeComp 
    ? `${safeTitle} — ${safeComp}.pdf`
    : `${safeTitle}.pdf`

  // 5. Construct Rich WhatsApp Caption
  const lines = [
    `📄 *${officialTitle}*`,
    company ? `🏢 *الشركة:* ${company}` : '',
    refNumber ? `📋 *رقم المستند/الطلب:* ${refNumber}` : '',
    task.deadline ? `⏳ *الموعد المسجل:* ${task.deadline}` : ''
  ].filter(Boolean)

  const caption = lines.join('\n')

  return {
    officialTitle,
    company,
    refNumber,
    displayFilename,
    caption
  }
}

// Test against multiple files
async function runTests() {
  const db = getDatabase()
  const sampleTasks = db.prepare('SELECT * FROM tasks WHERE pdf_path IS NOT NULL LIMIT 5').all()
  console.log(`Testing with ${sampleTasks.length} tasks...`)
  for (const task of sampleTasks) {
    const res = await resolveOfficialPdfDetails({ task, db })
    console.log('-----------------------------------------')
    console.log('Task ID:', task.id)
    console.log('Original Title:', task.title)
    console.log('Official Title:', res.officialTitle)
    console.log('Company       :', res.company)
    console.log('Ref Number    :', res.refNumber)
    console.log('Filename      :', res.displayFilename)
    console.log('Caption:\n' + res.caption)
  }
}

if (require.main === module) {
  runTests().catch(console.error)
}

module.exports = {
  resolveOfficialPdfDetails,
  normalizeDigits,
  sanitizeFilename
}
