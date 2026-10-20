'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-visor-'))
process.env.V8_ROOT = tempRoot
process.env.V8_DB_PATH = path.join(tempRoot, 'visor.db')

const testDirectory = path.join(tempRoot, 'data', 'pdfs')
fs.mkdirSync(testDirectory, { recursive: true })

const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')

// A tiny, hand-rolled one-page PDF with an embedded English date so pdfjs
// extracts real text without depending on any external generator.
function buildFixturePdf() {
  const text = '(Due date 2028-01-02 notice ref AUD 3/2026/000007222)' + ' '.repeat(120)
  const objects = []
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n')
  objects.push(`4 0 obj\n<< /Length ${text.length} >>\nstream\nBT /F1 14 Tf 60 700 Td ${text}Tj ET\nendstream\nendobj\n`)
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (const body of objects) {
    offsets.push(pdf.length)
    pdf += body
  }
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const fixturePdfPath = path.join(testDirectory, 'fixture-notice.pdf')
fs.writeFileSync(fixturePdfPath, buildFixturePdf())

const { extractPdfText, PdfReadError, sliceForPrompt } = require('../assistant/pdf-reader.cjs')
const { extractJsonObject, composeExhibitStudy, normalizeEventIsoDate, persistTaskExhibit, sweepUnstudiedDocuments } = require('../assistant/pdf-visor.cjs')

test('the visor opens a real PDF and reads its text', async () => {
  const result = await extractPdfText(fixturePdfPath)
  assert.equal(result.pages, 1)
  assert.ok(result.text.includes('Due date 2028-01-02 notice'), 'extracts embedded text')
  assert.equal(result.slice.truncated, false)
  assert.ok(result.text.length < 600)
})

test('the visor refuses foreign, empty and fake files with explicit codes', async () => {
  await assert.rejects(
    () => extractPdfText(path.join(tempRoot, 'data', 'pdfs', 'ghost.pdf')),
    (error) => error instanceof PdfReadError && error.code === 'missing-file'
  )
  await assert.rejects(
    () => extractPdfText(path.join(process.cwd(), 'outside.pdf')),
    (error) => error instanceof PdfReadError && error.code === 'outside-allowed-root'
  )
  const fake = path.join(testDirectory, 'fake.pdf')
  fs.writeFileSync(fake, 'plain text, not a pdf')
  await assert.rejects(
    () => extractPdfText(fake),
    (error) => error instanceof PdfReadError && error.code === 'not-a-pdf'
  )
  const empty = path.join(testDirectory, 'empty.pdf')
  fs.writeFileSync(empty, '')
  await assert.rejects(
    () => extractPdfText(empty),
    (error) => error instanceof PdfReadError && error.code === 'empty-file'
  )
})

test('prompt slicing keeps the budget and reports truncation truthfully', () => {
  const short = sliceForPrompt('short text', 100)
  assert.equal(short.text, 'short text')
  assert.equal(short.truncated, false)
  const long = sliceForPrompt('ab\n'.repeat(900), 100)
  assert.ok(long.text.length <= 100)
  assert.equal(long.truncated, true)
})

test('the exhibit decoder parses strict and fenced JSON and rejects prose', () => {
  assert.deepEqual(extractJsonObject('{"a":1}').a, 1)
  assert.equal(extractJsonObject('مقدمة ```json\n{"a":"ن"}\n``` نهاية').a, 'ن')
  assert.deepEqual(extractJsonObject('كتلة إضافية {"b":2} خاتمة ناجحة'), { b: 2 })
  assert.equal(extractJsonObject('نص غير وصفي'), null)
  assert.equal(extractJsonObject('{"a":'), null)
  assert.equal(extractJsonObject(''), null)
})

test('composing the human exhibit keeps truth only from the model', () => {
  const exhibit = {
    document_type: 'إخطار',
    dates_on_paper: [{ raw: 'من يوم ١٤', iso: '', meaning: 'نهاية المهلة' }],
    legal_status: 'قابل للطعن',
    action_summary: 'تجهيز المستندات الطلوبة',
    next_owner_action: 'الحضور بالأوراق قبل انتهاء المهلة'
  }
  const composed = composeExhibitStudy(exhibit)
  assert.match(composed, /النوع: إخطار/)
  assert.match(composed, /قابل للطعن/)
  assert.ok(composed.includes('تجهيز المستندات الطلوبة'))
  assert.equal(composeExhibitStudy(null), '')
  assert.equal(normalizeEventIsoDate('2028-01-02'), '2028-01-02')
  assert.equal(normalizeEventIsoDate('٢٠٢٨'), '')
})

test('live-analyst studyDocument feeds PDF text into the model and persists the exhibit', { skip: process.env.V8_VISOR_SIGNAL_TEST === '1' }, async (t) => {
  const previousDatabasePath = process.env.V8_DB_PATH
  const previousRoot = process.env.V8_ROOT
  const databasePath = path.join(os.tmpdir(), `sapauto-visor-run-${Date.now()}-${process.pid}.db`)
  const previousOpenAccess = process.env.V8_OPEN_ACCESS

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-visor-run-'))
  process.env.V8_DB_PATH = databasePath
  process.env.V8_ROOT = path.resolve(__dirname, '..')
  const fixture = openDatabase(databasePath)

  t.after(() => {
    const { getDatabase } = require('../db/connect')
    const database = getDatabase()
    if (database.open) database.close()
    if (previousDatabasePath === undefined) delete process.env.V8_DB_PATH
    else process.env.V8_DB_PATH = previousDatabasePath
    if (previousRoot === undefined) delete process.env.V8_ROOT
    else process.env.V8_ROOT = previousRoot
    if (previousOpenAccess === undefined) delete process.env.V8_OPEN_ACCESS
    else process.env.V8_OPEN_ACCESS = previousOpenAccess
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
    for (const leftover of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      try { fs.rmSync(leftover, { force: true, maxRetries: 6, retryDelay: 250 }) } catch {}
    }
  })

  const { runMigrations } = require('../db/migrate')
  runMigrations(fixture)

  const { LiveAiAnalyst } = await import('../assistant/live-analyst.js')

  class StubbedAnalyst extends LiveAiAnalyst {
    constructor(db) {
      super({ db, endpoint: 'http://127.0.0.1:9' })
    }

    async queryModel(prompt) {
      this.lastPrompt = prompt
      return JSON.stringify({
        document_type: 'إخطار',
        action_summary: 'بند تجهيز مستنادات القيمة المضافة',
        dates_on_paper: [{ raw: 'Due date 2028-01-02', iso: '2028-01-02', meaning: 'الموعد النهائي' }],
        legal_status: 'قابل للطعن',
        next_owner_action: 'الحضور بالأوراق قبل تاريخ 2028-01-02'
      })
    }
  }

  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-visor-pdfs-'))
  const runPdf = path.join(runDirectory, 'data', 'pdfs', 'notice.pdf')
  fs.mkdirSync(path.dirname(runPdf), { recursive: true })
  fs.writeFileSync(runPdf, buildFixturePdf())
  // The privacy orbit allows reads only under V8_ROOT/data — aim it at the
  // run sandbox so the study reads a PDF that lives inside ITS allowed root.
  process.env.V8_ROOT = runDirectory

  const db = fixture
  const companyId = 'companies_visor_fixture'
  const createdAt = new Date().toISOString()
  const existing = db.prepare('SELECT COUNT(*) n FROM companies').get().n
  if (existing === 0) {
    db.prepare(`INSERT INTO companies (id, name, account_key, created_at, updated_at)
      VALUES (?,?,?,?,?)`).run(companyId, 'شركة الاختبار المالية', '533158788', createdAt, createdAt)
  }
  const companyRow = db.prepare('SELECT id FROM companies WHERE account_key=?').get('533158788') ||
    db.prepare('SELECT id FROM companies LIMIT 1').get()
  const taskId = 'tasks_visor_fixture'
  db.prepare(`INSERT INTO tasks (id,company_id,account_key,doc_number,title,deadline,status,urgency,required_action,pdf_path,origin,raw_json,created_at,updated_at,ai_study)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    taskId, companyRow.id, '533158788', '180000222364', 'إخطار تجهيز مستندات - 180000222364',
    '', 'open', 'normal', 'تجهيز المستندات المطلوبة وتسليمها للمأمورية.', runPdf,
    'scraper', '{}', createdAt, createdAt, ''
  )

  const analyst = new StubbedAnalyst(db)
  const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId)
  const result = await analyst.studyDocument(row)

  assert.ok(result.analysis.includes('النوع: إخطار'))
  assert.ok(analyst.lastPrompt.includes('2028-01-02'), 'the stub model received the REAL pdf text with the date inside')

  const updated = db.prepare('SELECT ai_study, deadline, urgency, ai_studied_at FROM tasks WHERE id=?').get(taskId)
  assert.equal(updated.deadline, '2028-01-02')
  assert.equal(updated.urgency, 'review')
  assert.ok(updated.ai_study.length > 20)
  assert.ok(updated.ai_studied_at)

  const eventRows = db.prepare('SELECT kind, payload FROM events WHERE entity_id=? ORDER BY kind').all(taskId)
  assert.ok(eventRows.some((rowEvent) => rowEvent.kind === 'task_date_extracted'))
  assert.ok(eventRows.some((rowEvent) => rowEvent.kind === 'pdf_studied'), 'every successful visor study leaves a paper trail')
  const studiedEvent = eventRows.find((rowEvent) => rowEvent.kind === 'pdf_studied')
  const studiedPayload = JSON.parse(studiedEvent.payload)
  assert.equal(studiedPayload.deadline_filled, true)
  assert.equal(studiedPayload.source, 'pdf-visor')

  fs.rmSync(runDirectory, { recursive: true, force: true })
})

test('the manager sweep studies stranded PDF tasks without waiting for a scrape', { skip: process.env.V8_VISOR_SIGNAL_TEST === '1' }, async (t) => {
  const previousDatabasePath = process.env.V8_DB_PATH
  const previousRoot = process.env.V8_ROOT
  const databasePath = path.join(os.tmpdir(), `sapauto-visor-sweep-${Date.now()}-${process.pid}.db`)

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-visor-sweep-'))
  process.env.V8_ROOT = directory
  process.env.V8_DB_PATH = databasePath

  t.after(() => {
    try { if (db && db.open) db.close() } catch { /* another cleanup already closed it */ }
    process.env.V8_ROOT = previousRoot
    process.env.V8_DB_PATH = previousDatabasePath
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(databasePath + suffix, { force: true, maxRetries: 3 })
    }
    fs.rmSync(path.join(directory, 'data', 'pdfs'), { recursive: true, force: true })
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const pdfDirectory = path.join(directory, 'data', 'pdfs')
  fs.mkdirSync(pdfDirectory, { recursive: true })
  const runPdf = path.join(pdfDirectory, 'sweep-notice.pdf')
  fs.writeFileSync(runPdf, buildFixturePdf())

  const db = openDatabase(databasePath)
  runMigrations(db, path.join(__dirname, '..', 'db', 'migrations'))
  db.exec(`
    INSERT INTO companies(id, name, account_key, created_at, updated_at)
    VALUES ('sweep-company', 'مختبِر السويب', '533158788', '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z')
  `)
  const scripted = []
  let cursor = 0
  const StubbedAnalyst = {
    studyDocument(row) {
      scripted.push(row.id)
      cursor += 1
      return persistTaskExhibit(db, row, { analysis: `دراسة سويب ${cursor} للـ ${row.title}` })
    }
  }
  for (let index = 1; index <= 3; index += 1) {
    db.prepare(`INSERT INTO tasks
      (id, company_id, account_key, doc_number, title, deadline, status, urgency, required_action, pdf_path, origin, raw_json, created_at, updated_at, ai_study)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`tasks_sweep_${index}`, 'sweep-company', '533158788', `DOC_${index}`, `سويب ${index}`,
      '', 'open', 'normal', 'مراجعة', runPdf, 'scraper', '{}', '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z', index === 3 ? 'studied already' : '')
  }
  const studied = await sweepUnstudiedDocuments(db, { analyst: StubbedAnalyst, limit: 2 })
  assert.equal(studied, 2, 'studies at most the sweep limit')
  assert.deepEqual(scripted, ['tasks_sweep_2', 'tasks_sweep_1'], 'sweep walks most recently updated first')
  const remaining = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE ai_study='' AND pdf_path!=''").get().n
  assert.equal(remaining, 0, 'exactly two tasks were stranded and the sweep studied both')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='pdf_studied'").get().n, 2, 'the sweep leaves the same paper trail as a scrape-born study')
  const withoutAnalyst = await sweepUnstudiedDocuments(db, { limit: 0 })
  assert.equal(withoutAnalyst, 0, 'refuses silly limits')
})
