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

test('Model Center: route requires Owner and same-origin; server reads settings first', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'app', 'api', 'models', 'route.js'), 'utf8')
  assert.match(route, /requireSameOrigin/)
  assert.match(route, /requireRole\(request, 'Owner'\)/)
  const server = fs.readFileSync(path.join(__dirname, '..', 'assistant', 'local-model-server.js'), 'utf8')
  assert.match(server, /local_model_file/, 'the model service must take its model from dashboard settings first')
})
