'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { id } = require('../db/queries/shared')
const summarize = require('../assistant/tools/summarize')
const listDocuments = require('../assistant/tools/list-documents')
const { extractPdfText } = require('../assistant/pdf-reader.cjs')
const { localDataRoot } = require('../assistant/paths.cjs')
const { resolveOfficialPdfDetails } = require('../assistant/document-title-resolver.cjs')

function clean(value) {
  return String(value || '').trim().toLowerCase()
}

function isNewsRequest(text) {
  const value = clean(text)
  return /^(hello|hi|سلام|اهلا|أهلا|الأخبار|الاخبار|ما الجديد|ماذا هناك|what'?s new|news|latest)\b/.test(value) ||
    value.includes('الجديد') || value.includes('آخر الأخبار')
}

function isDateRequest(text) {
  const value = clean(text)
  return value.includes('متى') || value.includes('تاريخ') || value.includes('when was') || value.includes('date')
}

function isIncomingPdfReadRequest(text) {
  const value = clean(text)
  return value.includes('اقرأ') || value.includes('اقرا') || value.includes('read this pdf')
}

function isDocumentListRequest(text) {
  const value = clean(text)
  return /\b(?:list|show|available\s+documents|documents?)\b/.test(value) ||
    /(?:\u0625\u062f\u0631\u0627\u062c|\u0627\u0639\u0631\u0636|\u0639\u0631\u0636|\u0642\u0627\u0626\u0645\u0629).{0,30}(?:\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a|\u0627\u0644\u0648\u062b\u0627\u0626\u0642)/.test(value)
}

function isPdfSendRequest(text) {
  const value = clean(text)
  if (value === 'pdf') return true
  if (/(?:أرسل|ارسل|هات|ابعث|send|get)\s+.*(?:pdf|ملف|مستند)/i.test(value)) return true
  if (/(?:pdf|ملف)\b/i.test(value) && !value.includes('اقرأ') && !value.includes('اقرا')) return true
  return false
}

function parseScanRequest(text) {
  const value = String(text || '').trim()
  if (!value) return null
  if (/^(?:scan|launch)\s+(?:all|all\s+accounts)$/i.test(value) ||
      /^(?:\u0627\u0641\u062d\u0635|\u0634\u063a\u0644)\s+(?:\u0643\u0644\s+)?\u0627\u0644\u062d\u0633\u0627\u0628\u0627\u062a$/.test(value)) {
    return { account: '' }
  }
  const match = value.match(/^(?:scan|launch|\u0627\u0641\u062d\u0635|\u0634\u063a\u0644)\s+([A-Za-z0-9_-]{1,150})$/i)
  return match ? { account: match[1] } : null
}

function shortDate(value) {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '')
}

async function latestNews(db) {
  const summary = await summarize({ scope: 'all', period: 'today' })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())
  
  // Prioritize upcoming tasks (current date or future)
  let documents = db.prepare(`SELECT title, account_key, deadline FROM tasks
    WHERE status<>'done' AND deadline >= ?
    ORDER BY deadline ASC LIMIT 5`).all(today)
  
  // If fewer than 5 upcoming, fill with the closest past deadlines (newest past deadlines first)
  if (documents.length < 5) {
    const remaining = 5 - documents.length
    const fallback = db.prepare(`SELECT title, account_key, deadline FROM tasks
      WHERE status<>'done' AND (deadline < ? OR deadline IS NULL OR deadline='')
      ORDER BY CASE WHEN deadline IS NOT NULL AND deadline <> '' THEN deadline ELSE '0000-00-00' END DESC, updated_at DESC LIMIT ?`).all(today, remaining)
    documents = documents.concat(fallback)
  }

  const lines = [
    'ملخص SAPAuto — أقرب المواعيد أولًا',
    `التزامات متأخرة: ${summary.overdueObligations} | خلال 7 أيام: ${summary.obligationsDueWithin7Days} | مهام مفتوحة: ${summary.tasks} | إخفاقات: ${summary.openFailures}`
  ]
  if (documents.length) {
    lines.push('', 'أقرب المستندات:')
    for (const row of documents) {
      const deadline = row.deadline ? ` — الموعد ${shortDate(row.deadline)}` : ''
      lines.push(`• ${row.title} — ${row.account_key}${deadline}`)
    }
  }
  return lines.join('\n').slice(0, 3800)
}

function dateAnswer(db) {
  const rows = db.prepare(`SELECT title,account_key,received_at,created_at FROM messages
    WHERE received_at IS NOT NULL ORDER BY received_at DESC LIMIT 10`).all()
  if (!rows.length) return 'لا توجد رسالة مؤرخة في قاعدة البيانات المحلية.'
  return ['تواريخ أحدث الرسائل المسجلة:', ...rows.map((row) => `• ${row.received_at} — ${row.title} (${row.account_key})`)].join('\n')
}

async function documentListAnswer() {
  const result = await listDocuments()
  const documents = Array.isArray(result.documents) ? result.documents : []
  const upcoming = Array.isArray(result.upcoming) ? result.upcoming : []
  const overdue = Array.isArray(result.overdue) ? result.overdue : []
  const lines = [
    `📂 المستندات المفتوحة المتاحة: ${documents.length}`,
    'هذه قائمة من سجل SAPAuto المحلي، وليست مسحاً جديداً للبوابة.'
  ]
  for (const [index, row] of documents.entries()) {
    const number = row.doc_number || `مستند ${index + 1}`
    const title = row.title || 'بدون عنوان مسجل'
    const company = row.account || 'حساب غير محدد'
    const deadline = row.deadline ? `، الموعد: ${shortDate(row.deadline)}` : '، الموعد غير مسجل'
    const pdf = row.has_pdf ? '، PDF محفوظ' : ''
    lines.push(`${index + 1}. *${number}* — ${title}\n   ${company}${deadline}${pdf}`)
  }
  if (upcoming.length || overdue.length) {
    lines.push(`\nالالتزامات: ${upcoming.length} قادمة، ${overdue.length} تجاوزت الموعد المسجل.`)
  }
  lines.push('\nلقراءة PDF محدد: أرسل الملف مع عبارة «اقرأ هذا PDF».')
  return lines.join('\n').slice(0, 3800)
}

async function readIncomingPdf(message, user, runAssistant) {
  if (!message.hasMedia || typeof message.downloadMedia !== 'function') {
    return 'أرسل ملف PDF في نفس الرسالة مع عبارة «اقرأ هذا PDF».'
  }
  const media = await message.downloadMedia()
  if (!media || media.mimetype !== 'application/pdf' || !media.data) return 'الملف المرفق ليس PDF صالحًا.'
  const directory = path.join(localDataRoot(), 'inbox', 'whatsapp')
  await fs.mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `${id('whatsapp-pdf')}.pdf`)
  await fs.writeFile(filePath, Buffer.from(media.data, 'base64'))
  try {
    const extracted = await extractPdfText(filePath)
    const prompt = `اقرأ ملف PDF المرسل من المستخدم. لخصه بالعربية بدقة، واذكر التاريخ ورقم المستند والشركة والمهلة والإجراء المطلوب. لا تخترع قيمة غير موجودة.\n\nنص PDF:\n${String(extracted.text || '').slice(0, 18000)}`
    const result = await runAssistant({ userId: user.userId, role: user.role, text: prompt })
    return result.reply
  } finally {
    await fs.unlink(filePath).catch(() => {})
  }
}

/**
 * Finds matching tasks with actual PDF files on disk.
 * If text contains a number or account key, searches by that.
 * Otherwise returns upcoming tasks with PDFs (deadline >= today),
 * or falls back to the most recently updated tasks with PDFs.
 */
function findTasksWithPdf(db, text = '', limit = 5) {
  const fsSync = require('node:fs')
  const norm = String(text || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
  const numMatch = norm.match(/\b\d{4,14}\b/)
  if (numMatch) {
    const num = numMatch[0]
    const rows = db.prepare(`SELECT * FROM tasks 
      WHERE (doc_number LIKE ? OR title LIKE ? OR title LIKE ?)
      AND pdf_path IS NOT NULL AND pdf_path <> ''
      ORDER BY updated_at DESC LIMIT ?`).all(`%${num}%`, `%${num}%`, `%${numMatch[0]}%`, limit)
    const valid = rows.filter((r) => r.pdf_path && fsSync.existsSync(r.pdf_path))
    if (valid.length) return valid
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())

  // Check if user specified a count (e.g., "3 pdf" or "كل الـ pdf" / "all")
  let maxCount = limit
  const countMatch = norm.match(/\b(\d{1,2})\s*pdf\b|\bpdf\s*(\d{1,2})\b/i)
  if (countMatch) {
    maxCount = Math.min(10, Math.max(1, Number(countMatch[1] || countMatch[2] || limit)))
  } else if (/كل|جميع|all/i.test(text)) {
    maxCount = 10
  }

  // 1. Upcoming tasks with PDFs (deadline >= today)
  let tasks = db.prepare(`SELECT * FROM tasks 
    WHERE pdf_path IS NOT NULL AND pdf_path <> '' AND deadline >= ?
    ORDER BY deadline ASC LIMIT ?`).all(today, maxCount)
  tasks = tasks.filter((r) => r.pdf_path && fsSync.existsSync(r.pdf_path))

  // 2. If fewer than maxCount, add most recently updated tasks with PDFs
  if (tasks.length < maxCount) {
    const remaining = maxCount - tasks.length
    const existingIds = tasks.map((t) => t.id)
    const placeholders = existingIds.length ? `AND id NOT IN (${existingIds.map(() => '?').join(',')})` : ''
    const fallback = db.prepare(`SELECT * FROM tasks 
      WHERE pdf_path IS NOT NULL AND pdf_path <> '' ${placeholders}
      ORDER BY updated_at DESC LIMIT ?`).all(...existingIds, remaining)
    for (const r of fallback) {
      if (r.pdf_path && fsSync.existsSync(r.pdf_path)) {
        tasks.push(r)
      }
    }
  }

  return tasks
}

async function handleIntent({ text, message, db, user, runAssistant, sendDocument, replyTo }) {
  if (isDocumentListRequest(text)) return documentListAnswer()
  
  // When user sends an actual PDF attachment to read
  if (message?.hasMedia && isIncomingPdfReadRequest(text)) {
    return readIncomingPdf(message, user, runAssistant)
  }

  // When user asks to send them PDFs via WhatsApp (e.g., text is "pdf" or "أرسل ملف pdf")
  if (isPdfSendRequest(text)) {
    const tasks = findTasksWithPdf(db, text)
    if (!tasks || !tasks.length) {
      return 'لا يوجد ملف PDF متاح في السجل المحلي حالياً.'
    }
    if (typeof sendDocument === 'function' && replyTo) {
      let sentCount = 0
      for (const task of tasks) {
        let details
        try {
          details = await resolveOfficialPdfDetails({ task, db })
        } catch (_) {
          details = {
            caption: `📄 ${task.title}${task.deadline ? ` — الموعد ${task.deadline}` : ''}`,
            displayFilename: ''
          }
        }
        try {
          await sendDocument(replyTo, task.pdf_path, details.caption, details.displayFilename)
          sentCount += 1
        } catch (err) {
          console.error(`WhatsApp sendDocument error (${task.id}): ${err.message}`)
        }
      }
      return `✅ تم إرسال ${sentCount} مستند(ات) PDF ذات الأولوية والمواعيد الأقرب.`
    }
  }

  // If user says "اقرأ هذا PDF" without an attachment
  if (isIncomingPdfReadRequest(text)) {
    return readIncomingPdf(message, user, runAssistant)
  }

  if (isDateRequest(text)) return dateAnswer(db)
  if (isNewsRequest(text)) return latestNews(db)
  return null
}

// Keep isPdfRequest for backwards compatibility with tests
function isPdfRequest(text) {
  const value = clean(text)
  return value.includes('اقرأ') || value.includes('اقرا') || value.includes('read this pdf') || value.includes('pdf')
}

module.exports = {
  handleIntent,
  isNewsRequest,
  isDateRequest,
  isPdfRequest,
  isPdfSendRequest,
  isIncomingPdfReadRequest,
  isDocumentListRequest,
  documentListAnswer,
  parseScanRequest,
  findTasksWithPdf,
  findTaskWithPdf: (db, text) => findTasksWithPdf(db, text, 1)[0] || null
}
