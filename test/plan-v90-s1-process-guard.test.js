'use strict'

// upgradeplan v9.0 Card S1 — process guard contract tests.
// In-process suites use a temp-file database (fixture grade); the integration
// suite spawns the real fixture service to prove the process STAYS ALIVE when
// a timer throws and a promise rejects, with one incident row per occurrence.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { spawnSync } = require('node:child_process')

const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const guard = require('../lib/process-guard')
const { writeHeartbeat } = require('../lib/heartbeat')

function freshDb(dir) {
  const db = openDatabase(path.join(dir, 's1.db'))
  runMigrations(db)
  return db
}

test('S1: handlers registered once per service name; kind+message become the signature', () => {
  const apiA = guard.installProcessGuard({ serviceName: 's1-dup-test', db: null })
  const apiB = guard.installProcessGuard({ serviceName: 's1-dup-test', db: null })
  assert.equal(apiA, apiB)
  const api = guard.installProcessGuard({ serviceName: 's1-sig-test', db: null })
  assert.match(api.handle('unhandledRejection', new Error('boom')).signature, /^unhandledRejection\|Error\|boom$/)
})

test('S1: one incident row per occurrence + heartbeat census columns + storm breaker on the 6th', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's1-'))
  const db = freshDb(dir)
  try {
    writeHeartbeat('s1-storm', { db })
    const api = guard.installProcessGuard({ serviceName: 's1-storm', db })
    for (let i = 1; i <= 5; i++) {
      const res = api.handle('unhandledRejection', new Error('same boom'))
      assert.equal(res.count, i)
      assert.equal(res.storm, false)
      const rows = db.prepare('SELECT COUNT(*) AS c FROM service_incidents').get().c
      assert.equal(rows, i, 'exactly one incident row per occurrence')
    }
    // service_status census stays truthful along the way
    const before = db.prepare('SELECT incidents_1h, last_incident_at FROM service_status WHERE service = ?').get('s1-storm')
    assert.equal(before.incidents_1h, 5)
    assert.ok(before.last_incident_at)

    const sixth = api.handle('unhandledRejection', new Error('same boom'))
    assert.equal(sixth.storm, true, 'the 6th identical signature trips the breaker')
    const storms = db.prepare("SELECT COUNT(*) AS c FROM events WHERE kind='service_incident_storm'").get().c
    assert.equal(storms, 1, 'escalation is ONE events row per window, not per occurrence')
    const seventh = api.handle('unhandledRejection', new Error('same boom'))
    assert.equal(seventh.storm, false, 'repeats inside the window stay quiet')
    const status = db.prepare('SELECT incidents_1h FROM service_status WHERE service = ?').get('s1-storm')
    assert.equal(status.incidents_1h, 7)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('S1: fatal classes still exit — but after the incident row is committed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's1-fatal-'))
  const db = freshDb(dir)
  try {
    const exits = []
    const fixture = guard.installProcessGuard({
      serviceName: 's1-fatal', db, onFatalExit: (why) => { exits.push(why) }
    })
    // The guard policy: only real fatal classes exit; generic errors never do.
    assert.equal(fixture.handle('unhandledRejection', new Error('database disk image is malformed')).fatal, true)
    assert.equal(fixture.handle('uncaughtException', new Error('migration checksum mismatch')).fatal, true)
    assert.equal(fixture.handle('uncaughtException', new Error('just a hiccup')).fatal, false)
    assert.equal(exits.length, 2)
    const kinds = db.prepare('SELECT kind, COUNT(*) AS c FROM service_incidents GROUP BY kind').all()
    assert.equal(kinds.reduce((sum, k) => sum + k.c, 0), 3, 'fatal or not, one row per occurrence')
    void kinds
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('S1: signatures mask long digit runs and emails (no customer data in incidents)', () => {
  const sig = guard.signatureOf('uncaughtException', new Error('scan failed for 205971997 owner@example.com today'))
  assert.ok(!sig.includes('205971997'), 'long digit run masked')
  assert.ok(sig.includes('<997>'), 'last three digits kept')
  assert.ok(!sig.includes('owner@example.com'), 'email masked')
  assert.ok(sig.includes('<email>'), 'email token present')
})

test('S1: fixture service survives a timer throw + an unawaited rejection (integration)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's1-child-'))
  const dbPath = path.join(dir, 'fixture.db')
  const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 's1-fixture.cjs')], {
    env: { ...process.env, V8_DB_PATH: dbPath, V8_ROOT: path.join(__dirname, '..') },
    timeout: 15000,
    encoding: 'utf8'
  })
  try {
    assert.equal(result.status, 0, `fixture exited cleanly: ${result.stderr}`)
    const reportLine = (result.stdout || '').trim().split('\n').pop()
    const report = JSON.parse(reportLine)
    assert.equal(report.alive, true)
    assert.equal(report.rows, 2, 'exactly one incident row per occurrence (promise + timer)')
    assert.equal(report.incidents_1h, 2, 'heartbeat census columns updated')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
