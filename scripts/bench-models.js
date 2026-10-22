// scripts/bench-models.js - Track L, task L0.2 (v8.2 plan §D.5)
// Benchmarks GGUF models through llama-server at several thread counts and
// records prompt / generation tok-s into `model_benchmarks`.
//
// Safety rules (plan §0 + L0.1):
// - refuses to load a model whose weights do not fit the machine's free RAM
//   with headroom (no Windows swapping, no crash), printing an Arabic fix-it
//   hint before exiting cleanly
// - reports cleanly when llama-server.exe is not installed yet (Track L1)
//
// Usage:
//   node scripts/bench-models.js                    # all found models, 8/12/14 threads
//   node scripts/bench-models.js --models E2B --threads 8,12
//   node scripts/bench-models.js --llama C:\path\llama-server.exe
// Exit codes: 0 ran (or nothing available), 1 usage error, 2 refused/RAM guard.
'use strict'

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const MODEL_HOME = process.env.V8_LOCAL_MODEL_HOME
  ? path.resolve(ROOT, process.env.V8_LOCAL_MODEL_HOME)
  : path.resolve(ROOT, '..', 'pet', 'models')
const DEFAULT_BENCH_DB = path.join(ROOT, 'data', 'sapauto.db')

// The exact files known to models.json candidates (D.1). Key = profile tag.
const KNOWN_MODELS = {
  E2B: 'gemma-4-E2B-it-Q4_0.gguf',
  E4B: 'gemma-4-E4B_q4_0-it.gguf'
}

// Weights must fit in free RAM 1.15x over (mmap read-ahead), plus KV cache and
// a 1.5 GB headroom so the 8 live services keep breathing during the bench.
const KV_GB_PER_1K_TOKENS = 0.00018 // Gemma-4-A4B class at Q4_0, measured order of magnitude
const HEADROOM_GB = 1.5

function parseArgs(argv = process.argv.slice(2)) {
  const out = { models: null, threads: [8, 12, 14], context: 4096, llama: process.env.V8_LLAMA_SERVER || null, db: process.env.V8_DB_PATH || DEFAULT_BENCH_DB }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--models') out.models = String(argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (key === '--threads') out.threads = String(argv[i + 1] || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0 && n <= 64)
    else if (key === '--context') out.context = parseInt(argv[i + 1], 10) || out.context
    else if (key === '--llama') out.llama = String(argv[i + 1] || '')
    else if (key === '--db') out.db = String(argv[i + 1] || '')
    else return null
    i += 1
  }
  return out
}

function estimateNeededGB(weightsGB, contextTokens) {
  const weights = weightsGB * 1.15
  const kv = (contextTokens / 1000) * KV_GB_PER_1K_TOKENS
  return weights + kv + HEADROOM_GB
}

function ramRefusal(modelName, weightsGB, contextTokens, freeBytes) {
  const need = estimateNeededGB(weightsGB, contextTokens)
  const free = freeBytes / (1024 * 1024 * 1024)
  if (free >= need) return null
  return `[RAM-GUARD] ${modelName} يحتاج ~${need.toFixed(1)} جيجابايت حرة والجهاز فيه ${free.toFixed(1)} فقط. أغلق البرامج غير الضرورية أو أضف الذاكرة (الشق الفارغ الأول)، ثم أعد المحاولة.`
}

function resolveLlamaServer(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit
  const candidates = [
    path.join(ROOT, 'llama-server.exe'),
    path.join(ROOT, '..', 'llama', 'llama-server.exe'),
    path.join(ROOT, 'bin', 'llama-server.exe')
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

function discoverModels(wanted) {
  const found = []
  for (const [profile, file] of Object.entries(KNOWN_MODELS)) {
    if (wanted && !wanted.includes(profile)) continue
    const full = path.join(MODEL_HOME, file)
    if (fs.existsSync(full)) {
      found.push({ profile, file, full, weightsGB: fs.statSync(full).size / (1024 * 1024 * 1024) })
    }
  }
  return found
}

async function healthProbe(port, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function timedCompletion(port, nPrompt = 256, nGen = 32) {
  const prompt = 'نص للتقييم والقياس. '.repeat(Math.ceil(nPrompt / 4))
  const res = await fetch(`http://127.0.0.1:${port}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, n_predict: nGen, cache_prompt: true, samplers: [] })
  })
  if (!res.ok) throw new Error(`completion status ${res.status}`)
  const body = res.json()
  const t = body.timings || {}
  return {
    n_prompt: t.prompt_n || 0,
    prompt_tok_per_s: t.prompt_per_second || 0,
    n_gen: t.predicted_n || 0,
    gen_tok_per_s: t.predicted_per_second || 0
  }
}

function recordBenchmark(dbPath, row) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)
  try {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='model_benchmarks'`).get()
    if (!exists) return { recorded: false, reason: 'model_benchmarks table missing — run migrations first' }
    const id = `bench:${row.model}:${row.threads}:${row.measured_at}`
    db.prepare(`INSERT INTO model_benchmarks(id,model,profile,threads,context_tokens,n_prompt,prompt_tok_per_s,n_gen,gen_tok_per_s,observed_rss_mb,measured_at,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, row.model, row.profile, row.threads, row.context, row.n_prompt, row.prompt_tok_per_s,
        row.n_gen, row.gen_tok_per_s, row.observed_rss_mb, row.measured_at, row.notes || '')
    return { recorded: true }
  } finally {
    db.close()
  }
}

async function benchmarkOne(server, model, threads, context, port, dbPath, log) {
  log(`\n[bench] ${model.profile} (${model.weightsGB.toFixed(2)} GB) threads=${threads} context=${context}`)
  // One server per thread configuration, torn down before the next (D.3 rule):
  const child = spawn(server, ['-m', model.full, '-c', String(context), '-t', String(threads), '--port', String(port), '--no-mmap'], { stdio: 'ignore' })
  try {
    const ready = await healthProbe(port, 60000)
    if (!ready) throw new Error('llama-server did not become healthy in 60s')
    // warm-up run (loads weights + builds prompt cache)
    await timedCompletion(port).catch(() => {})
    const runs = []
    for (let i = 0; i < 3; i += 1) runs.push(await timedCompletion(port))
    const avg = (key) => runs.reduce((a, r) => a + (r[key] || 0), 0) / runs.length
    const row = {
      model: path.basename(model.full), profile: model.profile, threads, context,
      n_prompt: Math.round(avg('n_prompt')), prompt_tok_per_s: Number(avg('prompt_tok_per_s').toFixed(2)),
      n_gen: Math.round(avg('n_gen')), gen_tok_per_s: Number(avg('gen_tok_per_s').toFixed(2)),
      observed_rss_mb: 0, measured_at: new Date().toISOString(),
      notes: 'llama-server bench, 3-run average after warm-up'
    }
    const result = recordBenchmark(dbPath, row)
    log(result.recorded
      ? `[bench]   → prompt ${row.prompt_tok_per_s} tok/s · gen ${row.gen_tok_per_s} tok/s · saved`
      : `[bench]   → NOT SAVED: ${result.reason}`)
    return result
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 800))
  }
}

async function main() {
  const log = (...a) => console.log(...a)
  const args = parseArgs()
  if (!args) {
    log('usage: node scripts/bench-models.js [--models E2B,E4B] [--threads 8,12,14] [--context 4096] [--llama path] [--db path]')
    return 1
  }
  const server = resolveLlamaServer(args.llama)
  if (!server) {
    log('[skip] llama-server.exe not found yet (Track L1 installs it).')
    log('       Set V8_LLAMA_SERVER or place the binary at llama-server.exe in the project root, then re-run.')
    return 0
  }
  const freeBytes = os.freemem()
  const models = discoverModels(args.models)
  if (models.length === 0) {
    log(`[skip] no requested models found under ${MODEL_HOME} (looked for: ${Object.values(KNOWN_MODELS).join(', ')})`)
    return 0
  }
  for (const model of models) {
    const refusal = ramRefusal(model.profile, model.weightsGB, args.context, freeBytes)
    if (refusal) { log(refusal); return 2 }
  }
  let port = 7831
  for (const model of models) {
    for (const threads of args.threads) {
      await benchmarkOne(server, model, threads, args.context, port, args.db, log)
    }
  }
  return 0
}

if (require.main === module) {
  main().then((code) => { if (code) process.exitCode = code }).catch((error) => {
    console.error('[bench] failed:', error.message)
    process.exitCode = 1
  })
}

module.exports = { estimateNeededGB, ramRefusal, resolveLlamaServer, discoverModels, parseArgs, recordBenchmark, KV_GB_PER_1K_TOKENS, HEADROOM_GB }
