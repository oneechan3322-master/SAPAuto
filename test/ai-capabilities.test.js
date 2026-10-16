'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const previousDbPath = process.env.V8_DB_PATH
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-phase-a-'))
process.env.V8_DB_PATH = path.join(testDirectory, 'phase-a.db')

const { openDatabase, getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const db = openDatabase(process.env.V8_DB_PATH)
runMigrations(db)

const capabilities = require('../domain/ai-capabilities.cjs')
const service = require('../assistant/capabilities.js')
const proposals = require('../assistant/code-proposals.js')
const { chat } = require('../assistant/model')

const V8_ROOT = path.resolve(__dirname, '..')
const PRODUCT_ROOTS = ['assistant', 'db', 'domain', 'harness', 'channels', 'mcp', 'launcher', 'test']
const SCANNABLE = /\.(jsx?|cjs|mjs|sql|css)$/
/* The plan document names the removed provider in order to forbid it. */
const ALLOWED_MENTIONS = new Set(['plan2.0.md'])
/* Assembled at runtime so this guard file is itself clean. */
const REMOVED_PROVIDER = new RegExp(['oll', 'ama'].join(''), 'i')

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      walk(full, out)
    } else if (SCANNABLE.test(entry.name)) out.push(full)
  }
  return out
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString())
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
 * 13.1 — Provider separation
 * ------------------------------------------------------------------ */
test('the removed provider has no product surface left', () => {
  const offenders = []
  for (const root of PRODUCT_ROOTS) {
    for (const file of walk(path.join(V8_ROOT, root))) {
      if (ALLOWED_MENTIONS.has(path.relative(V8_ROOT, file))) continue
      const source = fs.readFileSync(file, 'utf8')
      if (REMOVED_PROVIDER.test(source)) offenders.push(path.relative(V8_ROOT, file))
    }
  }
  for (const file of ['.env', '.env.example', 'README.md']) {
    const full = path.join(V8_ROOT, file)
    if (fs.existsSync(full) && REMOVED_PROVIDER.test(fs.readFileSync(full, 'utf8'))) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'no source, configuration, or documentation reference remains')
})

test('only Gemma 4 and Mistral are runtime providers, and OpenCode is not one', () => {
  assert.deepEqual([...capabilities.RUNTIME_PROVIDERS], ['gemma4', 'mistral'])
  assert.deepEqual([...capabilities.CAPABILITY_IDS], ['local_assistant', 'cloud_reviewer', 'system_adviser'])
  const report = capabilities.capabilityReport()
  assert.deepEqual(
    report.capabilities.map((item) => [item.id, item.boundary]),
    [['local_assistant', 'device'], ['cloud_reviewer', 'cloud'], ['system_adviser', 'source']]
  )
  assert.doesNotMatch(JSON.stringify(report), /MISTRAL_API_KEY|OPENCODE_BIN|Authorization|Bearer/i)
})

test('Gemma works locally and never becomes a network call elsewhere', async (t) => {
  const previousFetch = global.fetch
  const seen = []
  global.fetch = async (url, options) => {
    seen.push(String(url))
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'رد محلي' } }] })
    }
  }
  setSetting('ai_provider', 'gemma4')
  t.after(() => { global.fetch = previousFetch })

  const result = await chat([{ role: 'user', content: 'ملخص' }])
  assert.equal(result.content, 'رد محلي')
  assert.equal(seen.length, 1)
  assert.match(seen[0], /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d+\//)
})

test('turning Gemma off never invokes Mistral', async (t) => {
  const previousFetch = global.fetch
  let requests = 0
  global.fetch = async () => { requests += 1; throw new Error('unexpected network request') }
  setSetting('ai_provider', 'gemma4')
  setSetting('ai_allow_cloud', 'true')
  db.prepare('UPDATE ai_provider_state SET paused=1 WHERE capability=?').run('local_assistant')
  t.after(() => {
    db.prepare('UPDATE ai_provider_state SET paused=0 WHERE capability=?').run('local_assistant')
    global.fetch = previousFetch
  })

  await assert.rejects(chat([{ role: 'user', content: 'x' }]), /LOCAL_ASSISTANT_UNAVAILABLE/)
  assert.equal(requests, 0, 'no cloud fallback path exists')
})

test('Mistral cannot run without a key, enablement, and an unpaused cloud lane', async (t) => {
  const previousFetch = global.fetch
  let requests = 0
  global.fetch = async () => { requests += 1; throw new Error('unexpected network request') }
  const previousKey = process.env.MISTRAL_API_KEY
  delete process.env.MISTRAL_API_KEY
  setSetting('ai_provider', 'mistral')
  setSetting('ai_allow_cloud', 'true')
  t.after(() => {
    if (previousKey === undefined) delete process.env.MISTRAL_API_KEY
    else process.env.MISTRAL_API_KEY = previousKey
    global.fetch = previousFetch
  })

  await assert.rejects(chat([]), /MISTRAL_API_KEY is required/)
  assert.equal(requests, 0)

  process.env.MISTRAL_API_KEY = 'test-key-not-a-secret'
  setSetting('ai_allow_cloud', 'false')
  await assert.rejects(chat([]), /Mistral is disabled/)
  assert.equal(requests, 0)

  db.prepare('UPDATE ai_provider_state SET paused=1 WHERE capability=?').run('cloud_reviewer')
  setSetting('ai_allow_cloud', 'true')
  await assert.rejects(chat([]), /AI_POLICY_BLOCKED/)
  assert.equal(requests, 0)
  db.prepare('UPDATE ai_provider_state SET paused=0 WHERE capability=?').run('cloud_reviewer')
})

/* ------------------------------------------------------------------ *
 * OpenCode scope denial (13.1 + §6.1)
 * ------------------------------------------------------------------ */
test('OpenCode cannot receive operating data in a request', () => {
  for (const request of [
    'اعمل مراجعة لحساب الشركة 205971997',
    'راجع دفعة بمبلغ 150,000 جنيه',
    'تواصل مع البريد accountant@example.com',
    'راجع الملف 315240679678123',
    'راجع حساب marwanhamada في السجل',
    'استخدم كلمة المرور supersecretvalue123456'
  ]) {
    assert.throws(() => proposals.validateCodeOnlyRequest(request), /personal, account, payment, or credential/i)
  }
  assert.equal(
    proposals.validateCodeOnlyRequest('اقترح إصلاحًا في قراءة ملف settings'),
    'اقترح إصلاحًا في قراءة ملف settings'
  )
})

test('the OpenCode snapshot excludes data, secrets, dependencies, and build output', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-scope-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'src'))
  fs.mkdirSync(path.join(directory, 'data'))
  fs.mkdirSync(path.join(directory, 'node_modules'))
  fs.writeFileSync(path.join(directory, 'src', 'reader.js'), 'export const read = 1\n')
  fs.writeFileSync(path.join(directory, 'data', 'records.json'), '{"company":"secret"}\n')
  fs.writeFileSync(path.join(directory, 'node_modules', 'dep.js'), 'module.exports = 1\n')
  fs.writeFileSync(path.join(directory, '.env'), 'MISTRAL_API_KEY=abcdef\n')

  const snapshot = proposals.buildSourceSnapshot(directory)
  assert.match(snapshot, /### src[/\\]reader\.js/)
  assert.doesNotMatch(snapshot, /records\.json|node_modules|\.env/)
  assert.doesNotMatch(snapshot, /BEGIN [A-Z ]*PRIVATE KEY/)
  assert.match(proposals.makeConfig('anthropic/claude'), /"tools":\{"\*":false\}/)
  assert.match(proposals.makeConfig('anthropic/claude'), /"\*":\s*"deny"/)
})

test('a source file containing a credential is blocked before OpenCode sees it', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-secret-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'safe.js'), 'export const ok = 1\n')
  assert.doesNotThrow(() => proposals.buildSourceSnapshot(directory))

  fs.writeFileSync(path.join(directory, 'leak.js'), 'const password = "hunter2hunter2hunter2hunter2"\n')
  assert.throws(() => proposals.buildSourceSnapshot(directory), /possible credential/i)
})

/* ------------------------------------------------------------------ *
 * State model, pause control, audit, probes (§3.2, §12.1)
 * ------------------------------------------------------------------ */
test('capability states map facts to the documented Arabic labels', () => {
  assert.equal(capabilities.capabilityState('local_assistant', { paused: true }).label, 'متوقف مؤقتاً')
  assert.equal(capabilities.capabilityState('local_assistant', { health: 'unreachable' }).label, 'غير متاح')
  assert.equal(capabilities.capabilityState('cloud_reviewer', { configured: false }).label, 'غير مربوط')
  assert.equal(capabilities.capabilityState('cloud_reviewer', { configured: true }).label, 'جاهز للمراجعة')
  assert.equal(capabilities.capabilityState('cloud_reviewer', { configured: true, paused: true }).label, 'متوقف')
  assert.equal(capabilities.capabilityState('system_adviser', { configured: false }).label, 'غير مهيأ')
  assert.equal(capabilities.capabilityState('system_adviser', { configured: true, pendingCount: 2 }).label, 'طلب مراجعة قيد التنفيذ')
  assert.throws(() => capabilities.capabilityState('unknown_capability', {}), /Unknown capability/)
})

test('pausing a capability is append-only, audited, and enforced', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n
  const result = service.setPaused('cloud_reviewer', true, { actorId: 'local-operator', reason: 'اختبار' })

  assert.equal(result.paused, true)
  assert.equal(service.readiness().capabilities.find((item) => item.id === 'cloud_reviewer').paused, true)

  const event = db.prepare('SELECT * FROM ai_policy_event WHERE id=?').get(result.eventId)
  assert.equal(event.capability, 'cloud_reviewer')
  assert.equal(event.action, 'pause')

  const audited = db.prepare("SELECT * FROM audit_log WHERE action='ai.capability.paused' ORDER BY rowid DESC LIMIT 1").get()
  assert.equal(audited.entity_id, 'cloud_reviewer')
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n > before)

  // Resuming appends another event; history is never rewritten.
  service.setPaused('cloud_reviewer', false, { actorId: 'local-operator' })
  const history = db.prepare('SELECT action FROM ai_policy_event WHERE capability=? ORDER BY at, rowid').all('cloud_reviewer')
  assert.deepEqual(history.map((row) => row.action), ['pause', 'resume'])

  assert.throws(() => service.setPaused('not_a_capability', true), /Unsupported capability/)
})

test('the local probe is loopback-only and uses synthetic text only', async (t) => {
  const previousFetch = global.fetch
  const seen = []
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options })
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'gemma4-local' }] }) }
  }
  t.after(() => { global.fetch = previousFetch })

  const result = await service.probe('local_assistant', db)
  assert.equal(result.health, 'healthy')
  assert.equal(result.model, 'gemma4-local')
  assert.match(seen[0].url, /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d+\/v1\/models$/)
  assert.equal(seen[0].options.redirect, 'error')
  assert.doesNotMatch(seen[0].url, /mistral|opencode/i)
})

test('the cloud probe never sends office data and reports safely without a key', async (t) => {
  const previousKey = process.env.MISTRAL_API_KEY
  delete process.env.MISTRAL_API_KEY
  t.after(() => {
    if (previousKey === undefined) delete process.env.MISTRAL_API_KEY
    else process.env.MISTRAL_API_KEY = previousKey
  })

  const result = await service.probe('cloud_reviewer', db)
  assert.equal(result.health, 'unknown')
  assert.equal(result.errorCode, 'CLOUD_REVIEW_NOT_CONFIGURED')
  assert.equal(
    capabilities.capabilityState('cloud_reviewer', { configured: false }).label, 'غير مربوط'
  )
})

test('the adviser probe makes no network call at all', async (t) => {
  const previousFetch = global.fetch
  let requests = 0
  global.fetch = async () => { requests += 1; throw new Error('unexpected network request') }
  t.after(() => { global.fetch = previousFetch })

  const result = await service.probe('system_adviser', db)
  assert.equal(requests, 0)
  assert.equal(result.skipped, 'no_network_call')
})

test('readiness output carries states and copy but never a secret', () => {
  const report = service.readiness(db)
  const serialized = JSON.stringify(report)
  assert.equal(report.policyVersion, capabilities.REDACTION_POLICY_VERSION)
  assert.equal(report.capabilities.length, 3)
  assert.match(serialized, /لا تغادر بيانات المحادثة هذا الجهاز/)
  assert.match(serialized, /إلغاء/)
  assert.doesNotMatch(serialized, /MISTRAL_API_KEY|OPENCODE_BIN|OPENCODE_AUTH|V8_SESSION_SECRET|secret/i)
  assert.ok(capabilities.ERROR_VOCABULARY.CLOUD_CONSENT_REQUIRED.length > 10)
})