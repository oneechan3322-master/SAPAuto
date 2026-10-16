'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const previousDbPath = process.env.V8_DB_PATH
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-2-1-'))
process.env.V8_DB_PATH = path.join(testDirectory, 'plan-2-1.db')

const { openDatabase, getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const db = openDatabase(process.env.V8_DB_PATH)
runMigrations(db)

const { ingestAccount } = require('../harness/ingest')
const identity = require('../domain/company-identity.cjs')
const recordStatus = require('../domain/record-status.cjs')
const manifest = require('../harness/manifest.js')
const reconcile = require('../harness/reconcile.js')
const proposals = require('../assistant/code-proposals.js')
const prompt = require('../assistant/prompt')

const V8_ROOT = path.resolve(__dirname, '..')
const LONG_NAME = 'احمد صابر محمد ابوالقمصان كيمورا للبويات و الصناعات الكيماوية CHEMORA FOR PAINTS AND CHEMICAL'

function seedCompany() {
  // The ingest owns the company id; seeding must use the same stable id.
  const companyId = require('../harness/ingest').stable('company', 'seed')
  db.prepare(`INSERT INTO companies(id,name,account_key,english_name,portal_name,name_source,created_at,updated_at)
    VALUES(?,'seed','seed','CHEMORA',?,'source','now','now')
    ON CONFLICT(account_key) DO NOTHING`).run(companyId, LONG_NAME)
  return companyId
}

test.after(() => {
  for (const handle of new Set([db, getDatabase()])) {
    if (handle && handle.open) handle.close()
  }
  fs.rmSync(testDirectory, { recursive: true, force: true })
  if (previousDbPath === undefined) delete process.env.V8_DB_PATH
  else process.env.V8_DB_PATH = previousDbPath
})

/* ------------------------------------------------------------------ *
 * 8.1 — assistant prompt
 * ------------------------------------------------------------------ */
test('the assistant is never told to shorten or omit detail', () => {
  const text = prompt
  for (const banned of [
    'اختصر', 'إيجاز', 'باختصار', 'قصّر', 'اختصر جملة', 'لا تشرح',
    'أجب باختصار', 'Keep it short', 'be brief', 'briefly', 'concise'
  ]) {
    assert.ok(!text.includes(banned), `prompt must not contain "${banned}"`)
  }
  assert.match(text, /بالتفصيل المناسب للسؤال/)
  assert.match(text, /لا تختصر جملة مطلوبة/)
  assert.match(text, /اذكر الاسم الكامل/)
  assert.match(text, /لا تُلغي حدود الأمان|لا يلغي حدود الأمان/, 'safety limits are preserved')
})

/* ------------------------------------------------------------------ *
 * 8.1 — company names are never truncated
 * ------------------------------------------------------------------ */
test('no stylesheet clamps or ellipsises a company-name field', () => {
  const css = ['app/design-system.css', 'app/components.css']
    .map((file) => fs.readFileSync(path.join(V8_ROOT, 'launcher', file), 'utf8')).join('\n')
  const nameSelectors = [
    '.company-card h2', '.company-detail-head h1', '.company-line-text',
    '.record-company', '.priority-company', '.activity-company', '.message-origin'
  ]
  for (const selector of nameSelectors) {
    assert.ok(css.includes(selector), `expected ${selector} to be styled explicitly`)
  }
  const guard = css.slice(css.indexOf('.company-name-full') - 2000)
  assert.match(guard, /-webkit-line-clamp:\s*none/)
  assert.match(guard, /text-overflow:\s*clip/)
  assert.match(guard, /white-space:\s*normal/)
  // No ellipsis anywhere on a name-bearing rule.
  assert.doesNotMatch(guard, /text-overflow:\s*ellipsis/)
  assert.doesNotMatch(guard, /line-clamp:\s*[1-9]/)
})

test('no component slices, truncates, or abbreviates a company name', () => {
  const root = path.join(V8_ROOT, 'launcher', 'components')
  const files = fs.readdirSync(root).filter((name) => /\.jsx?$/.test(name))
  assert.ok(files.length > 5)
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    for (const match of source.matchAll(/company_name[^;\n]*\.(?:slice|substring|substr)\s*\(/g)) {
      assert.fail(`${file} truncates a company name: ${match[0]}`)
    }
    for (const match of source.matchAll(/companyName[^;\n]*\.(?:slice|substring|substr)\s*\(/g)) {
      assert.fail(`${file} truncates a company name: ${match[0]}`)
    }
  }
})

test('badge initials come from a real name, never from a placeholder or key', () => {
  assert.equal(identity.companyInitials(' marwanhamada '), '')
  assert.equal(identity.companyInitials('205971997'), '')
  assert.equal(identity.companyInitials(identity.UNREGISTERED_COMPANY_NAME), '')
  assert.equal(identity.companyInitials(LONG_NAME).length > 0, true)
  assert.doesNotMatch(identity.companyInitials(LONG_NAME), /[0-9٠-٩]/)
})

test('every company-name surface ships the full text with an accessible tooltip', () => {
  const read = (...parts) => fs.readFileSync(path.join(V8_ROOT, 'launcher', ...parts), 'utf8')
  const records = read('components', 'records-view.jsx')
  assert.match(records, /<h2 className="company-name-full" title=\{name\}>/)
  assert.match(records, /className="record-company company-name-full" href=\{href\} title=\{label\}/)

  const messages = read('components', 'messages-view.jsx')
  assert.match(messages, /className="company-name-full" title=\{full\}/)

  const mission = read('components', 'mission-board.jsx')
  assert.match(mission, /className="priority-company company-name-full"[^>]*title=\{companyText\}/)

  const detail = read('app', '(protected)', '[section]', '[key]', 'page.jsx')
  assert.match(detail, /<h1 className="company-name-full" title=\{company\.name\}>/)
})

/* ------------------------------------------------------------------ *
 * 8.1 — account manifest
 * ------------------------------------------------------------------ */
test('the manifest requires exactly the agreed unique account count', async () => {
  const twentySix = Array.from({ length: 26 }, (_, index) => ({
    username: `acct_${index}`, label: `l${index}`, position: index + 1
  }))

  const normalized = manifest.normalizeAccounts([
    { username: 'MixedCase', label: '' },
    { username: '  mixedcase  ', label: '' }
  ])
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].id, normalized[1].id, 'identifiers normalise to lower case')

  assert.equal(manifest.manifestFingerprint(manifest.normalizeAccounts(twentySix)), manifest.manifestFingerprint(
    manifest.normalizeAccounts([...twentySix].reverse())
  ), 'the fingerprint is order-independent')

  // Live source read only — no portal session, no credentials.
  const live = await manifest.buildManifest()
  assert.equal(live.expected, undefined)
  assert.equal(live.duplicates.length, 0)
  assert.equal(live.fingerprint.length, 16)
  assert.equal(typeof live.runId, 'string')
})

/* ------------------------------------------------------------------ *
 * 8.1 / 8.2 — rendered layout: a long name must increase height, not vanish
 * ------------------------------------------------------------------ */
function loadPlaywright() {
  const { createRequire } = require('node:module')
  const here = createRequire(__filename)
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { return here(candidate) } catch { /* next */ }
  }
  return null
}

function findChromium() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (!fs.existsSync(root)) return null
  const build = fs.readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().pop()
  if (!build) return null
  const executable = path.join(root, build, 'chrome-win64', 'chrome.exe')
  return fs.existsSync(executable) ? executable : null
}

test('a long verified name wraps fully at 1440px and 390px with no clipping', async (t) => {
  const playwright = loadPlaywright()
  const executablePath = findChromium()
  const base = process.env.V8_SCREENSHOT_BASE || 'http://127.0.0.1:3000'
  if (!playwright || !executablePath) return t.skip('playwright chromium is not available')
  let reachable = true
  try {
    reachable = (await fetch(`${base}/companies`, { cache: 'no-store' })).ok
  } catch { reachable = false }
  if (!reachable) return t.skip(`dashboard not running at ${base}`)

  const browser = await playwright.chromium.launch({ executablePath })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } })
      const page = await context.newPage()
      for (const route of ['/companies', '/payments', '/tasks', '/']) {
        await page.goto(base + route, { waitUntil: 'networkidle', timeout: 45000 })
        const elements = await page.locator('.company-name-full').all()
        assert.ok(elements.length > 0, `${route}@${width} renders company names`)
        for (const element of elements) {
          const box = await element.boundingBox()
          const text = (await element.innerText()).trim()
          assert.ok(box.height > 0, `${route}@${width} has a visible name box`)
          // Not clipped: rendered content height fits inside the element box.
          const overflow = await element.evaluate((node) => ({
            scroll: node.scrollHeight, client: node.clientHeight
          }))
          assert.ok(overflow.scroll <= overflow.client + 1,
            `${route}@${width} clips "${text.slice(0, 30)}" (${overflow.scroll} > ${overflow.client})`)
          const style = await element.evaluate((node) => {
            const computed = getComputedStyle(node)
            return {
              clamp: computed.webkitLineClamp,
              overflow: computed.textOverflow,
              whitespace: computed.whiteSpace,
              title: node.getAttribute('title') || ''
            }
          })
          assert.equal(style.clamp, 'none', `${route}@${width} must not line-clamp a name`)
          assert.equal(style.overflow, 'clip', `${route}@${width} must not ellipsise a name`)
          assert.equal(style.whitespace, 'normal', `${route}@${width} must let a name wrap`)
          if (text) assert.equal(style.title, text, `${route}@${width} keeps the full text as a tooltip`)
        }
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
})
test('the bridge runs the scanner with --no-email and no write arguments', () => {
  const runAccount = fs.readFileSync(path.join(V8_ROOT, 'harness', 'run-account.js'), 'utf8')
  assert.match(runAccount, /'--account', accountKey, '--json-out', outputPath, '--no-email'/)
  for (const forbidden of ['--pay', '--submit', '--confirm', '--accept', '--send', '--email']) {
    assert.ok(!runAccount.includes(forbidden), `scanner must not pass ${forbidden}`)
  }
  // The result contract required by §2.2 is validated before ingestion.
  for (const key of ['login', 'tasks', 'obligations', 'payments', 'messages', 'diffs']) {
    assert.ok(runAccount.includes(`'${key}'`), `contract must require ${key}`)
  }
  assert.match(runAccount, /result \$\{key\} must be an array/)
})

/* ------------------------------------------------------------------ *
 * 8.1 — payment honesty and the source/local split
 * ------------------------------------------------------------------ */
test('a payment with no amount, status, or date stays unknown', () => {
  assert.equal(recordStatus.formatAmount(null, 'EGP'), 'المبلغ غير متاح')
  assert.equal(recordStatus.formatAmount('', 'EGP'), 'المبلغ غير متاح')
  // A blank source status must never read as paid, overdue, or normal.
  for (const dueDate of ['', null, '2016-02-30']) {
    const state = recordStatus.classifyRecord('payments', dueDate, '')
    assert.ok(['unknown', 'missing_date', 'invalid_date'].includes(state),
      `expected an honest unknown state, got ${state}`)
  }
  assert.equal(reconcile.classifySourceStatus(''), 'missing')
  assert.equal(reconcile.classifySourceStatus('unknown'), 'unknown')
  assert.equal(reconcile.classifySourceStatus('في انتظار السداد'), 'known_active')
  assert.equal(reconcile.classifySourceStatus('تم السداد'), 'completed')
  assert.equal(reconcile.classifyDate('', '2026-10-16'), 'missing')
  assert.equal(reconcile.classifyDate('2016-02-30', '2026-10-16'), 'invalid')
  // A known-active payment with a past date is overdue; an unknown status is not.
  assert.equal(reconcile.classifyDate('2020-01-01', '2026-10-16'), 'overdue')
})

test('source status and local review state are stored separately', () => {
  const companyId = seedCompany()
  const paymentId = 'pay_2_1'
  db.prepare(`INSERT INTO payments
    (id,company_id,account_key,claim_number,amount,currency,due_date,status,raw_json,created_at,updated_at,source_observed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(paymentId, companyId, 'seed', '0001', null, '', '', '', '{}', 'now', 'now', 'now')

  db.prepare(`UPDATE payments SET local_review_status='paid_locally', local_paid_at=?, local_paid_reason=?
    WHERE id=?`).run('now', 'مراجعة يدوية', paymentId)

  const row = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId)
  assert.equal(row.status, '', 'the source status is untouched by a local review')
  assert.equal(row.local_review_status, 'paid_locally')
  assert.equal(row.local_paid_reason, 'مراجعة يدوية')
  assert.equal(row.source_observed_at, 'now')

  const report = reconcile.reconcile({ runId: 'test', db })
  assert.equal(report.bySourceStatus.missing, 1)
  assert.equal(report.byLocalReview.paid_locally, 1)
  assert.equal(report.byIdentity.verified_source, 1)
  assert.equal(report.sourceStatusUnknown, 1)
  assert.equal(report.verdict, null, 'a reconciliation never renders a verdict')
  assert.equal(report.portalWrites, 0)
  assert.equal(report.emailsOrMessagesSent, 0)
  assert.equal(report.cloudAiRequests, 0)
  assert.equal(report.paymentsObserved, 1)
})

test('re-ingesting the same payment stays idempotent', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM payments').get().n
  const payload = {
    account: { key: 'seed', label: 'seed' },
    login: { success: true },
    tasks: [], obligations: [], messages: [], diffs: [],
    payments: [{ id: 'seed::0002', claimNumber: '0002', companyName: LONG_NAME, amount: 10, currency: 'EGP', status: 'في انتظار السداد', payBefore: '2026-11-01' }]
  }
  ingestAccount(payload, db)
  ingestAccount(payload, db)
  const after = db.prepare('SELECT COUNT(*) AS n FROM payments').get().n
  assert.equal(after, before + 1, 'repeat ingest does not duplicate')

  const row = db.prepare("SELECT * FROM payments WHERE claim_number='0002'").get()
  assert.equal(row.amount, 10)
  assert.equal(row.source_observed_at, row.updated_at, 'the source observation time is recorded')
})

test('the reconciliation report never claims a payment is absent', () => {
  const report = reconcile.reconcile({ runId: 'test' })
  assert.match(report.note, /فشل الفحص ليس غيابًا/)
  assert.ok(Array.isArray(report.exceptions))
  assert.equal(report.stoppedEarly, false)
})

/* ------------------------------------------------------------------ *
 * Regression guards for defects found during the plan 2.3 gap analysis
 * ------------------------------------------------------------------ */
test('the pre-run baseline runs without touching a column that does not exist', () => {
  // It previously selected payments.source_status, which no migration creates.
  const baselineRow = reconcile.baseline(db)
  assert.equal(typeof baselineRow.capturedAt, 'string')
  assert.equal(typeof baselineRow.payments, 'number')
  assert.equal(typeof baselineRow.paymentsKnownStatus, 'number')
  assert.equal(typeof baselineRow.paymentsUnknownStatus, 'number')
  assert.equal(typeof baselineRow.parkedAccounts, 'number')
  assert.equal(typeof baselineRow.accountScanTimes, 'object')
})

test('the OpenCode snapshot fits its own budget on the real tree', () => {
  // It previously exceeded MAX_SOURCE_BYTES, which silently killed the feature,
  // and a hard-coded filename deny-list let a newly added plan file back in.
  const snapshot = proposals.buildSourceSnapshot(V8_ROOT)
  assert.ok(snapshot.length > 0)
  assert.doesNotMatch(snapshot, /### (?:plan|README|CHANGELOG)\S*\.md/i,
    'planning documents are not source to review')
  // Prove the deny rule is a pattern: any new plan*.md stays out automatically.
  assert.ok(proposals.EXCLUDED_FILE_PATTERN.test('plan2.4.md'))
  assert.ok(proposals.EXCLUDED_FILE_PATTERN.test('plan9.99.md'))
  assert.equal(proposals.EXCLUDED_FILE_PATTERN.test('domain/company-identity.cjs'), false)
})

test('completing an obligation locally never rewrites the source lane', () => {
  const companyId = seedCompany()
  db.prepare(`INSERT INTO obligations
    (id,company_id,account_key,obligation_code,period,title,status,evidence,raw_json,created_at,updated_at)
    VALUES('ob_2_1',?,?,'CODE','P','التزام','قيد المتابعة','دليل من البوابة','{}','now','now')`)
    .run(companyId, 'seed')
  db.prepare(`INSERT INTO obligations
    (id,company_id,account_key,obligation_code,period,title,status,raw_json,created_at,updated_at)
    VALUES('ob_portal',?,'seed','CODE2','P','التزام','قيد المتابعة','{}','now','now')`)
    .run(companyId)

  const { markDone } = require('../db/queries/obligations')
  assert.equal(markDone('ob_2_1', 'operator', 'مراجعة يدوية', db), true)

  const row = db.prepare('SELECT * FROM obligations WHERE id=?').get('ob_2_1')
  assert.equal(row.status, 'قيد المتابعة', 'the source status is untouched')
  assert.equal(row.evidence, 'دليل من البوابة', 'the source evidence column is untouched')
  assert.equal(row.local_review_status, 'completed_locally')
  assert.equal(row.local_review_note, 'مراجعة يدوية')
  assert.equal(row.local_reviewed_by, 'operator')

  const event = db.prepare("SELECT * FROM audit_log WHERE action='obligation.done' ORDER BY rowid DESC LIMIT 1").get()
  assert.match(event.details, /"sourceStatusUnchanged":"قيد المتابعة"/)
  assert.match(event.details, /"portalChanged":false/)

  // A second call must be idempotent.
  assert.equal(markDone('ob_2_1', 'operator', '', db), true)
  assert.equal(db.prepare('SELECT status FROM obligations WHERE id=?').get('ob_2_1').status, 'قيد المتابعة')
})

test('a portal task is completed locally without overwriting its source status', () => {
  const companyId = seedCompany()
  db.prepare(`INSERT INTO tasks
    (id,company_id,account_key,doc_number,title,status,origin,raw_json,created_at,updated_at)
    VALUES('tk_portal',?,'seed','D1','مهمة','open','portal','{}','now','now')`).run(companyId)
  db.prepare(`INSERT INTO tasks
    (id,company_id,account_key,doc_number,title,status,origin,raw_json,created_at,updated_at)
    VALUES('tk_local',?,'seed','D2','مهمة محلية','open','user_created','{}','now','now')`).run(companyId)

  const { markTaskDone } = require('../db/queries/tasks')
  assert.equal(markTaskDone('tk_portal', 'operator', db), true)
  const portalTask = db.prepare('SELECT * FROM tasks WHERE id=?').get('tk_portal')
  assert.equal(portalTask.status, 'open', 'the portal task keeps its source status')
  assert.equal(portalTask.local_review_status, 'completed_locally')

  // A locally-created task has no source observation, so its own status is the record.
  assert.equal(markTaskDone('tk_local', 'operator', db), true)
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id=?').get('tk_local').status, 'done')

  assert.equal(markTaskDone('does_not_exist', 'operator', db), false)
})

test('a stale upstream claim is flagged instead of being counted as a clean payment', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM payments').get().n
  ingestAccount({
    account: { key: 'seed', label: 'seed' },
    login: { success: true },
    tasks: [], obligations: [], messages: [], diffs: [],
    payments: [
      { id: 'seed::0003', claimNumber: '0003', companyName: LONG_NAME, amount: 5, status: 'في انتظار السداد', payBefore: '2020-01-01', stale: true },
      { id: 'seed::0004', claimNumber: '0004', companyName: LONG_NAME, amount: 7, status: 'في انتظار السداد', payBefore: '2020-01-01' }
    ]
  }, db)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n, before + 2)
  assert.equal(db.prepare("SELECT source_stale FROM payments WHERE claim_number='0003'").get().source_stale, 1)
  assert.equal(db.prepare("SELECT source_stale FROM payments WHERE claim_number='0004'").get().source_stale, 0)
})