'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')

test('first-run setup creates the sole owner and establishes a session', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-owner-'))
  const databasePath = path.join(directory, 'owner-test.db')
  const previousRoot = process.env.V8_ROOT
  const previousDatabasePath = process.env.V8_DB_PATH
  process.env.V8_ROOT = path.resolve(__dirname, '..')
  process.env.V8_DB_PATH = databasePath
  const fixture = openDatabase(databasePath)
  t.after(() => {
    const { getDatabase } = require('../db/connect')
    const database = getDatabase()
    if (database.open) database.close()
    if (previousDatabasePath === undefined) delete process.env.V8_DB_PATH
    else process.env.V8_DB_PATH = previousDatabasePath
    if (previousRoot === undefined) delete process.env.V8_ROOT
    else process.env.V8_ROOT = previousRoot
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const { runMigrations } = require('../db/migrate')
  runMigrations(fixture)
  fixture.close()

  const { GET, POST } = await import('../launcher/app/api/setup/route.js')
  assert.deepEqual(await (await GET()).json(), { setupRequired: true })
  const { requireRole } = await import('../launcher/lib/guard.js')
  const unauthenticated = await requireRole(new Request('http://localhost:3000/api/status', {
    headers: { host: 'localhost:3000' }
  }), 'Viewer')
  assert.equal(unauthenticated.response.status, 401)
  const request = new Request('http://localhost:3000/api/setup', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Office Owner',
      email: 'owner@example.test',
      password: 'Owner-Password-123!'
    })
  })
  const response = await POST(request)
  assert.equal(response.status, 201)
  const sessionCookies = response.headers.getSetCookie()
  assert.ok(sessionCookies.some((cookie) => /session_token/i.test(cookie)))
  const cookieHeader = sessionCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ')
  const session = await requireRole(new Request('http://localhost:3000/api/status', {
    headers: { host: 'localhost:3000', cookie: cookieHeader }
  }), 'Owner')
  assert.equal(session.session.user.role, 'Owner')
  const { getDatabase } = require('../db/connect')
  const user = getDatabase().prepare('SELECT role FROM users WHERE email=?').get('owner@example.test')
  assert.equal(user.role, 'Owner')
  assert.deepEqual(await (await GET()).json(), { setupRequired: false })

  const secondOwner = await POST(new Request('http://localhost:3000/api/setup', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Second Owner',
      email: 'second@example.test',
      password: 'Second-Password-123!'
    })
  }))
  assert.equal(secondOwner.status, 409)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM users').get().count, 1)
})
