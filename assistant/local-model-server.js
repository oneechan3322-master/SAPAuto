'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const dotenv = require('dotenv')
const { localNovaUrl } = require('./model')

dotenv.config({ path: path.join(__dirname, '..', '.env') })

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
const serverScript = path.join(__dirname, 'local-model-server.py')
const uv = process.env.V8_UV_BIN ||
  path.join(process.env.USERPROFILE || '', '.local', 'bin', 'uv.exe')

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

const childEnv = {
  PATH: process.env.PATH || '',
  SystemRoot: process.env.SystemRoot || '',
  WINDIR: process.env.WINDIR || '',
  ComSpec: process.env.ComSpec || '',
  PATHEXT: process.env.PATHEXT || '',
  USERPROFILE: process.env.USERPROFILE || '',
  APPDATA: process.env.APPDATA || '',
  LOCALAPPDATA: process.env.LOCALAPPDATA || '',
  TEMP: process.env.TEMP || '',
  TMP: process.env.TMP || '',
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  V8_LOCAL_AI_HOST: '127.0.0.1',
  V8_LOCAL_AI_PORT: port,
  V8_LOCAL_MODEL_FILE: modelFile,
  V8_LOCAL_AI_TOKEN: process.env.V8_LOCAL_AI_TOKEN || ''
}

const args = [
  'run', '--no-project', '--python', '3.13',
  '--with', 'llama-cpp-python==0.3.36',
  '--extra-index-url', 'https://abetlen.github.io/llama-cpp-python/whl/cpu',
  'python', serverScript
]
const service = spawn(uv, args, { cwd: root, env: childEnv, windowsHide: true, stdio: 'inherit' })
let stopping = false

function stop() {
  if (stopping) return
  stopping = true
  if (!service.killed) service.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
service.on('error', (error) => {
  console.error(`Could not start local model runtime (${error.code || error.name})`)
  process.exitCode = 1
})
service.on('exit', (code, signal) => {
  if (!stopping) {
    if (code !== 0) console.error(`Local Gemma service exited with code ${code ?? signal}`)
    process.exitCode = code || 1
  }
})
