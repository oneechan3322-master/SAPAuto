'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const model = require('../assistant/model')
const { getDatabase, openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')

test('assistant only offers OpenCode proposals to Owners after explicit enablement', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-assistant-proposal-'))
  const databasePath = path.join(directory, 'test.db')
  const binaryPath = path.join(directory, 'opencode.exe')
  const authPath = path.join(directory, 'auth.json')
  fs.writeFileSync(binaryPath, '')
  fs.writeFileSync(authPath, '{}')
  const envKeys = ['V8_DB_PATH', 'OPENCODE_BIN', 'V8_OPENCODE_AUTH_FILE', 'V8_OPENCODE_MODEL']
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  const previousChat = model.chat
  const runPath = require.resolve('../assistant/run')
  process.env.V8_DB_PATH = databasePath
  process.env.OPENCODE_BIN = binaryPath
  process.env.V8_OPENCODE_AUTH_FILE = authPath
  process.env.V8_OPENCODE_MODEL = 'openai/synthetic-model'
  const db = openDatabase(databasePath)
  runMigrations(db)
  const timestamp = new Date().toISOString()
  const insertUser = db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES(?,?,?,?,?,?)`)
  insertUser.run('owner-1', 'Owner', 'owner@example.test', timestamp, timestamp, 'Owner')
  insertUser.run('viewer-1', 'Viewer', 'viewer@example.test', timestamp, timestamp, 'Viewer')
  db.prepare("UPDATE settings SET value='false',updated_at=? WHERE key='opencode_proposals_enabled'").run(timestamp)
  const offeredTools = []
  model.chat = async (_messages, tools) => {
    const names = tools.map((tool) => tool.function.name)
    offeredTools.push(names)
    if (names.includes('request_code_upgrade')) {
      return {
        content: '',
        toolCalls: [{
          id: 'upgrade-call',
          type: 'function',
          function: { name: 'request_code_upgrade', arguments: '{"request":"Add a status card"}' }
        }]
      }
    }
    return { content: 'ready', toolCalls: [] }
  }
  delete require.cache[runPath]
  const { runAssistant } = require('../assistant/run')

  t.after(() => {
    getDatabase().close()
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
    model.chat = previousChat
    delete require.cache[runPath]
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  await runAssistant({ userId: 'owner-1', role: 'Owner', text: 'Add a code feature' })
  assert.equal(offeredTools[0].includes('request_code_upgrade'), false)
  db.prepare("UPDATE settings SET value='true' WHERE key='opencode_proposals_enabled'").run()
  const upgrade = await runAssistant({ userId: 'owner-1', role: 'Owner', text: 'Add a code feature' })
  assert.equal(offeredTools[1].includes('request_code_upgrade'), true)
  assert.equal(offeredTools[2].length, 0)
  assert.deepEqual(upgrade.pendingConfirmations.map((item) => item.toolName), ['request_code_upgrade'])
  assert.equal(db.prepare("SELECT state FROM assistant_confirmations WHERE tool_name='request_code_upgrade'").get().state, 'pending')

  await runAssistant({ userId: 'viewer-1', role: 'Viewer', text: 'Add a code feature' })
  assert.equal(offeredTools[3].includes('request_code_upgrade'), false)
})
