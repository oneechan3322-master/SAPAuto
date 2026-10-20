'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { reconcileInterruptedCycles, runCycle } = require('../harness/loop')

const ROOT = path.resolve(__dirname, '..')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-plan41-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

function insertAccount(db, username, label = username) {
  db.prepare(`INSERT INTO accounts(account_key,username,label,secret_cipher,secret_iv,secret_tag,enabled,created_at,updated_at)
    VALUES(?,?,?,?,?,?,1,?,?)`)
    .run(username, username, label, 'c', 'i', 't', '2026-10-16', '2026-10-16')
}

/* ── Item 1: toggle switches must not clip in RTL ─────────────────────────── */

test('item 1: switch pills clip the knob and travel by logical distance', () => {
  const css = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'components.css'), 'utf8')
  const trackBlock = css.match(/\.channel-switch, \.setting-switch \{[^}]+\}/)
  assert.ok(trackBlock, 'switch track rule exists')
  assert.match(trackBlock[0], /overflow: hidden/, 'the capsule clips a mid-travel knob')
  assert.match(trackBlock[0], /box-sizing: border-box/, 'borders cannot inflate the pill')
  const onBlock = css.match(/\.channel-switch\.is-on span, \.setting-switch\.is-on span \{[^}]+\}/)
  assert.ok(onBlock, 'switch on-state rule exists')
  assert.match(onBlock[0], /translateX\(calc\(-100% - 2px\)\)/,
    'travel is expressed relative to the knob, not a hardcoded offset')
  assert.doesNotMatch(onBlock[0], /translateX\(-20px\)/, 'no hardcoded pixel travel remains')
  const rtlBlock = css.match(/\[dir="rtl"\] \.channel-switch\.is-on span[^{]+\{[^}]+\}/)
  assert.ok(rtlBlock, 'explicit RTL rule exists')
  assert.match(rtlBlock[0], /translateX\(calc\(-100% - 2px\)\)/)
})

/* ── Item 2: payroll in the navigation ───────────────────────────────────── */

test('item 2: payroll has a navigation link and a workplace page', () => {
  const navigation = fs.readFileSync(path.join(ROOT, 'launcher', 'components', 'navigation.jsx'), 'utf8')
  assert.match(navigation, /\{ label: 'الرواتب', href: '\/payroll', icon: \w+ \}/,
    'payroll link is present')
  const paymentsIndex = navigation.indexOf("href: '/payments'")
  const payrollIndex = navigation.indexOf("href: '/payroll'")
  assert.ok(payrollIndex > paymentsIndex, 'payroll follows المدفوعات in the nav order')
  const page = fs.readFileSync(
    path.join(ROOT, 'launcher', 'app', '(protected)', 'payroll', 'page.jsx'), 'utf8')
  assert.match(page, /ZMCF_PAYROLL/, 'the page names the payroll portal')
  assert.match(page, /قراءة فقط/, 'the page states read-only operation')
})

/* ── Item 3: honest cycle states ─────────────────────────────────────────── */

test('item 3: the settings screen localizes every cycle state to Arabic', () => {
  const form = fs.readFileSync(
    path.join(ROOT, 'launcher', 'components', 'settings-form.jsx'), 'utf8')
  assert.match(form, /running: \{ label: 'قيد الفحص', tone: 'busy' \}/)
  assert.match(form, /done: \{ label: 'مكتملة', tone: 'good' \}/)
  assert.match(form, /interrupted: \{ label: 'متوقفة', tone: 'muted' \}/)
  assert.match(form, /failed: \{ label: 'فشلت', tone: 'bad' \}/)
  assert.doesNotMatch(form, /\? data\.lastCycle\.state\}/,
    'a raw harness state can never reach the screen')
})

test('item 3: a cycle interrupted by a pause is recorded as interrupted', async (t) => {
  const db = fixture(t)
  insertAccount(db, 'acct-1')
  insertAccount(db, 'acct-2')
  db.prepare('UPDATE harness_status SET paused=1 WHERE id=1').run()
  const outcome = await runCycle({ db, scanner: async () => ({}) })
  assert.equal(outcome.processed, 0)
  const cycle = db.prepare('SELECT state, finished_at FROM automation_cycles ORDER BY started_at DESC LIMIT 1').get()
  assert.equal(cycle.state, 'interrupted', 'a paused cycle is not done')
  assert.ok(cycle.finished_at, 'an interrupted cycle still records when it stopped')
})

test('item 3: a running cycle left by a dead process is reconciled', (t) => {
  const db = fixture(t)
  db.prepare(`INSERT INTO automation_cycles(id,started_at,state,accounts_total)
    VALUES('cycle-stale','2026-10-16T10:00:00.000Z','running',26)`).run()
  const changed = reconcileInterruptedCycles(db)
  assert.equal(changed, 1)
  const cycle = db.prepare('SELECT state, finished_at FROM automation_cycles WHERE id=?').get('cycle-stale')
  assert.equal(cycle.state, 'interrupted')
  assert.ok(cycle.finished_at, 'the interrupted cycle records a stop time')
  assert.equal(reconcileInterruptedCycles(db), 0, 'reconciliation is idempotent')
  const event = db.prepare("SELECT kind FROM events WHERE kind='cycle_interrupted'").get()
  assert.ok(event, 'the reconciliation is audited as an event')
})

/* ── Item 4: native accounts, no external directory ──────────────────────── */

test('item 4: account secrets are encrypted at rest and never listed', (t) => {
  const previousKey = process.env.V8_ACCOUNTS_KEY
  process.env.V8_ACCOUNTS_KEY = 'a'.repeat(64)
  t.after(() => {
    if (previousKey === undefined) delete process.env.V8_ACCOUNTS_KEY
    else process.env.V8_ACCOUNTS_KEY = previousKey
  })
  const db = fixture(t)
  const { upsertAccount, getCredentials, listAccounts, encryptSecret, decryptSecret, resolveAccountsKey } =
    require('../harness/accounts')
  const key = resolveAccountsKey({ allowGenerate: false })
  upsertAccount({ username: 'acct-1', label: 'Account One', password: 'S3cret-P@ss' }, db, key)
  const row = db.prepare('SELECT secret_cipher FROM accounts WHERE account_key=?').get('acct-1')
  assert.ok(row.secret_cipher.length > 0)
  assert.doesNotMatch(row.secret_cipher, /S3cret/, 'ciphertext never contains the plaintext')
  const listed = listAccounts(db)
  assert.deepEqual(Object.keys(listed[0]).sort(), ['id', 'label', 'username'],
    'the listing exposes no secret material')
  const credentials = getCredentials('acct-1', db, key)
  assert.equal(credentials.password, 'S3cret-P@ss', 'the scanner can decrypt for use')
  const pair = encryptSecret('another-secret', key)
  assert.equal(decryptSecret(pair, key), 'another-secret')
})

test('item 4: a wrong key cannot decrypt an account secret', (t) => {
  const db = fixture(t)
  const { upsertAccount, getCredentials, encryptSecret, decryptSecret, resolveAccountsKey } =
    require('../harness/accounts')
  const rightKey = resolveAccountsKey()
  const wrongKey = Buffer.alloc(32, 7)
  const stored = encryptSecret('do-not-leak', rightKey)
  assert.throws(() => decryptSecret(stored, wrongKey),
    'AES-GCM authentication failure surfaces as an error, not garbage plaintext')
  upsertAccount({ username: 'acct-2', label: 'Two', password: 'pw' }, db, rightKey)
  assert.throws(() => getCredentials('acct-2', db, wrongKey))
})

test('item 4: the accounts importer parses the legacy line formats', () => {
  const { parseAccountLines } = require('../harness/import-accounts')
  const { accounts, errors } = parseAccountLines([
    '# a comment',
    '',
    'user1|pass1',
    'شركة معروفة|user2|pass2',
    'weird|pass|with|pipes'
  ].join('\n'))
  assert.equal(errors.length, 0)
  assert.equal(accounts.length, 3)
  assert.equal(accounts[0].username, 'user1')
  assert.equal(accounts[0].label, accounts[0].username, 'no alias falls back to the username')
  assert.equal(accounts[1].username, 'user2')
  assert.equal(accounts[1].password, 'pass2')
  assert.equal(accounts[2].password, 'with|pipes', 'pipes in a password survive the split')
  const malformed = parseAccountLines('no-separator-line')
  assert.equal(malformed.accounts.length, 0)
  assert.equal(malformed.errors.length, 1)
})

test('item 4: the scraper dependency closure is self-contained', () => {
  // Every require inside harness/scraper must resolve inside the scraper tree,
  // a node builtin, or playwright — with exactly one deliberate bridge: the
  // credential lookup in scanner/index.js, which reads V8's accounts store.
  const { builtinModules } = require('node:module')
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
  const allowedBridge = path.join('scraper', 'index.js')
  const scraperRoot = path.join(ROOT, 'harness', 'scraper')
  const offenders = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) { walk(fullPath); continue }
      if (!entry.name.endsWith('.js')) continue
      const source = fs.readFileSync(fullPath, 'utf8')
      for (const match of source.matchAll(/require\('([^']+)'\)/g)) {
        const request = match[1]
        if (builtins.has(request) || request === 'playwright') continue
        if (request.startsWith('.')) {
          let resolved
          try { resolved = require.resolve(path.resolve(directory, request)) } catch { continue }
          if (resolved.startsWith(scraperRoot)) continue
          const fromFile = path.relative(scraperRoot, fullPath)
          if ((fromFile === 'index.js' || fromFile === path.join('index.js')) &&
              path.resolve(resolved) === path.resolve(path.join(ROOT, 'harness', 'accounts.js'))) continue
          offenders.push(`${entry.name} -> ${request}`)
          continue
        }
        offenders.push(`${entry.name} -> ${request} (bare specifier)`)
      }
    }
  }
  walk(scraperRoot)
  assert.deepEqual(offenders, [], 'no scraper file escapes its own tree')
})

test('item 4: V8 runtime modules never reference SAPAuto3', () => {
  // The decoupling is only real if nothing in the runtime still points at the
  // legacy tree. Docs and the one-time importer's default path are exempt.
  const runtimeRoots = ['harness', 'channels', 'assistant', 'launcher', 'domain', 'db']
  const exemptFiles = new Set([
    path.join('harness', 'import-accounts.js'),
    path.join('harness', 'scraper', 'config.js')
  ])
  const offenders = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) { walk(fullPath); continue }
      if (!/\.(?:c?js|jsx)$/.test(entry.name)) continue
      const relative = path.relative(ROOT, fullPath)
      if (exemptFiles.has(relative)) continue
      if (/SAPAuto3/.test(fs.readFileSync(fullPath, 'utf8'))) offenders.push(relative)
    }
  }
  for (const runtimeRoot of runtimeRoots) walk(path.join(ROOT, runtimeRoot))
  assert.deepEqual(offenders, [], 'no runtime module names SAPAuto3')
})

test('item 4: run-account enforces the scan contract and stays bounded', async () => {
  const { runAccount, DEFAULT_SCAN_TIMEOUT_MS } = require('../harness/run-account')
  assert.equal(DEFAULT_SCAN_TIMEOUT_MS, 15 * 60 * 1000)
  await assert.rejects(() => runAccount(''), /Account key is required/)
  const good = {
    account: { key: 'acct-1', label: 'A' },
    login: { success: true }, tasks: [], obligations: [], payments: [], messages: [], diffs: []
  }
  const result = await runAccount('acct-1', { scanAccount: async () => good })
  assert.deepEqual(result, good)
  await assert.rejects(
    () => runAccount('acct-1', { scanAccount: async () => ({ login: { success: true } }) }),
    /missing tasks/)
  await assert.rejects(
    () => runAccount('acct-1', { scanAccount: async () => ({ ...good, tasks: 'nope' }) }),
    /tasks must be an array/)
  await assert.rejects(
    () => runAccount('acct-1', { timeoutMs: 25, scanAccount: () => new Promise(() => {}) }),
    /exceeded/, 'a hung scan is abandoned, not waited on forever')
})

test('item 4: the scraper CLI writes the scan contract atomically', async (t) => {
  const cli = require('../harness/scraper/cli')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-cli-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'scan.json')
  const expected = {
    account: { key: 'acct-1', label: 'A' },
    login: { success: true, rejected: false, skipped: false },
    tasks: [], obligations: [], payments: [], messages: [], diffs: []
  }
  await cli.main(['--account', 'acct-1', '--json-out', outputPath], {
    scanAccount: async () => expected
  })
  const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  assert.deepEqual(written, expected)
  const leftovers = fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [], 'no temporary file survives a successful write')
})
