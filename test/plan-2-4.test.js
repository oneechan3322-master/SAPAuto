'use strict'

/**
 * Plan 2.4, Release 2.4.1 — regression tests for the four promises the plan
 * makes to the user, each written so it fails loudly if the promise is broken:
 *
 *   1. No fake feature is ever offered (§3.3).
 *   2. Nothing legally material is cut without saying so (§3.2).
 *   3. A material queue is a worklist with honest counts, not a card wall (§5.2/§5.3).
 *   4. The source lane and the local lane are never merged into one "status" (§3.3).
 *
 * Plus the Plan 2.0 switch that had no effect: pausing system_adviser.
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const V8_ROOT = path.resolve(__dirname, '..')
const LAUNCHER = path.join(V8_ROOT, 'launcher')
const read = (...parts) => fs.readFileSync(path.join(LAUNCHER, ...parts), 'utf8')

// A throwaway database so the behavioural tests exercise real code paths.
// launcher/lib/db.js derives V8_ROOT from process.cwd() when it is unset, which
// points outside the project; pin it so migrations resolve.
const previousDbPath = process.env.V8_DB_PATH
const previousV8Root = process.env.V8_ROOT
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-2-4-'))
process.env.V8_DB_PATH = path.join(testDirectory, 'plan-2-4.db')
process.env.V8_ROOT = V8_ROOT

const { openDatabase, getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const db = openDatabase(process.env.V8_DB_PATH)
runMigrations(db)

const { boundedText, boundedToolPayload } = require('../domain/bounded-text.cjs')
const recordStatus = require('../domain/record-status.cjs')

/* ------------------------------------------------------------------ *
 * §3.3 — no fake features
 * ------------------------------------------------------------------ */
test('no channel tile advertises a feature the app cannot use', () => {
  const channelCenter = read('components', 'channel-center.jsx')
  assert.doesNotMatch(channelCenter, /id:\s*'whatsapp'/, 'WhatsApp must not be listed as a channel')
  // "coming soon" is the exact shape of a false affordance.
  assert.doesNotMatch(channelCenter, /'قريبًا'/, 'no channel may be labelled as coming soon')
  assert.doesNotMatch(channelCenter, /سيظهر خيار ربط الهاتف/, 'no placeholder copy for an unavailable channel')
  assert.doesNotMatch(channelCenter, /disabled=\{submitting \|\|/, 'a channel button must never be disabled by availability')

  const settingsRoute = read('app', 'api', 'settings', 'route.js')
  assert.doesNotMatch(settingsRoute, /whatsappAvailable/, 'the API must not advertise an unavailable channel')
  assert.doesNotMatch(settingsRoute, /id:\s*'whatsapp'/, 'the API must not list WhatsApp as a capability')
  // The optional dependency probe was the thing that produced the fake tile.
  assert.doesNotMatch(settingsRoute, /optionalWhatsAppPackage/)
})

test('every channel the app advertises is one it can actually pair', () => {
  const listed = [...read('components', 'channel-center.jsx').matchAll(/\{ id: '([a-z]+)', title: '([^']+)'/g)]
  assert.ok(listed.length > 0, 'at least one real channel remains')
  for (const [, id] of listed) {
    assert.ok(['email', 'telegram'].includes(id), `"${id}" is not a pairable channel; remove it rather than show it`)
  }
})

/* ------------------------------------------------------------------ *
 * §3.2 — nothing material is cut silently
 * ------------------------------------------------------------------ */
test('no outbound user-facing reply is truncated without saying so', () => {
  for (const file of ['telegram.js', 'gmail.js', 'whatsapp.js']) {
    const source = fs.readFileSync(path.join(V8_ROOT, 'channels', file), 'utf8')
    // A bare slice on a reply is the bug. boundedText() is the fix.
    assert.doesNotMatch(source, /result\.reply\.slice\(/, `channels/${file} must not slice a reply`)
    assert.match(source, /boundedText\(result\.reply/, `channels/${file} must bound the reply explicitly`)
  }
})

test('boundedText only cuts when over the limit, and always says it cut', () => {
  const short = 'ردّ قصير تمامًا لا يحتاج قصًّا.'
  assert.equal(boundedText(short, 4000), short, 'short text is returned untouched')

  const long = `${'سطر طويل جدًا. '.repeat(600)}`
  const bounded = boundedText(long, 400)
  assert.ok(bounded.length < long.length, 'long text is actually shortened')
  assert.match(bounded, /بُتِر النص/, 'the cut is announced to the reader')
  assert.ok(bounded.startsWith('سطر طويل جدًا.'), 'the text is cut at a word boundary, not mid-token')
})

test('a bounded tool payload tells the model what it is not seeing', () => {
  const payload = boundedToolPayload({ rows: Array.from({ length: 900 }, (_, i) => ({ id: i })) }, 500)
  const parsed = JSON.parse(payload)
  assert.equal(parsed.truncated, true, 'the model is told the payload is incomplete')
  assert.ok(parsed.omittedCharacters > 0, 'the model knows how much was dropped')
  assert.match(parsed.note, /Do not assume omitted records do not exist/, 'the model is warned not to read absence as fact')
  assert.equal(boundedToolPayload({ small: true }, 500), '{"small":true}', 'small payloads stay verbatim')
})

test('the assistant tool payload helper is actually wired in', () => {
  const run = fs.readFileSync(path.join(V8_ROOT, 'assistant', 'run.js'), 'utf8')
  assert.match(run, /boundedToolPayload\(value, 12000\)/, 'run.js bounds tool payloads through the shared helper')
  assert.doesNotMatch(run, /JSON\.stringify\(value\)\.slice\(/)
})

/* ------------------------------------------------------------------ *
 * §3.3 / §5.3 — source lane and local lane stay separate
 * ------------------------------------------------------------------ */
test('a payment reports the portal lane and the local lane as two facts', () => {
  const settled = recordStatus.describePayment({
    source_status: 'paid', local_review_status: 'not_reviewed', source_stale: 0
  })
  assert.equal(settled.source.disposition, 'complete')
  assert.equal(settled.source.label, 'مسدّدة في المصدر')
  assert.equal(settled.local.state, 'not_reviewed')
  assert.equal(settled.local.label, 'لم تراجعها بعد')
  assert.equal(settled.conflict, false, 'an unreviewed record is not a conflict')

  const locallyPaid = recordStatus.describePayment({
    source_status: 'open', local_review_status: 'paid_locally', source_stale: 0
  })
  assert.equal(locallyPaid.source.label, 'مستحقة في المصدر')
  assert.equal(locallyPaid.local.label, 'مسدّدة محليًا')
  assert.equal(locallyPaid.conflict, true, 'the portal and the local lane disagree; that is a conflict')
  assert.ok(locallyPaid.flags.some((flag) => /تعارض/.test(flag.label)), 'the conflict is stated, not hidden')

  const stale = recordStatus.describePayment({
    source_status: 'paid', local_review_status: 'paid_locally', source_stale: 1
  })
  assert.equal(stale.stale, true)
  assert.ok(stale.flags.some((flag) => /قديمة/.test(flag.label)), 'stale source data is stated')

  const unknown = recordStatus.describePayment({ source_status: '', local_review_status: 'not_reviewed' })
  assert.equal(unknown.source.label, 'حالة المصدر غير معروفة')
  assert.ok(unknown.flags.some((flag) => /لم نحدّد حالة السداد/.test(flag.label)),
    'an unreadable source status is reported, never assumed open or paid')
})

test('an unknown local review state never invents a verdict', () => {
  const described = recordStatus.describeLocalLane('something_new_from_a_future_version')
  assert.equal(described.state, 'not_reviewed')
  assert.equal(described.label, 'لم تراجعها بعد')
})

/* ------------------------------------------------------------------ *
 * §5.2 — capped lists admit it
 * ------------------------------------------------------------------ */
test('every capped list query is declared with its limit', () => {
  const data = read('lib', 'data.js')
  assert.match(data, /export const RECORD_LIMITS/, 'limits are declared in one place')
  // Every inline LIMIT in the query map must have a matching declaration.
  const inline = [...data.matchAll(/LIMIT\s+(\d+)/gi)].map((match) => Number(match[1]))
  assert.ok(inline.length > 0, 'there are capped queries to check')
  for (const value of inline) {
    const re = new RegExp(String(value))
    assert.match(data.split('export function listRecords')[0], re,
      `LIMIT ${value} must be declared in RECORD_LIMITS so truncation can be reported`)
  }
  assert.match(data, /LIMIT \$\{limit \+ 1\}/, 'the query fetches one extra row to detect a hidden tail')
  assert.match(data, /non-enumerable/, 'truncation metadata must not leak into serialised output')
})

test('the records page shows the real total and warns when a list is capped', () => {
  const page = read('app', '(protected)', '[section]', 'page.jsx')
  assert.match(page, /truncationOf\(allRows\)/, 'the page reads truncation before it filters')
  assert.match(page, /record-truncation-notice/, 'a capped list warns the reader')
  assert.match(page, /معروض من/, 'the header distinguishes shown rows from the true total')
  // The plain "N عنصر" label is only allowed in the branch that proves the
  // shown count equals the stored total.
  assert.match(
    page,
    /rows\.length === truncation\?\.total\s*\n?\s*\? `\$\{rows\.length\.toLocaleString\(locale\)\} عنصر`/,
    'the bare row count is shown only when it equals the true total'
  )
  assert.equal((page.match(/toLocaleString\(locale\)\} عنصر/g) || []).length, 1,
    'exactly one place may claim a row count is the whole list')
})

test('the payment worklist is a table of lanes, not a grid of cards', () => {
  const worklist = read('components', 'payment-worklist.jsx')
  assert.match(worklist, /<table className="worklist-table">/, 'payments render as a table')
  assert.match(worklist, /ما تقوله البوابة/, 'the source lane has its own column')
  assert.match(worklist, /مراجعتك المحلية/, 'the local lane has its own column')
  assert.match(worklist, /SyncMeta/, 'each row carries its exact sync timestamp')
  assert.match(worklist, /company-name-full/, 'each row keeps the full-name legibility contract')
  assert.match(worklist, /source_stale|describePayment/, 'row state comes from the shared classifier')

  // Plan 2.4 §7.3 — no write affordance until the auth path is real.
  assert.doesNotMatch(worklist, /fetch\(['"`]\/api\/payments/, 'the worklist must not post payment writes')
  assert.doesNotMatch(worklist, /Marked paid|سجّل السداد|ضع علامة/, 'no button may claim to settle a payment')

  const view = read('components', 'records-view.jsx')
  assert.match(view, /section === 'payments'\) return <PaymentWorklist/, 'payments route to the worklist')
})

test('no write control is reachable while authentication is broken', () => {
  // Plan 2.4 §7.3 — the guard cannot succeed for anyone (the users table is
  // empty and /api/setup is retired), so a mounted write button would be a
  // button that always fails. These components still contain write calls; the
  // rule is that nothing renders them.
  const guard = read('lib', 'guard.js')
  assert.match(guard, /session|sessions/, 'writes are session-guarded')

  const reachable = []
  const SKIP = new Set(['.next', 'node_modules', '.git', 'out', 'coverage'])
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.jsx?$/.test(entry.name) || full.endsWith('.test.js')) continue
      const source = fs.readFileSync(full, 'utf8')
      for (const [component, module] of [['RecordActions', 'record-actions'], ['PendingConfirmations', 'pending-confirmations']]) {
        const imported = new RegExp(`from\\s+['"][^'"]*${module}(\\.jsx)?['"]`)
        const rendered = new RegExp(`<${component}[\\s/>]`)
        assert.ok(!(imported.test(source) || rendered.test(source)),
          `${component} must not be imported or rendered by ${path.relative(LAUNCHER, full)} while auth is broken`)
      }
      if (/\/api\/payments\/paid/.test(source) && path.basename(full) !== 'record-actions.jsx') reachable.push(full)
    }
  }
  walk(LAUNCHER)
  assert.deepEqual(reachable, [], 'no mounted surface may post a payment write')
})

/* ------------------------------------------------------------------ *
 * Plan 2.0 §3.2C — the adviser pause switch must do something
 * ------------------------------------------------------------------ */
test('pausing the system adviser stops it from generating proposals', () => {
  const source = fs.readFileSync(path.join(V8_ROOT, 'assistant', 'code-proposals.js'), 'utf8')
  assert.match(source, /function assertAdviserRunning\(\)/, 'the capability is checked at a single choke point')
  assert.match(source, /ai_provider_state[\s\S]*capability=\?[\s\S]*system_adviser/,
    'the check reads the persisted pause flag for system_adviser')
  assert.match(source, /async function generateProposal\(request, options = \{\}\) \{\s*\n\s*assertAdviserRunning\(\)/,
    'every proposal request is gated before anything else happens')
  assert.match(source, /AI_POLICY_BLOCKED/, 'the refusal explains that the Control Centre paused it')
})

test('the UI for the adviser switch matches the enforced behaviour', () => {
  const capabilities = read('app', 'api', 'capabilities', 'route.js')
  assert.match(capabilities, /system_adviser/, 'the switch is exposed for system_adviser')
  const settings = read('components', 'settings-form.jsx')
  assert.match(settings, /paused/, 'the Control Centre can pause a capability')
})

/* ------------------------------------------------------------------ *
 * §3.2 / §4.1 — names and non-colour signals
 * ------------------------------------------------------------------ */
test('the full legal name can be copied without retyping it', () => {
  const copy = read('components', 'copy-company-name.jsx')
  assert.match(copy, /navigator\.clipboard\.writeText/, 'copy uses the clipboard API')
  assert.match(copy, /aria-label=\{`نسخ/, 'each copy control is labelled for a screen reader')
  assert.match(copy, /تعذر النسخ/, 'a failed copy tells the user instead of failing silently')

  const identity = read('components', 'company-identity-form.jsx')
  assert.match(identity, /CopyCompanyName/, 'the identity form offers the copy action')
  const view = read('components', 'records-view.jsx')
  assert.match(view, /CopyCompanyName/, 'the company list offers the copy action')
})

test('a status is never signalled by colour alone', () => {
  const view = read('components', 'records-view.jsx')
  assert.match(view, /const STATUS_ICONS = \{/, 'each tone maps to an icon')
  assert.match(view, /<StatusPill/, 'statuses render through the icon-bearing pill')
  assert.match(view, /<Icon size=\{12\} strokeWidth=\{2\} aria-hidden="true" \/>/,
    'the pill itself always renders its icon')
  // Exactly one raw pill markup may exist: the StatusPill definition itself.
  const rawPills = [...view.matchAll(/<span className=\{`record-status-pill/g)]
  assert.equal(rawPills.length, 1, 'only the StatusPill component may build a pill element by hand')
  const css = read('app', 'components.css')
  assert.match(css, /\.record-status-pill svg \{ flex: none; \}/, 'the icon is guaranteed to render')
})

test('the new worklist styles are actually loaded', () => {
  assert.match(read('app', 'globals.css'), /@import "\.\/plan24\.css"/, 'plan24.css is imported')
  const css = fs.readFileSync(path.join(LAUNCHER, 'app', 'plan24.css'), 'utf8')
  for (const selector of ['.worklist-table', '.worklist-lane', '.record-truncation-notice', '.visually-hidden']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')), `${selector} is styled`)
  }
})

test('the worklist cannot make the page wider than the screen', () => {
  const css = fs.readFileSync(path.join(LAUNCHER, 'app', 'plan24.css'), 'utf8')
  // design-system.css puts `table { min-width: 680px }` on every table. A column
  // flex/grid item also defaults to min-width:auto. Together they made the whole
  // payments page 694px wide on a 390px screen, pushing the filter and export
  // controls off-screen. Both floors have to be lifted explicitly.
  const system = read('app', 'design-system.css')
  assert.match(system, /table\s*\{[^}]*min-width:\s*680px/, 'the global table floor still exists; it must be overridden')

  const wrap = css.match(/\.worklist-table-wrap\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(wrap, /min-width:\s*0/, 'the scroll wrapper may shrink below its content')
  const worklist = css.match(/\.payment-worklist\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(worklist, /min-width:\s*0/, 'the flex container may shrink below its content')

  const mobile = css.match(/@media \(max-width: 720px\)\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(mobile, /\.worklist-table\s*\{[^}]*min-width:\s*0/, 'the stacked mobile table drops the 680px floor')
  assert.match(mobile, /\.worklist-table thead\s*\{\s*display:\s*none/, 'mobile stacks rows instead of scrolling sideways')
})

/* ------------------------------------------------------------------ *
 * Behaviour, not source patterns
 * ------------------------------------------------------------------ */
function loadPlaywright() {
  for (const candidate of [
    'playwright', 'playwright-core',
    'C:/Users/Mega Store/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'
  ]) {
    try { return require(candidate) } catch { /* next */ }
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

test('live: no route overflows the viewport, and payments stay a table', async (t) => {
  const playwright = loadPlaywright()
  const executablePath = findChromium()
  const base = process.env.V8_SCREENSHOT_BASE || 'http://127.0.0.1:3000'
  if (!playwright || !executablePath) return t.skip('playwright chromium is not available')
  let reachable = true
  try { reachable = (await fetch(`${base}/payments`, { cache: 'no-store' })).ok } catch { reachable = false }
  if (!reachable) return t.skip(`dashboard not running at ${base}`)

  const browser = await playwright.chromium.launch({ executablePath })
  try {
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } })
      const page = await context.newPage()
      for (const route of ['/', '/payments', '/companies', '/tasks', '/settings']) {
        await page.goto(base + route, { waitUntil: 'networkidle', timeout: 45000 })
        await page.waitForTimeout(300)
        const measured = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth
        }))
        assert.ok(measured.scrollWidth <= measured.innerWidth + 1,
          `${route}@${width} overflows: ${measured.scrollWidth} > ${measured.innerWidth}`)
      }
      // The worklist must be a real table, and its names must be legible.
      await page.goto(`${base}/payments`, { waitUntil: 'networkidle', timeout: 45000 })
      assert.equal(await page.locator('.worklist-table').count(), 1, `payments@${width} renders one worklist table`)
      assert.equal(await page.locator('table.record-card-list-payments').count(), 0,
        `payments@${width} no longer renders the old card grid`)
      const names = await page.locator('.worklist-table .company-name-full').all()
      assert.ok(names.length > 0, `payments@${width} names every row's company in full`)
      for (const name of names.slice(0, 12)) {
        const box = await name.boundingBox()
        assert.ok(box.width > 0 && box.width <= width, `payments@${width} name fits the screen`)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
})

test('paused: the adviser refuses a proposal at call time, not just in the source', async () => {
  const proposals = require('../assistant/code-proposals.js')
  const row = db.prepare('SELECT capability,paused FROM ai_provider_state WHERE capability=?').get('system_adviser')
  assert.ok(row, 'the system_adviser capability row exists')
  assert.equal(row.capability, 'system_adviser')

  db.prepare('UPDATE ai_provider_state SET paused=0 WHERE capability=?').run('system_adviser')
  // Unpaused: the call proceeds far enough to complain about configuration,
  // which proves the pause gate is what stopped it before.
  await assert.rejects(
    () => proposals.generateProposal({ kind: 'test' }),
    (error) => !/AI_POLICY_BLOCKED/.test(error.message),
    'while running, the failure must not be the pause refusal'
  )

  db.prepare('UPDATE ai_provider_state SET paused=1 WHERE capability=?').run('system_adviser')
  await assert.rejects(
    () => proposals.generateProposal({ kind: 'test' }),
    /AI_POLICY_BLOCKED/,
    'a paused adviser refuses the request'
  )
})

test('truncated: a capped list reports its real total instead of looking complete', async () => {
  const data = await import('../launcher/lib/data.js')
  const companyId = require('../harness/ingest').stable('company', 'plan24')
  db.prepare(`INSERT INTO companies(id,name,account_key,english_name,portal_name,name_source,created_at,updated_at)
    VALUES(?,'شركة الاختبار','plan24','PLAN24','شركة الاختبار','source','now','now')
    ON CONFLICT(account_key) DO NOTHING`).run(companyId)

  const insert = db.prepare(`INSERT INTO payments(id,company_id,account_key,claim_number,amount,currency,due_date,status,
    raw_json,created_at,updated_at,source_observed_at,source_stale)
    VALUES(@id,@company_id,'plan24',@claim_number,@amount,'EGP','2030-01-01','open','{}','now','now','now',0)`)
  const total = data.RECORD_LIMITS.payments + 5
  for (let i = 0; i < total; i += 1) {
    insert.run({ id: `plan24-payment-${i}`, company_id: companyId, claim_number: `CLM-${i}`, amount: i + 1 })
  }

  const rows = data.listRecords('payments')
  const truncation = data.truncationOf(rows)
  assert.ok(truncation, 'truncation metadata is present')
  assert.equal(truncation.truncated, true, 'the list admits it is capped')
  assert.equal(truncation.limit, data.RECORD_LIMITS.payments)
  assert.equal(rows.length, data.RECORD_LIMITS.payments, 'exactly the limit is returned')
  assert.equal(truncation.total, total, 'the true total is reported, not the shown count')
  assert.equal(JSON.parse(JSON.stringify(rows)).length, rows.length, 'the metadata does not leak into serialised rows')

  const small = data.listRecords('failures')
  assert.equal(data.truncationOf(small).truncated, false, 'an uncapped list does not claim truncation')
})

test('the throwaway database is still open for the behavioural tests', () => {
  assert.equal(db.open, true)
})

test.after(() => {
  for (const handle of new Set([db, getDatabase()])) {
    if (handle && handle.open) handle.close()
  }
  fs.rmSync(testDirectory, { recursive: true, force: true })
  if (previousDbPath === undefined) delete process.env.V8_DB_PATH
  else process.env.V8_DB_PATH = previousDbPath
  if (previousV8Root === undefined) delete process.env.V8_ROOT
  else process.env.V8_ROOT = previousV8Root
})