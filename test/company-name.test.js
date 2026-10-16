'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const identity = require('../domain/company-identity.cjs')
const { ingestAccount } = require('../harness/ingest')

const V8_ROOT = path.resolve(__dirname, '..')
const SOURCE_ROOTS = [
  path.join(V8_ROOT, 'launcher', 'app'),
  path.join(V8_ROOT, 'launcher', 'components'),
  path.join(V8_ROOT, 'launcher', 'lib'),
  path.join(V8_ROOT, 'domain')
]
const SOURCE_FILES = /\.(jsx?|cjs|mjs)$/

function walk(directory, out = []) {
  if (!fs.existsSync(directory)) return out
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (SOURCE_FILES.test(entry.name)) out.push(full)
  }
  return out
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-company-name-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

function scanPayload(companyName) {
  return {
    account: { key: '205971997', label: '205971997' },
    login: { success: true },
    tasks: [{
      id: 't1',
      docNumber: '180000209907',
      docTitle: 'نموذج ١٩ دمغة',
      company: companyName,
      status: 'pending',
      urgency: 'overdue',
      deadline: '2026-10-10'
    }],
    obligations: [],
    payments: [],
    messages: [],
    diffs: []
  }
}

/* ------------------------------------------------------------------ *
 * 1. No page can render "الشركة" followed by a digit.
 * ------------------------------------------------------------------ */
test('no source file can render الشركة followed by a number', () => {
  const files = SOURCE_ROOTS.flatMap((root) => walk(root))
  assert.ok(files.length > 10, 'expected to scan a real source tree')
  const offenders = []
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const relative = path.relative(V8_ROOT, file)
    // "الشركة" immediately followed by an interpolation, concatenation or
    // counter is exactly the pattern that produced الشركة 1 / الشركة 2.
    if (/الشركة\s*(?:\$\{|\+\s*[a-zA-Z_$]|`|\b(?:index|counter|n|position|ordinal)\b)/.test(source)) {
      offenders.push(`${relative}: interpolated company label`)
    }
    if (/شركة غير معروفة/.test(source)) {
      offenders.push(`${relative}: retired placeholder text`)
    }
    if (/Company\s*\$?\{/.test(source)) offenders.push(`${relative}: numbered company label`)
  }
  assert.deepEqual(offenders, [], 'no file may build a company label from a number')
})

test('the live pages never emit الشركة plus a digit', async (t) => {
  const base = process.env.V8_SCREENSHOT_BASE || 'http://127.0.0.1:3000'
  const cookie = process.env.V8_SCREENSHOT_COOKIE
  if (!cookie) return t.skip('an authenticated screenshot session was not provided')
  let reachable = true
  try {
    const probe = await fetch(`${base}/companies`, {
      cache: 'no-store',
      headers: { cookie },
      redirect: 'manual'
    })
    reachable = probe.status === 200
  } catch {
    reachable = false
  }
  if (!reachable) return t.skip(`dashboard not running at ${base}`)

  for (const route of ['/companies', '/tasks', '/obligations', '/payments', '/messages', '/failures', '/reminders', '/reports', '/audit', '/']) {
    const html = await (await fetch(base + route, {
      cache: 'no-store',
      headers: { cookie }
    })).text()
    assert.doesNotMatch(html, /الشركة\s*[0-9٠-٩]/, `${route} must not render الشركة + digit`)
  }
})

/* ------------------------------------------------------------------ *
 * 2. A company with no name shows the empty state (and no badge letters).
 * ------------------------------------------------------------------ */
test('an unnamed company resolves to the empty state, not a generated name', () => {
  const resolved = identity.resolveCompanyIdentity({
    id: 'company-x',
    name: 'marwanhamada',
    account_key: 'marwanhamada',
    name_source: 'source'
  })
  assert.equal(resolved.name, 'اسم غير مسجّل')
  assert.equal(resolved.known, false)
  assert.equal(resolved.origin, '')
  assert.equal(identity.companyInitials(resolved.name), '')
  assert.equal(identity.companyInitials('205971997'), '')
})

test('the badge never contains characters lifted from a placeholder', () => {
  const resolved = identity.resolveCompanyIdentity({ name: '205971997', account_key: '205971997' })
  const badge = identity.companyInitials(resolved.name)
  assert.equal(badge, '', 'an unnamed company gets an icon, never letters')
  const real = identity.resolveCompanyIdentity({
    name: ' marwanhamada ',
    account_key: 'marwanhamada',
    portal_name: 'المجموعه المتحده للزيوت والدهانات يونايتد احمد صابر محمد وشركاة'
  })
  const realBadge = identity.companyInitials(real.name)
  assert.ok(realBadge.length > 0)
  assert.doesNotMatch(realBadge, /اسم غير مسجّل/)
  assert.doesNotMatch(realBadge, /[0-9٠-٩]/)
  assert.equal(realBadge, identity.companyInitials(real.name).slice(0, 2))
})

/* ------------------------------------------------------------------ *
 * 3. A name saved by the user survives a sync; a source name is captured.
 * ------------------------------------------------------------------ */
test('a portal name is captured on every sync and a saved name survives it', (t) => {
  const db = fixture(t)
  const portalName = 'المجموعه المتحده للزيوت والدهانات يونايتد احمد صابر محمد وشركاة'

  ingestAccount(scanPayload(portalName), db)
  const afterFirst = db.prepare('SELECT name,portal_name,name_source FROM companies WHERE account_key=?').get('205971997')
  assert.equal(afterFirst.portal_name, portalName)
  assert.equal(afterFirst.name, portalName)
  assert.equal(
    identity.resolveCompanyIdentity({ ...afterFirst, account_key: '205971997' }).name,
    portalName
  )

  // The user corrects the name by hand: it must never be overwritten by a sync.
  db.prepare(`UPDATE companies SET name=?,name_source='manual',english_name=? WHERE account_key=?`)
    .run('الاسم الذي أدخلته', 'The Manual Name', '205971997')

  ingestAccount(scanPayload(portalName), db)
  const afterSecond = db.prepare('SELECT name,portal_name,name_source,english_name FROM companies WHERE account_key=?').get('205971997')
  assert.equal(afterSecond.name, 'الاسم الذي أدخلته', 'a saved name survives a sync')
  assert.equal(afterSecond.name_source, 'manual')
  assert.equal(afterSecond.portal_name, portalName, 'the source name is still refreshed')
  assert.equal(afterSecond.english_name, 'The Manual Name')
  assert.equal(
    identity.resolveCompanyIdentity({ ...afterSecond, account_key: '205971997' }).origin,
    'conflict'
  )
  assert.equal(
    identity.resolveCompanyIdentity({ ...afterSecond, account_key: '205971997' }).known,
    false,
    'a different portal name is surfaced as a conflict, not silently trusted'
  )
  assert.equal(
    identity.resolveCompanyIdentity({
      ...afterSecond,
      account_key: '205971997',
      name: portalName
    }).origin,
    'manual_verified',
    'a manually confirmed name matching the portal is verified'
  )

  // The record rows carry the real company name too, not the account key.
  const task = db.prepare('SELECT id FROM tasks LIMIT 1').get()
  assert.ok(task, 'the task row was ingested')
  const stored = JSON.parse(db.prepare('SELECT raw_json FROM tasks WHERE id=?').get(task.id).raw_json)
  assert.equal(stored.company, portalName)
})

test('an account key is never promoted to a company name', (t) => {
  const db = fixture(t)
  ingestAccount({
    account: { key: '315240679', label: '315240679' },
    login: { success: true },
    tasks: [{ id: 't1', docNumber: '1', docTitle: 'مهمة', company: '315240679' }],
    obligations: [], payments: [], messages: [], diffs: []
  }, db)
  const row = db.prepare('SELECT name,portal_name FROM companies WHERE account_key=?').get('315240679')
  assert.equal(row.portal_name, '', 'a bare account key is not a company name')
  const resolved = identity.resolveCompanyIdentity({ ...row, account_key: '315240679' })
  assert.equal(resolved.name, 'اسم غير مسجّل')
  assert.equal(resolved.known, false)
})

/* ------------------------------------------------------------------ *
 * 4. The stored payload already holds the name (migration backfill).
 * ------------------------------------------------------------------ */
test('the migration backfills the portal name from stored record payloads', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-backfill-'))
  const db = openDatabase(path.join(directory, 'legacy.db'))
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  // Stand up the schema exactly as it was before 014, with a company whose
  // name column still holds the account key and a payload that carries the
  // real legal name, then apply the additive migration.
  const legacyMigrations = path.join(directory, 'migrations')
  fs.mkdirSync(legacyMigrations)
  for (const file of fs.readdirSync(path.join(V8_ROOT, 'db', 'migrations'))) {
    if (file.startsWith('014_')) continue
    fs.copyFileSync(path.join(V8_ROOT, 'db', 'migrations', file), path.join(legacyMigrations, file))
  }
  runMigrations(db, legacyMigrations)

  db.exec(`
    INSERT INTO companies(id,name,account_key,created_at,updated_at)
      VALUES('company_legacy','315240679','315240679','now','now');
    INSERT INTO obligations(id,company_id,account_key,obligation_code,title,raw_json,created_at,updated_at)
      VALUES('ob_1','company_legacy','315240679','CODE','التزام',
        '{"companyKey":"315240679","company":"كينج كيسينج لتجهيز وتعبئه الامعاء ش م م"}','now','now');
  `)
  assert.equal(
    identity.resolveCompanyIdentity(db.prepare('SELECT * FROM companies WHERE id=?').get('company_legacy')).name,
    'اسم غير مسجّل'
  )

  runMigrations(db)
  const row = db.prepare('SELECT name,portal_name FROM companies WHERE id=?').get('company_legacy')
  assert.equal(row.portal_name, 'كينج كيسينج لتجهيز وتعبئه الامعاء ش م م')
  assert.equal(row.name, 'كينج كيسينج لتجهيز وتعبئه الامعاء ش م م')
  assert.equal(
    identity.resolveCompanyIdentity(db.prepare('SELECT * FROM companies WHERE id=?').get('company_legacy')).known,
    true
  )
})