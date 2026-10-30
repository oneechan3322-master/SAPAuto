'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const dotenv = require('dotenv')
const { localNovaUrl } = require('./model')

dotenv.config({ path: path.join(__dirname, '..', '.env') })
// Guard goes first, before any exit branch can take the service down silently.
const { installProcessGuard } = require('../lib/process-guard')
installProcessGuard({ serviceName: 'local-model' })

const provider = (process.env.AI_PROVIDER || 'gemma4').toLowerCase()
if (provider !== 'gemma4') {
  console.log(`Local Gemma service is disabled for AI_PROVIDER=${provider}`)
  process.exit(0)
}

const root = path.resolve(__dirname, '..')
const modelStorage = path.resolve(root, process.env.V8_LOCAL_MODEL_HOME || '../pet')
// Model Center (v8.2): the dashboard's selection lives in the DB settings —
// settings-first, env fallback. A "switch + apply" from the dashboard restarts
// this service with the chosen weights without any terminal touching.
let modelFile
try {
  const { getDatabase } = require('../db/connect')
  const selected = getDatabase().prepare("SELECT value FROM settings WHERE key='local_model_file'").get()?.value
  const candidate = selected ? path.join(modelStorage, 'models', selected) : null
  if (candidate && fs.existsSync(candidate)) modelFile = candidate
} catch { /* DB not reachable: fall through to the built-in default */ }
if (!modelFile) modelFile = path.join(modelStorage, 'models', 'gemma-4-E2B-it-Q4_0.gguf')

if (!fs.existsSync(modelFile)) {
  console.error(`Local Gemma weights were not found at ${modelFile}`)
  process.exit(1)
}

let port
try { port = new URL(localNovaUrl()).port || '7799' }
catch (error) {
  console.error(error.message)
  process.exit(1)
}

// Native llama.cpp runtime (v8.2 Track A: remove Python entirely). The Windows
// CPU build was installed with the Owner's OK at ..\llama\; the same candidate
// order as scripts/bench-models.js keeps one source of truth:
function resolveLlamaServer() {
  const candidates = [
    process.env.V8_LLAMA_SERVER || '',
    path.join(root, 'llama-server.exe'),
    path.join(root, '..', 'llama', 'llama-server.exe')
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

const serverExe = resolveLlamaServer()
if (!serverExe) {
  console.error('llama-server.exe was not found (looked in project root, ..\\llama\\ and V8_LLAMA_SERVER)')
  process.exit(1)
}

const args = [
  '-m', modelFile,
  '--host', '127.0.0.1',
  '--port', String(port),
  // The python era served llama-cpp defaults; 8192 + jinja keeps the Gemma chat
  // template parity the assistant expects on /v1/chat/completions.
  '-c', '8192',
  '--jinja',
  // Gemma-4 ships a thinking phase that first drains tokens into
  // reasoning_content and only then answers. At ~10 tok/s on this CPU every
  // scan would pay for thinking it never asked for; budget 0 runs it direct.
  '--reasoning-budget', '0',
  // Senior weights stay resident — the RAM guard was measured in the bench and
  // a paged-out 26B would stall every scan on this box.
  '--load-mode', 'mlock'
]
const token = process.env.V8_LOCAL_AI_TOKEN || ''
if (token) args.push('--api-key', token)

const service = spawn(serverExe, args, { cwd: root, windowsHide: true, stdio: 'inherit' })
let stopping = false

// Model Center contract (test/plan-v82-models): the launcher's listState() reads
// the settings key model_runtime and marks it stale after 45 s — this service is
// its producer. Write it through whatever DB opens; a closed gate or busy WAL
// degrades to a stale badge, never to a crash.
const RUNTIME_FRESH_MS = 45 * 1000
const RUNTIME_TICK_MS = 30 * 1000 // stay inside the consumer's 45 s freshness window
function publishRuntime(status) {
  try {
    const { getDatabase } = require('../db/connect')
    getDatabase().prepare(`INSERT INTO settings(key,value,updated_at) VALUES('model_runtime',?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(JSON.stringify({ ts: new Date().toISOString(), status, pid: process.pid, model: path.basename(modelFile) }))
  } catch { /* truth contract: stale badge is acceptable, a crashed service is not */ }
}
publishRuntime('starting')
const runtimeTimer = setInterval(() => {
  if (!stopping) publishRuntime(service.killed ? 'stopped' : 'running')
}, RUNTIME_TICK_MS)
runtimeTimer.unref?.()

function stop() {
  if (stopping) return
  stopping = true
  clearInterval(runtimeTimer)
  publishRuntime('stopping')
  if (!service.killed) service.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
service.on('error', (error) => {
  console.error(`Could not start llama-server (${error.code || error.name})`)
  process.exitCode = 1
})
service.on('exit', (code, signal) => {
  if (!stopping) {
    if (code !== 0) console.error(`Local Gemma service exited with code ${code ?? signal}`)
    process.exitCode = code || 1
  }
})
