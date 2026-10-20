'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { startMcpServer } = require('../mcp/server')

async function freePort() {
  const probe = net.createServer()
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = probe.address().port
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

test('MCP requires bearer auth, exposes only registered tools, and queues writes for approval', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-mcp-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
  const port = await freePort()
  const instance = await startMcpServer({ db, host: '127.0.0.1', port, token: 'test-secret-token', userId: 'owner-1' })
  let client
  let transport
  t.after(async () => {
    if (client) await client.close()
    if (instance) await instance.close()
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const url = new URL(`http://127.0.0.1:${port}/mcp`)
  const unauthenticatedTransport = new StreamableHTTPClientTransport(url)
  const unauthenticatedClient = new Client({ name: 'unauthorized-test', version: '1.0.0' })
  await assert.rejects(unauthenticatedClient.connect(unauthenticatedTransport))
  await unauthenticatedTransport.close()

  transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: 'Bearer test-secret-token' } }
  })
  client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(transport)
  const listed = await client.listTools()
  assert.equal(listed.tools.length, 11)
  assert.ok(listed.tools.some((tool) => tool.name === 'scan_now'))
  assert.ok(!listed.tools.some((tool) => tool.name === 'raw_sql'))

  const response = await client.callTool({
    name: 'save_note',
    arguments: { target_type: 'company', target_id: 'company-1', text: 'MCP request' }
  })
  const requested = JSON.parse(response.content[0].text)
  assert.equal(requested.confirmationRequired, true)
  assert.equal(db.prepare("SELECT state FROM assistant_confirmations WHERE id=?").get(requested.confirmationId).state, 'pending')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0)
})
