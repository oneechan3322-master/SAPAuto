'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-channels-api-'))
const previousRoot = process.env.V8_ROOT
const previousDatabasePath = process.env.V8_DB_PATH
process.env.V8_ROOT = path.resolve(__dirname, '..')
process.env.V8_DB_PATH = path.join(directory, 'channels.db')

test.after(() => {
  const { getDatabase } = require('../db/connect')
  const database = getDatabase()
  if (database.open) database.close()
  if (previousDatabasePath === undefined) delete process.env.V8_DB_PATH
  else process.env.V8_DB_PATH = previousDatabasePath
  if (previousRoot === undefined) delete process.env.V8_ROOT
  else process.env.V8_ROOT = previousRoot
  fs.rmSync(directory, { recursive: true, force: true })
})

function mutationRequest(body, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/channels', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

test('channel connection rejects cross-origin requests before handling credentials', async () => {
  const { POST } = await import('../launcher/app/api/channels/route.js')
  const response = await POST(mutationRequest(
    { channel: 'gmail', email: 'test@example.com', password: 'not-a-real-secret' },
    'https://example.com'
  ))
  assert.equal(response.status, 403)
})

test('channel connection requires an authenticated owner before processing credentials', async () => {
  const { POST } = await import('../launcher/app/api/channels/route.js')
  const gmail = await POST(mutationRequest({
    channel: 'gmail',
    email: 'not-an-email',
    password: 'too-short'
  }))
  const telegram = await POST(mutationRequest({ channel: 'telegram', token: 'invalid-token' }))
  assert.equal(gmail.status, 401)
  assert.equal(telegram.status, 401)
})
