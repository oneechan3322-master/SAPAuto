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
const DEFAULT_FILE = 'gemma-4-E2B-it-Q4_0.gguf'

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
  let progress = null
  const progressRaw = setting(db, PROGRESS_KEY)
  if (progressRaw) { try { progress = JSON.parse(progressRaw) } catch { progress = null } }
  let benchStateRaw = setting(db, BENCH_KEY)
  let benchState = null
  if (benchStateRaw) { try { benchState = JSON.parse(benchStateRaw) } catch { benchState = null } }
  return { modelHome: dir, models: [...models, ...extras], selected, heartbeat, bench, progress, benchState, llamaServerPresent: llamaServerCheck() }
}

function llamaServerCheck() {
  const candidates = [
    path.join(ROOT, 'llama-server.exe'),
    path.join(ROOT, '..', 'llama', 'llama-server.exe'),
    process.env.V8_LLAMA_SERVER || ''
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
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
  writeSetting(db, BENCH_KEY, JSON.stringify({ state: 'running', startedAt: new Date().toISOString() }))
  const child = run(process.execPath, [path.join(ROOT, 'scripts', 'bench-models.js')], {
    detached: true, stdio: 'ignore', windowsHide: true
  })
  if (typeof child.unref === 'function') child.unref()
  return { started: true }
}

// apply — the ONLY place a service restart happens from the dashboard, and
// only by the Owner's explicit press. pm2 must already be on this machine.
function applyModel(db, run = null) {
  const { spawn } = require('node:child_process')
  const runner = run || spawn
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    const child = runner('cmd', ['/c', 'pm2', 'restart', 'sapauto-v8-local-model'], { windowsHide: true })
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on?.('error', (e) => resolve({ applied: false, error: e.message }))
    child.on?.('close', (code) => resolve({
      applied: code === 0,
      error: code === 0 ? null : `pm2 exited with code ${code}: ${err.slice(-200)}`,
      output: (out + err).slice(-400),
      selected: setting(db, SELECT_KEY) || DEFAULT_FILE
    }))
  })
}

module.exports = {
  modelHome, listState, selectModel, validateDownload,
  startDownload, requestCancel, startBench, applyModel,
  SELECT_KEY, PROGRESS_KEY, BENCH_KEY, DEFAULT_FILE, CATALOG, ROOT
}
