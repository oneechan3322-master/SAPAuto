'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { createAuthenticatedCookie } = require('./helpers/auth-session.cjs')

test('company identity updates return conflicts honestly and allow explicit resolution by matching the portal', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-company-identity-route-'))
  const databasePath = path.join(directory, 'company-identity-route.db')
  const previousRoot = process.env.V8_ROOT
  const previousDatabasePath = process.env.V8_DB_PATH
  process.env.V8_ROOT = path.resolve(__dirname, '..')
  process.env.V8_DB_PATH = databasePath
  const fixture = openDatabase(databasePath)
  runMigrations(fixture)
  fixture.prepare(`INSERT INTO companies
    (id,name,account_key,name_source,portal_name,created_at,updated_at)
    VALUES('company-1','شركة النور','account-1','source','شركة النور','2026-10-01','2026-10-01')`).run()
  fixture.close()

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

  const [{ PUT }, { listRecords }] = await Promise.all([
    import('../launcher/app/api/companies/[id]/route.js'),
    import('../launcher/lib/data.js')
  ])
  const cookie = await createAuthenticatedCookie('Operator')
  const update = (name) => PUT(new Request('http://localhost:3000/api/companies/company-1', {
    method: 'PUT',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      cookie,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ name, englishName: '', taxRegistrationNumber: '' })
  }), { params: Promise.resolve({ id: 'company-1' }) })

  const conflictResponse = await update('شركة الشمس')
  assert.equal(conflictResponse.status, 200)
  assert.equal((await conflictResponse.json()).company.name_origin, 'conflict')
  const conflict = listRecords('companies')[0]
  assert.equal(conflict.company_known, false)
  assert.equal(conflict.company_manual_name, 'شركة الشمس')
  assert.equal(conflict.company_portal_name, 'شركة النور')

  const verifiedResponse = await update('شركة النور')
  assert.equal(verifiedResponse.status, 200)
  assert.equal((await verifiedResponse.json()).company.name_origin, 'manual_verified')
  const verified = listRecords('companies')[0]
  assert.equal(verified.company_known, true)
  assert.equal(verified.company_name_origin, 'manual_verified')

  const { getDatabase } = require('../db/connect')
  const audit = getDatabase().prepare(`SELECT details FROM audit_log
    WHERE action='company.identity.updated' ORDER BY at DESC LIMIT 2`).all()
  assert.equal(audit.length, 2)
  assert.deepEqual(audit.map((row) => JSON.parse(row.details).identityConflict).sort(), [false, true])
})
