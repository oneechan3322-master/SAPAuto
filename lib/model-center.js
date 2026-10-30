'use strict'

// Model Center (v8.2): the dashboard's control surface for the local LLM.
// Everything writes DB settings — the local-model service reads its model
// from settings at boot, so "switch + apply" is a dashboard action without
// terminal work. Nothing here runs outside the Owner's own requests.
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const MODEL_HOME_PATH = () => path.resolve(
  ROOT,
  process.env.V8_LOCAL_MODEL_HOME || '../pet',
  'models'
)

// Known model slots. URLs are NOT baked in (nothing here is fabricated);
// a download is always Owner-fed: exact https URL + exact target filename.
const CATALOG = [
  { key: 'E2B', label: 'Gemma-4 E2B (Q4) — سريع، الحد الأدنى للذاكرة', file: 'gemma-4-E2B-it-Q4_0.gguf' },
  { key: 'E4B', label: 'Gemma-4 E4B (Q4) — وسط، يحتاج ~6 جيجابايت حرة', file: 'gemma-4-E4B_q4_0-it.gguf' },
  { key: 'A4B26B', label: 'Gemma-4 26B A4B (Q4) — الأقوى، لجهاز الخادم فقط', file: 'gemma-4-26B-A4B-it-Q4_0.gguf', serverPc: true }
]

const SELECT_KEY = 'local_model_file'
const PROGRESS_KEY = 'model_progress'
const BENCH_KEY = 'bench_state'
const BENCH_CANCEL_KEY = 'bench_cancel'
const RUNTIME_KEY = 'model_runtime'
const DEFAULT_FILE = 'gemma-4-E2B-it-Q4_0.gguf'
const LOCAL_MODEL_PM2 = 'sapauto-v8-local-model'
const BENCH_MAX_MS = 15 * 60 * 1000 // a bench run may claim 15 minutes, never longer
const RUNTIME_FRESH_MS = 45 * 1000

function setting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key)
  return row ? row.value : ''
}
function writeSetting(db, key, value) {
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value)
}

function modelHome() {
  return MODEL_HOME_PATH()
}

function listState(db = require('../db/connect').getDatabase()) {
  const dir = modelHome()
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.gguf')).map((f) => {
        const st = fs.statSync(path.join(dir, f))
        return { file: f, sizeGB: Number((st.size / 1073741824).toFixed(2)), presentation: `${(st.size / 1073741824).toFixed(2)} جيجابايت` }
      })
    : []
  const selected = setting(db, SELECT_KEY) || DEFAULT_FILE
  const byFile = new Map(files.map((f) => [f.file, f]))
  const models = CATALOG.map((entry) => ({
    ...entry,
    present: byFile.has(entry.file),
    sizeGB: byFile.get(entry.file)?.sizeGB ?? null,
    selected: entry.file === selected
  }))
  // On-disk models that are outside the catalog stay visible (manual drops).
  const catalogFiles = new Set(CATALOG.map((c) => c.file))
  const extras = files.filter((f) => !catalogFiles.has(f.file)).map((f) => ({
    key: f.file, label: f.file, file: f.file, present: true, sizeGB: f.sizeGB,
    selected: f.file === selected, manual: true
  }))
  const heartbeat = db.prepare(`SELECT status,last_heartbeat FROM service_status
    WHERE service='local-model' ORDER BY rowid DESC LIMIT 1`).get() || null
  const bench = db.prepare(`SELECT model,threads,prompt_tok_per_s,gen_tok_per_s,context_tokens,measured_at
    FROM model_benchmarks ORDER BY measured_at DESC LIMIT 12`).all()
  const progress = parseJson(setting(db, PROGRESS_KEY))
  // bench_state.stale: a "running" claim older than the bench's own legal
  // maximum is dead air — the UI shows the truth instead of a forever spinner.
  const benchState = parseJson(setting(db, BENCH_KEY))
  if (benchState && benchState.state === 'running') {
    const tick = Date.parse(benchState.heartbeatAt || benchState.startedAt || '') || 0
    if (tick > 0 && (Date.now() - tick) > BENCH_MAX_MS) benchState.stale = true
  }
  const runtime = parseJson(setting(db, RUNTIME_KEY))
  if (runtime && runtime.ts) {
    if ((Date.now() - (Date.parse(runtime.ts) || 0)) > RUNTIME_FRESH_MS) runtime.stale = true
  }
  return { modelHome: dir, models: [...models, ...extras], selected, heartbeat, bench, progress, benchState, runtime, llamaServerPresent: llamaServerCheck() }
}

// Same candidates the bench script resolves — the dashboard must never claim
// llama.cpp is missing when the bench would find it in ROOT\bin.
function llamaServerCheck() {
  const candidates = [
    path.join(ROOT, 'llama-server.exe'),
    path.join(ROOT, '..', 'llama', 'llama-server.exe'),
    path.join(ROOT, 'bin', 'llama-server.exe'),
    process.env.V8_LLAMA_SERVER || ''
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

function parseJson(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

// The downloader/bench states that mean "a heavy background task owns the machine".
function downloadBusy(progress) {
  return Boolean(progress && (progress.state === 'running' || progress.state === 'starting'))
}

function benchFreshlyRunning(benchState, now = Date.now()) {
  if (!benchState || benchState.state !== 'running') return false
  const tick = Date.parse(benchState.heartbeatAt || benchState.startedAt || '') || 0
  return tick > 0 ? (now - tick) < BENCH_MAX_MS : true // no timestamp → treat as fresh
}

function activeProgress(db) {
  return parseJson(setting(db, PROGRESS_KEY))
}

function activeBenchState(db) {
  return parseJson(setting(db, BENCH_KEY))
}

function selectModel(db, { file }) {
  const name = String(file || '').trim()
  const dir = modelHome()
  if (!/^[A-Za-z0-9._-]+\.gguf$/.test(name)) return { error: 'اسم ملف النموذج غير صالح' }
  if (!fs.existsSync(path.join(dir, name))) return { error: `الملف غير موجود في ${dir}` }
  writeSetting(db, SELECT_KEY, name)
  return { selected: name }
}

function validateDownload({ url, file }) {
  let parsed
  try { parsed = new URL(String(url || '')) }
  catch { return { error: 'رابط التحميل غير صالح' } }
  if (parsed.protocol !== 'https:') return { error: 'الرابط يجب أن يكون https فقط' }
  if (parsed.username || parsed.password) return { error: 'روابط تحمل بيانات دخول مرفوضة' }
  const name = String(file || '').trim()
  if (!/^[A-Za-z0-9._-]+\.gguf$/.test(name)) return { error: 'اسم الملف يجب أن يكون .gguf بدون مسارات' }
  const dir = modelHome()
  if (fs.existsSync(path.join(dir, name))) return { error: 'الملف موجود مسبقاً — استبداله جزء من ترقية متعمدة وليس ضمن هذا الخيار' }
  return { url: parsed.origin + parsed.pathname, file: name }
}

function startDownload(db, { url, file }, run = require('node:child_process').spawn) {
  const valid = validateDownload({ url, file })
  if (valid.error) return { error: valid.error }
  if (benchFreshlyRunning(activeBenchState(db))) return { error: 'القياس يعمل الآن — أوقفه أو انتظر انتهاءه قبل بدء تحميل' }
  const progress = { state: 'starting', url: valid.url, file: valid.file, received: 0, total: 0, pct: 0 }
  writeSetting(db, PROGRESS_KEY, JSON.stringify(progress))
  const child = run(process.execPath, [
    path.join(ROOT, 'scripts', 'download-model.js'),
    '--url', valid.url,
    '--file', valid.file
  ], { detached: true, stdio: 'ignore', windowsHide: true })
  if (typeof child.unref === 'function') child.unref()
  return { started: true, ...valid }
}

function requestCancel(db) {
  const raw = setting(db, PROGRESS_KEY)
  if (!raw) return { error: 'لا يوجد تحميل جارٍ' }
  let progress
  try { progress = JSON.parse(raw) } catch { return { error: 'حالة التحميل تالفة' } }
  if (progress.state === 'done') return { error: 'التحميل انتهى مسبقاً' }
  progress.cancel = true
  writeSetting(db, PROGRESS_KEY, JSON.stringify(progress))
  return { cancelRequested: true }
}

function startBench(db, run = require('node:child_process').spawn) {
  if (!llamaServerCheck()) return { error: 'llama.cpp غير مثبت بعد — ثبّت llama-server.exe في ROOT\\bin أو عبر V8_LLAMA_SERVER ثم أعد المحاولة' }
  if (downloadBusy(activeProgress(db))) return { error: 'هناك تحميل جارٍ — انتظر انتهاءه أو ألغِه قبل تشغيل القياس' }
  if (benchFreshlyRunning(activeBenchState(db))) return { error: 'القياس يعمل مسبقاً — استخدم «إلغاء القياس» إن أردت إيقافه' }
  writeSetting(db, BENCH_KEY, JSON.stringify({ state: 'running', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }))
  const child = run(process.execPath, [path.join(ROOT, 'scripts', 'bench-models.js')], {
    detached: true, stdio: 'ignore', windowsHide: true
  })
  if (typeof child.unref === 'function') child.unref()
  return { started: true }
}

function requestCancelBench(db) {
  const state = activeBenchState(db)
  if (!state || state.state !== 'running') return { error: 'لا يوجد قياس جارٍ' }
  writeSetting(db, BENCH_CANCEL_KEY, 'true')
  writeSetting(db, BENCH_KEY, JSON.stringify({ ...state, cancelRequested: true, heartbeatAt: new Date().toISOString() }))
  return { cancelRequested: true }
}

// apply — the ONLY place a service restart happens from the dashboard, and
// only by the Owner's explicit press. Guards first: a restart that cannot
// succeed must never be pressed into a crash-loop.
function applyModel(db, run = null, opts = {}) {
  const os = require('node:os')
  const selected = setting(db, SELECT_KEY) || DEFAULT_FILE
  const guard = applyGuards(db, selected, opts)
  if (guard) return Promise.resolve({ applied: false, error: guard, selected })
  const { spawn } = require('node:child_process')
  const runner = run || spawn
  return servicePm2Action(runner, 'restart', selected)
}

// Guards shared by apply: missing weights, busy background tasks, RAM fit.
function applyGuards(db, selected, opts = {}) {
  const dir = modelHome()
  const full = path.join(dir, selected)
  if (!fs.existsSync(full)) {
    return `الملف غير موجود على القرص (${selected} في ${dir}) — التطبيق سيُشغّل الخدمة في حلقة انهيار؛ اختر ملفاً موجوداً أو نزّله أولاً`
  }
  if (downloadBusy(activeProgress(db))) {
    return 'هناك تحميل جارٍ — انتظر انتهاءه أو ألغِه قبل إعادة تشغيل الخدمة'
  }
  if (benchFreshlyRunning(activeBenchState(db))) {
    return 'القياس يعمل الآن — انتظر انتهاءه أو أوقفه (إلغاء القياس) قبل إعادة التشغيل'
  }
  // RAM fit: weights*1.15 (mmap read-ahead) + 1.5 GB headroom for the 8 services.
  const sizeGB = fs.statSync(full).size / (1024 ** 3)
  const needGB = sizeGB * 1.15 + 1.5
  const totalGB = (opts.totalBytes ?? require('node:os').totalmem()) / (1024 ** 3)
  if (totalGB < needGB) {
    return `[RAM-GUARD] ${selected} يحتاج ~${needGB.toFixed(1)} جيجابايت وهذا الجهاز فيه ${totalGB.toFixed(1)} فقط — ابقَ على نموذج أخف أو رقّ الذاكرة`
  }
  return null
}

function servicePm2Action(runner, verb, selected) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    const child = runner('cmd', ['/c', 'pm2', verb, LOCAL_MODEL_PM2], { windowsHide: true })
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on?.('error', (e) => resolve({ applied: false, error: e.message }))
    child.on?.('close', (code) => resolve({
      applied: verb === 'start' ? code === 0 : code === 0,
      stopped: verb === 'stop' && code === 0,
      started: verb === 'start' && code === 0,
      error: code === 0 ? null : `pm2 ${verb} exited with code ${code}: ${err.slice(-200)}`,
      output: (out + err).slice(-400),
      selected
    }))
  })
}

// Dashboard power over the model service — the answer to "remote machine,
// runaway process, no RDP": an audited Owner press stops or starts it.
function stopService(db, run = null) {
  const { spawn } = require('node:child_process')
  const runner = run || spawn
  return servicePm2Action(runner, 'stop', setting(db, SELECT_KEY) || DEFAULT_FILE)
}

function startService(db, run = null) {
  const { spawn } = require('node:child_process')
  const runner = run || spawn
  return servicePm2Action(runner, 'start', setting(db, SELECT_KEY) || DEFAULT_FILE)
}

function stopAllServices(db, run = null) {
  const { spawn } = require('node:child_process')
  const runner = run || spawn
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    const child = runner('cmd', ['/c', 'pm2', 'stop', 'sapauto-v8-harness', 'sapauto-v8-local-model', 'sapauto-v8-assistant', 'sapauto-v8-mcp', 'sapauto-v8-mailtg-sender'], { windowsHide: true })
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on?.('error', (e) => resolve({ stopped: false, error: e.message }))
    child.on?.('close', (code) => resolve({
      stopped: code === 0,
      error: code === 0 ? null : `pm2 stop exited with code ${code}: ${err.slice(-200)}`,
      output: (out + err).slice(-400)
    }))
  })
}

function restartAllServices(db, run = null) {
  const { spawn } = require('node:child_process')
  const runner = run || spawn
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    const child = runner('cmd', ['/c', 'pm2', 'restart', 'all'], { windowsHide: true })
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on?.('error', (e) => resolve({ restarted: false, error: e.message }))
    child.on?.('close', (code) => resolve({
      restarted: code === 0,
      error: code === 0 ? null : `pm2 restart all exited with code ${code}: ${err.slice(-200)}`,
      output: (out + err).slice(-400)
    }))
  })
}

// Last-resort failsafe: reboot the MACHINE this dashboard runs on. Owner
// press only, requires the exact confirm token, schedules Windows shutdown
// with a 90-second grace, and stays away from the 8 PM2 services entirely —
// the reboot itself is the failsafe (services die with the machine; with
// auto-start kept off, the server wakes idle and clean).
const REBOOT_CONFIRM_TOKEN = 'RESTART-SERVER-PC'
const REBOOT_DELAY_SECONDS = 90

function rebootPc({ confirm } = {}, run = require('node:child_process').spawn) {
  if (process.env.V8_REBOOT_ALLOWED !== '1') {
    return { rebooting: false, error: '\u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0642\u0641\u0644\u0629 \u2014 \u064A\u0644\u0632\u0645 \u062A\u0641\u0639\u064A\u0644 V8_REBOOT_ALLOWED=1 \u0623\u0648\u0644\u0627\u064B' }
  }
  if (confirm !== REBOOT_CONFIRM_TOKEN) {
    return { rebooting: false, error: 'التأكيد مطلوب — أعد الضغط مع تأكيد إعادة تشغيل الجهاز' }
  }
  const spawnFn = run
  return new Promise((resolve) => {
    let err = ''
    const child = spawnFn('shutdown', ['/r', '/t', String(REBOOT_DELAY_SECONDS), '/d', 'p:4:1', '/c', 'SAPAuto: Owner-triggered restart'], { windowsHide: true })
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on?.('error', (e) => resolve({ rebooting: false, error: e.message }))
    child.on?.('close', (code) => resolve({
      rebooting: code === 0,
      delaySeconds: REBOOT_DELAY_SECONDS,
      error: code === 0 ? null : `shutdown refused (code ${code}): ${err.slice(-200)}`
    }))
  })
}

// Abort a pending reboot inside the grace window: shutdown /a cancels it.
function abortReboot(run = require('node:child_process').spawn) {
  const spawnFn = run
  return new Promise((resolve) => {
    let out = ''
    const child = spawnFn('shutdown', ['/a'], { windowsHide: true })
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { out += String(d) })
    child.on?.('error', (e) => resolve({ aborted: false, error: e.message }))
    child.on?.('close', (code) => resolve({ aborted: code === 0, output: out.slice(-200) }))
  })
}

module.exports = {
  modelHome, listState, selectModel, validateDownload,
  startDownload, requestCancel, requestCancelBench, startBench, applyModel,
  stopService, startService, stopAllServices, restartAllServices, rebootPc, abortReboot,
  llamaServerCheck, parseJson, downloadBusy, benchFreshlyRunning,
  SELECT_KEY, PROGRESS_KEY, BENCH_KEY, BENCH_CANCEL_KEY, RUNTIME_KEY,
  DEFAULT_FILE, LOCAL_MODEL_PM2, CATALOG, ROOT, BENCH_MAX_MS,
  REBOOT_CONFIRM_TOKEN, REBOOT_DELAY_SECONDS
}
