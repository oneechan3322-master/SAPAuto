'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')
const { runMigrations } = require('../db/migrate')
const folders = require('../domain/company-folders.cjs')

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-folders-'))
  process.env.V8_COMPANY_FOLDERS_ROOT = path.join(dir, 'companies')
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '..', 'db', 'migrations'))
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO companies (id, account_key, name, status, created_at, updated_at)
    VALUES ('comp_1','acct_1','شركة المستقبل الدولية','ready',?,?)`).run(now, now)
  db.prepare(`INSERT INTO companies (id, account_key, name, status, created_at, updated_at)
    VALUES ('comp_2','acct_2','شركة "المستقبل" الشرق — النيل','ready',?,?)`).run(now, now) // illegal chars
  db.prepare(`INSERT INTO companies (id, account_key, name, status, created_at, updated_at)
    VALUES ('comp_3','acct_3','شركة المستقبل الدولية','ready',?,?)`).run(now, now) // same name as comp_1
  t.after(() => { db.close(); delete process.env.V8_COMPANY_FOLDERS_ROOT; fs.rmSync(dir, { recursive: true, force: true }) })
  return { dir, db }
}

function addTask(db, id, companyId, docNumber, pdfPath) {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO tasks (id, company_id, account_key, doc_number, title, pdf_path, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, companyId, 'acct', docNumber, 'مستند', pdfPath, now, now)
}

test('company folders: file tree per company with manifest, copies, sanitize and dedupe', () => {
  const t = sandbox(test)
  const { db, dir } = t
  fs.mkdirSync(path.join(dir, 'data', 'pdfs'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'pdfs', 'doc1.pdf'), 'PDF-1')
  addTask(db, 'task_1', 'comp_1', 'DOC_1', path.join(dir, 'data', 'pdfs', 'doc1.pdf'))
  addTask(db, 'task_2', 'comp_2', 'DOC_2', path.join(dir, 'data', 'pdfs', 'ghost.pdf')) // recorded but not on disk
  addTask(db, 'task_3', 'comp_1', 'DOC_3', 'C:/Windows/system32/drivers/x.pdf') // outside SapAuto → refused

  const stats = folders.syncCompanyFolders(db)
  assert.equal(stats.companies, 3)
  assert.equal(stats.filesCopied, 1)

  const names = fs.readdirSync(process.env.V8_COMPANY_FOLDERS_ROOT).sort()
  assert.equal(names.length, 3)
  assert.ok(names.includes('شركة المستقبل الدولية'))
  assert.ok(names.some((n) => n.includes('الشرق') && !n.includes('"')), 'forbidden quotes must be sanitized')
  assert.ok(names.filter((n) => n.startsWith('شركة المستقبل الدولية')).length === 2, 'same name → numbered alternative')

  const comp1 = path.join(process.env.V8_COMPANY_FOLDERS_ROOT, 'شركة المستقبل الدولية')
  assert.deepEqual(fs.readdirSync(path.join(comp1, 'pdfs')), ['DOC_1.pdf'])
  assert.equal(fs.readFileSync(path.join(comp1, 'pdfs', 'DOC_1.pdf'), 'utf8'), 'PDF-1')
  assert.deepEqual(fs.readdirSync(path.join(comp1, 'documents')), [])
  const manifest = JSON.parse(fs.readFileSync(path.join(comp1, 'company.json'), 'utf8'))
  assert.equal(manifest.id, 'comp_1')
  assert.equal(manifest.pdfCount, 1)
})

test('company folders: idempotent rerun copies nothing new and keeps manifests true', () => {
  const t = sandbox(test)
  const { db, dir } = t
  fs.mkdirSync(path.join(dir, 'data', 'pdfs'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'pdfs', 'doc1.pdf'), 'PDF-1')
  addTask(db, 'task_1', 'comp_1', 'DOC_1', path.join(dir, 'data', 'pdfs', 'doc1.pdf'))
  folders.syncCompanyFolders(db)
  const before = fs.readFileSync(path.join(process.env.V8_COMPANY_FOLDERS_ROOT, 'شركة المستقبل الدولية', 'pdfs', 'DOC_1.pdf'))
  const stats2 = folders.syncCompanyFolders(db)
  assert.equal(stats2.filesCopied, 0)
  assert.equal(stats2.filesKept, 1)
  assert.equal(fs.readFileSync(path.join(process.env.V8_COMPANY_FOLDERS_ROOT, 'شركة المستقبل الدولية', 'pdfs', 'DOC_1.pdf')).length, before.length)
})

test('company folders: tasks without company link or path are skipped honestly', () => {
  const t = sandbox(test)
  const { db, dir } = t
  fs.mkdirSync(path.join(dir, 'data', 'pdfs'), { recursive: true })
  addTask(db, 'task_nopath', 'comp_1', 'DOC_E', '') // task row with no pdf → not counted as missing
  const stats = folders.syncCompanyFolders(db)
  assert.equal(stats.filesCopied, 0)
  assert.equal(stats.filesMissing, 0)
  assert.equal(fs.readdirSync(path.join(process.env.V8_COMPANY_FOLDERS_ROOT, 'شركة المستقبل الدولية', 'pdfs')).length, 0)
})
