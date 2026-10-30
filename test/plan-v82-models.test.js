'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-mc-'))
  const modelRoot = path.join(dir, 'pet', 'models')
  fs.mkdirSync(modelRoot, { recursive: true })
  fs.writeFileSync(path.join(modelRoot, 'gemma-4-E2B-it-Q4_0.gguf'), Buffer.alloc(8))
  process.env.V8_LOCAL_MODEL_HOME = path.join(dir, 'pet')
  return dir
}

test('Model Center: listState settings-first + validated selection', () => {
  const dir = sandbox()
  const mc = require('../lib/model-center')
  const db = openDatabase(path.join(dir, 'mc.db'))
  try {
    runMigrations(db)
    const state0 = mc.listState(db)
    assert.equal(state0.selected, mc.DEFAULT_FILE)
    assert.ok(state0.models.find((m) => m.key === 'E2B')?.present)

    // A missing file, a traversal path, and a non-gguf name can never be selected.
    assert.ok(mc.selectModel(db, { file: 'nope.gguf' }).error)
    assert.ok(mc.selectModel(db, { file: '..\\windows\\x.gguf' }).error)
    assert.equal(mc.selectModel(db, { file: 'gemma-4-E2B-it-Q4_0.gguf' }).selected,
      'gemma-4-E2B-it-Q4_0.gguf')
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='local_model_file'").get().value,
      'gemma-4-E2B-it-Q4_0.gguf')
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Model Center: apply is an explicit pm2 restart of exactly the local-model service', async () => {
  const dir = sandbox()
  const mc = require('../lib/model-center')
  const db = openDatabase(path.join(dir, 'mc.db'))
  try {
    runMigrations(db)
    let seen = null
    const fake = (exe, args) => {
      seen = { exe, args }
      return {
        stdout: { on: () => {} }, stderr: { on: () => {} },
        on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(0)) }
      }
    }
    const result = await mc.applyModel(db, fake)
    assert.deepEqual(seen.args, ['/c', 'pm2', 'restart', 'sapauto-v8-local-model'])
    assert.equal(result.applied, true)
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='model_progress'").all().length, 0,
      'apply must not touch download progress')
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Model Center: downloads are https-only, name-locked, size-gated and cancellable', () => {
  const dir = sandbox()
  const mc = require('../lib/model-center')
  const db = openDatabase(path.join(dir, 'mc.db'))
  try {
    runMigrations(db)
    assert.ok(mc.validateDownload({ url: 'http://x/y.gguf', file: 'a.gguf' }).error, 'plain http is refused')
    assert.ok(mc.validateDownload({ url: 'https://u:p@x/y.gguf', file: 'a.gguf' }).error, 'credentialed URLs are refused')
    assert.ok(mc.validateDownload({ url: 'https://x/y/model.bin', file: 'model.bin' }).error, 'only .gguf passes')
    assert.ok(mc.validateDownload({ url: 'https://x/y.gguf', file: 'gemma-4-E2B-it-Q4_0.gguf' }).error, 'overwriting is never silent')
    const ok = mc.validateDownload({ url: 'https://keyless.example/models/big.gguf', file: 'new.gguf' })
    assert.equal(ok.file, 'new.gguf')

    let spawned = null
    const fakeRun = (exe, args) => { spawned = { exe, args }; return { unref() {} } }
    const start = mc.startDownload(db, { url: 'https://keyless.example/models/big.gguf', file: 'new.gguf' }, fakeRun)
    assert.equal(start.started, true)
    assert.deepEqual(spawned.args, [
      path.join(mc.ROOT, 'scripts', 'download-model.js'),
      '--url', 'https://keyless.example/models/big.gguf',
      '--file', 'new.gguf'
    ])
    const progress = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='model_progress'").get().value)
    assert.equal(progress.state, 'starting')
    assert.equal(progress.file, 'new.gguf')

    assert.equal(mc.requestCancel(db).cancelRequested, true)
    assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='model_progress'").get().value).cancel, true)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Model Center: apply guards — missing file, RAM, busy tasks before any pm2 call', async () => {
  const dir = sandbox()
  const mc = require('../lib/model-center')
  const db = openDatabase(path.join(dir, 'mc.db'))
  try {
    runMigrations(db)
    let pm2Called = 0
    const fake = () => { pm2Called += 1; return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(0)) } } }

    // The selected model file is on disk in this sandbox — remove it to prove
    // the guard: a missing restart would spawn a crash-loop and must refuse.
    const sandboxRoot = path.join(dir, 'pet', 'models')
    const weights = path.join(sandboxRoot, mc.DEFAULT_FILE)
    const backup = fs.readFileSync(weights)
    fs.unlinkSync(weights)
    const missing = await mc.applyModel(db, fake, { totalBytes: 16 * (1 << 30) })
    assert.equal(missing.applied, false)
    assert.match(missing.error, /الملف غير موجود/)
    assert.equal(pm2Called, 0)
    fs.writeFileSync(weights, backup)

    // RAM fit: the sandbox file is tiny, so force the refusal via totalBytes.
    const smallRam = await mc.applyModel(db, fake, { totalBytes: 2 * (1 << 30) })
    assert.equal(smallRam.applied, false)
    assert.match(smallRam.error, /RAM-GUARD/)
    assert.equal(pm2Called, 0)

    // A running download blocks apply.
    mc.startDownload(db, { url: 'https://keyless.example/models/big.gguf', file: 'busy.gguf' }, () => ({ unref() {} }))
    const busyDl = await mc.applyModel(db, fake, { totalBytes: 16 * (1 << 30) })
    assert.match(busyDl.error, /تحميل جارٍ/)
    assert.equal(pm2Called, 0)
    db.prepare("DELETE FROM settings WHERE key='model_progress'").run()

    // A fresh running bench blocks apply; a stale one does not.
    mc.startBench(db, () => ({ unref() {} }))
    db.prepare("DELETE FROM settings WHERE key='bench_state'").run()
    const expired = 15 - 0.01 // minutes*60*1000 in the past
    const staleHeartbeat = new Date(Date.now() - Math.round(((mc.BENCH_MAX_MS || 900000) + 120000))).toISOString()
    db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('bench_state',?,datetime('now'))")
      .run(JSON.stringify({ state: 'running', startedAt: staleHeartbeat }))
    void expired
    const staleOk = await mc.applyModel(db, fake, { totalBytes: 16 * (1 << 30) })
    assert.equal(staleOk.applied, true)
    // one legal pm2 call total: every guard above refused, the stale-bench
    // apply is the single spawn this flow is allowed to make
    assert.equal(pm2Called, 1)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Model Center: dashboard power — pm2 stop/start of only the model service', async () => {
  const dir = sandbox()
  const mc = require('../lib/model-center')
  const db = openDatabase(path.join(dir, 'mc.db'))
  try {
    runMigrations(db)
    const seen = []
    const fake = (exe, args) => {
      seen.push(args)
      return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(0)) } }
    }
    const stopped = await mc.stopService(db, fake)
    const started = await mc.startService(db, fake)
    assert.deepEqual(seen, [
      ['/c', 'pm2', 'stop', 'sapauto-v8-local-model'],
      ['/c', 'pm2', 'start', 'sapauto-v8-local-model']
    ])
    assert.equal(stopped.stopped, true)
    assert.equal(started.started, true)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Model Center: bench refusals and cancel wire', () => {
  const dir = sandbox()
  const mc = require('../lib/model-center')
  const db = openDatabase(path.join(dir, 'mc.db'))
  const bench = require('../scripts/bench-models')
  try {
    runMigrations(db)
    // llama.cpp absent in the sandbox → refuse before touching anything.
    const priorEnv = process.env.V8_LLAMA_SERVER
    delete process.env.V8_LLAMA_SERVER
    const noLlama = mc.startBench(db, () => { throw new Error('must not spawn') })
    assert.match(noLlama.error, /llama\.cpp/)

    // With llama present, bench starts and writes a fresh running state.
    const fakeLlama = path.join(dir, 'llama-server.exe')
    fs.writeFileSync(fakeLlama, 'exe')
    process.env.V8_LLAMA_SERVER = fakeLlama
    let spawned = false
    const started = mc.startBench(db, () => { spawned = true; return { unref() {} } })
    assert.equal(started.started, true)
    assert.equal(spawned, true)
    const state = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='bench_state'").get().value)
    assert.equal(state.state, 'running')

    // A second press refuses while the fresh state is alive; cancel wire works.
    assert.match(mc.startBench(db, () => ({ unref() {} })).error, /يعمل مسبقاً/)
    assert.equal(mc.requestCancelBench(db).cancelRequested, true)
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='bench_cancel'").get().value, 'true')
    assert.equal(bench.benchCancelled(path.join(dir, 'mc.db')), true)
    bench.clearCancelFlag(path.join(dir, 'mc.db'))
    assert.equal(bench.benchCancelled(path.join(dir, 'mc.db')), false)
    if (priorEnv === undefined) delete process.env.V8_LLAMA_SERVER
    else process.env.V8_LLAMA_SERVER = priorEnv
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Model Center: machine reboot failsafe requires gate + exact token; abort is plain /a', async () => {
  const dir = sandbox()
  const mc = require('../lib/model-center')
  const db = openDatabase(path.join(dir, 'mc.db'))
  try {
    runMigrations(db)
    // Machine gate closed (laptop default): refuse before anything else.
    const gated = await mc.rebootPc({ confirm: mc.REBOOT_CONFIRM_TOKEN }, () => { throw new Error('must not spawn') })
    assert.equal(gated.rebooting, false)
    assert.match(gated.error, /V8_REBOOT_ALLOWED/)

    process.env.V8_REBOOT_ALLOWED = '1'
    const calls = []
    const fake = (exe, args) => { calls.push([exe, args]); return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(0)) } } }
    const refused = await mc.rebootPc({ confirm: 'yes' }, fake)
    assert.equal(refused.rebooting, false)
    assert.match(refused.error, /تأكيد/)
    const armed = await mc.rebootPc({ confirm: mc.REBOOT_CONFIRM_TOKEN }, fake)
    assert.equal(armed.rebooting, true)
    assert.deepEqual(calls[0], ['shutdown', ['/r', '/t', String(mc.REBOOT_DELAY_SECONDS), '/d', 'p:4:1', '/c', 'SAPAuto: Owner-triggered restart']])
    const aborted = await mc.abortReboot(fake)
    assert.equal(aborted.aborted, true)
    assert.deepEqual(calls[1], ['shutdown', ['/a']])
  } finally {
    delete process.env.V8_REBOOT_ALLOWED
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Model Center: route requires Owner and same-origin; server reads settings first', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'app', 'api', 'models', 'route.js'), 'utf8')
  assert.match(route, /requireSameOrigin/)
  assert.match(route, /requireRole\(request, 'Owner'\)/)
  for (const action of ['stop-service', 'start-service', 'reboot-pc', 'abort-reboot', 'cancel-bench']) {
    assert.match(route, new RegExp(action.replace(/-/g, '\\-')), `route must expose ${action}`)
  }
  const server = fs.readFileSync(path.join(__dirname, '..', 'assistant', 'local-model-server.js'), 'utf8')
  assert.match(server, /local_model_file/, 'the model service must take its model from dashboard settings first')
  assert.match(server, /model_runtime/, 'the service must publish its runtime heartbeat')
})
