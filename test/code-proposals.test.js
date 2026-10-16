'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const {
  buildSourceSnapshot,
  decideUpgradeProposal,
  makeConfig,
  parseOpenCodeOutput,
  redactAndValidateSource,
  validateCodeOnlyRequest
} = require('../assistant/code-proposals')

test('OpenCode proposal configuration denies all agent tools', () => {
  const config = JSON.parse(makeConfig('openai/example-model'))
  assert.equal(config.model, 'openai/example-model')
  assert.equal(config.small_model, config.model)
  assert.equal(config.agent['v8-code-proposal'].tools['*'], false)
  assert.equal(config.agent['v8-code-proposal'].permission['*'], 'deny')
})

test('source snapshot excludes environment and data files', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-source-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'data'))
  fs.mkdirSync(path.join(directory, 'node_modules'))
  fs.writeFileSync(path.join(directory, 'main.js'), 'module.exports = "safe"\n')
  fs.writeFileSync(path.join(directory, '.env'), 'MISTRAL_API_KEY=never-include-this-secret\n')
  fs.writeFileSync(path.join(directory, 'data', 'record.json'), '{"salary":1000}\n')
  fs.writeFileSync(path.join(directory, 'node_modules', 'package.js'), 'external dependency\n')

  const snapshot = buildSourceSnapshot(directory)
  assert.match(snapshot, /main\.js/)
  assert.doesNotMatch(snapshot, /never-include-this-secret|salary|package\.js/)
})

test('source snapshot fails closed on credential-shaped source', () => {
  assert.throws(
    () => redactAndValidateSource("const api_key = 'a-very-long-test-secret-value'"),
    /possible credential/
  )
})

test('upgrade requests reject obvious personal, payment, and credential data', () => {
  assert.equal(validateCodeOnlyRequest('Add a status card to the assistant dashboard'), 'Add a status card to the assistant dashboard')
  assert.throws(() => validateCodeOnlyRequest('Add this customer email: owner@example.test'), /appears to contain/)
  assert.throws(() => validateCodeOnlyRequest('Track a payment for $1200'), /appears to contain/)
  assert.throws(() => validateCodeOnlyRequest('الدفعة ١٢٠٠ جنيه'), /appears to contain/)
  assert.throws(() => validateCodeOnlyRequest('Use api_key=abc123secretvalue'), /appears to contain/)
})

test('OpenCode JSON events must contain a non-empty bounded assistant proposal', () => {
  const event = JSON.stringify({ type: 'text', part: { type: 'text', text: 'Review complete.' } })
  assert.equal(parseOpenCodeOutput(event), 'Review complete.')
  assert.throws(() => parseOpenCodeOutput('not json'), /malformed proposal output/)
  assert.throws(() => parseOpenCodeOutput(JSON.stringify({ type: 'step_start' })), /no proposal text/)
})

test('proposal decisions are single-use and record no automatic file changes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-proposal-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
  db.prepare(`INSERT INTO code_upgrade_proposals
    (id,requested_by,request,proposal,status,created_at)
    VALUES('upgrade_123e4567-e89b-12d3-a456-426614174000','owner-1','Add a feature','Suggested diff','pending',?)`)
    .run(timestamp)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  assert.deepEqual(decideUpgradeProposal({
    proposalId: 'upgrade_123e4567-e89b-12d3-a456-426614174000',
    userId: 'owner-1',
    decision: 'approved',
    db
  }), { id: 'upgrade_123e4567-e89b-12d3-a456-426614174000', status: 'approved' })
  assert.equal(db.prepare('SELECT status FROM code_upgrade_proposals').get().status, 'approved')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE action=?')
    .get('assistant.code_upgrade.approved').count, 1)
  assert.throws(() => decideUpgradeProposal({
    proposalId: 'upgrade_123e4567-e89b-12d3-a456-426614174000',
    userId: 'owner-1',
    decision: 'approved',
    db
  }), /already decided/)
})
