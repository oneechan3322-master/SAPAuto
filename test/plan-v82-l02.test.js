'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const bench = require('../scripts/bench-models')

const GB = 1024 * 1024 * 1024

test('L0.2: RAM guard refuses loads that would swap and accepts fits', () => {
  // E2B = 2.65 GB weights; 4096 ctx; free 2.8 GB → must refuse (the L0.1 reality).
  const refuseLow = bench.ramRefusal('E2B', 2.65, 4096, 2.8 * GB)
  assert.match(refuseLow, /RAM-GUARD/)
  assert.match(refuseLow, /أعد المحاولة/) // Arabic fix-it hint
  // E2B at 10 GB free (the Xeon profile story) → fits, no refusal.
  assert.equal(bench.ramRefusal('E2B', 2.65, 4096, 10 * GB), null)
  // Guard numbers follow the formula: 1.15x weights + kv + headroom.
  const need = bench.estimateNeededGB(2.65, 4096)
  assert.ok(need > 2.65 * 1.15 && need < 2.65 * 1.15 + 2.2)
})

test('L0.2: llama-server resolution falls back to project-root candidates', () => {
  // No llama-server.exe installed yet (Track L1) → explicit missing path must
  // resolve to null via candidate scan, keeping the run a clean [skip].
  assert.ok(!bench.resolveLlamaServer(path.join(os.tmpdir(), 'nope-llama.exe')))
})

test('L0.2: model migration lands and benchmark rows record', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-bench-'))
  const dbPath = path.join(directory, 'bench.db')
  const previousRoot = process.env.V8_ROOT
  process.env.V8_ROOT = path.resolve(__dirname, '..')
  const fixture = require('../db/connect').openDatabase(dbPath)
  try {
    const { runMigrations } = require('../db/migrate')
    runMigrations(fixture)
    const table = fixture.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='model_benchmarks'`).get()
    assert.ok(table, '034_model_benchmarks must create the table')
    const result = bench.recordBenchmark(dbPath, {
      model: 'gemma-4-E2B-it-Q4_0.gguf', profile: 'E2B', threads: 8, context: 4096,
      n_prompt: 252, prompt_tok_per_s: 51.2, n_gen: 32, gen_tok_per_s: 6.4,
      observed_rss_mb: 2900, measured_at: new Date().toISOString(), notes: 'test'
    })
    assert.equal(result.recorded, true)
    const row = fixture.prepare('SELECT * FROM model_benchmarks WHERE model=?').get('gemma-4-E2B-it-Q4_0.gguf')
    assert.equal(row.threads, 8)
    assert.equal(row.prompt_tok_per_s, 51.2)
  } finally {
    fixture.close()
    if (previousRoot === undefined) delete process.env.V8_ROOT
    else process.env.V8_ROOT = previousRoot
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('L0.2: discovery finds the downloaded GGUFs where present', () => {
  const models = bench.discoverModels()
  const e2b = models.find((m) => m.profile === 'E2B')
  if (e2b) {
    assert.ok(e2b.weightsGB > 2 && e2b.weightsGB < 4, `E2B weights look wrong: ${e2b.weightsGB}`)
  }
  const e4b = models.find((m) => m.profile === 'E4B')
  if (e4b) {
    assert.ok(e4b.weightsGB > 3.5 && e4b.weightsGB < 6, `E4B weights look wrong: ${e4b.weightsGB}`)
  }
})
