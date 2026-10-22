// scripts/download-model.js - the Model Center's downloader child process.
// Streams an https GGUF into ..\pet\models as <file>.part, publishes progress
// into the settings key 'model_progress' for the dashboard, and renames the
// part file into place only after a size sanity check. Cancel = dashboard
// sets progress.cancel=true and this process reacts on its next tick.
//
//   node scripts/download-model.js --url <https> --file <name.gguf>
// Exit codes: 0 ok/canceled, 1 validation, 2 network, 3 size, 4 file error.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const MODEL_HOME = path.resolve(ROOT, process.env.V8_LOCAL_MODEL_HOME || '../pet', 'models')
const MIN_GGUF_BYTES = 1 << 30 // every real GGUF here is >= 1 GB
const TICK_BYTES = 100 * 1024 * 1024 // publish progress every ~100 MB

function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') out.url = argv[i + 1]
    else if (argv[i] === '--file') out.file = argv[i + 1]
    else return null
    i += 1
  }
  return out.url && out.file ? out : null
}

function writeProgress(progress) {
  try {
    const { openDatabase } = require('../db/connect')
    const db = openDatabase()
    try {
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('model_progress',?,datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .run(JSON.stringify(progress))
    } finally { db.close() }
  } catch (error) {
    console.error(`progress write failed: ${error.message}`)
  }
}

async function main() {
  const args = parseArgs()
  if (!args) { console.error('usage: --url <https> --file <name.gguf>'); process.exitCode = 1; return }
  const name = String(args.file).trim()
  if (!/^[A-Za-z0-9._-]+\.gguf$/.test(name)) { console.error('bad file name'); process.exitCode = 1; return }
  const target = path.join(MODEL_HOME, name)
  const part = `${target}.part`
  const finalTarget = target
  const progress = {
    state: 'running', url: String(args.url), file: name,
    received: 0, total: 0, pct: 0
  }
  if (!fs.existsSync(MODEL_HOME)) fs.mkdirSync(MODEL_HOME, { recursive: true })
  const preexistingBytes = fs.existsSync(part) ? fs.statSync(part).size : 0
  progress.received = preexistingBytes

  const response = await fetch(args.url, {
    headers: { 'user-agent': 'SAPAuto-ModelCenter/1.0', accept: '*/*',
      ...(preexistingBytes ? { range: `bytes=${preexistingBytes}-` } : {}) }
  }).catch((e) => { writeProgress({ ...progress, state: 'error', error: e.message }); process.exitCode = 2; return null })
  if (!response) return
  if (!response.ok && response.status !== 206) {
    writeProgress({ ...progress, state: 'error', error: `HTTP ${response.status}` })
    process.exitCode = 2
    return
  }
  const sizeHeader = Number(response.headers.get('content-length') || 0)
  progress.total = preexistingBytes + sizeHeader

  const flags = preexistingBytes ? 'r+' : 'w'
  // 'a' appends and ignores range resume after truncation; keep semantics explicit:
  const file = fs.openSync(part, flags === 'r+' ? 'r+' : 'w')
  if (preexistingBytes) fs.truncateSync(file, preexistingBytes)
  try {
    const reader = response.body.getReader()
    let sinceTick = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      fs.writeSync(file, value, 0, value.length, progress.received)
      progress.received += value.length
      sinceTick += value.length
      if (progress.total > 0) progress.pct = Math.min(100, Math.round(progress.received / progress.total * 100))
      if (sinceTick >= TICK_BYTES) {
        if (progress.cancel) { break }
        sinceTick = 0
        writeProgress({ ...progress })
      }
    }
  } finally {
    fs.closeSync(file)
  }
  if (progress.cancel) {
    writeProgress({ ...progress, state: 'cancelled' })
    try { fs.unlinkSync(part) } catch { /* nothing to sweep */ }
    return
  }
  if (progress.total > 0 && progress.received < progress.total) {
    writeProgress({ ...progress, state: 'error', error: `download stopped at ${progress.received}/${progress.total}` })
    process.exitCode = 2
    return
  }
  const size = fs.statSync(part).size
  if (size < MIN_GGUF_BYTES) {
    writeProgress({ ...progress, state: 'error', error: `file ${size} bytes is below the GGUF sanity floor` })
    try { fs.unlinkSync(part) } catch { /* keep the error visible only */ }
    process.exitCode = 3
    return
  }
  fs.renameSync(part, finalTarget)
  writeProgress({ ...progress, state: 'done', file: name, pct: 100, doneAt: new Date().toISOString() })
}

if (require.main === module) {
  main().catch((error) => {
    writeProgress({ state: 'error', error: String(error.message || error).slice(0, 300) })
    console.error('download failed:', error.message)
    process.exitCode = 2
  })
}
