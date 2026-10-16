'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createRequire } = require('node:module')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { createAuthenticatedCookie } = require('./helpers/auth-session.cjs')

const launcherRequire = createRequire(path.resolve(__dirname, '../launcher/package.json'))
const ExcelJS = launcherRequire('exceljs')

test('XLSX export route respects company/date filters and sends a real workbook', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-export-route-'))
  const databasePath = path.join(directory, 'export-test.db')
  const previousRoot = process.env.V8_ROOT
  const previousDatabasePath = process.env.V8_DB_PATH
  process.env.V8_ROOT = path.resolve(__dirname, '..')
  process.env.V8_DB_PATH = databasePath
  const fixture = openDatabase(databasePath)
  runMigrations(fixture)
  fixture.prepare(`INSERT INTO companies
    (id,name,account_key,tax_registration_number,name_source,created_at,updated_at)
    VALUES('company-1','شركة النور','acct-1','001234','manual','2026-10-01','2026-10-01')`).run()
  fixture.prepare(`INSERT INTO payments
    (id,company_id,account_key,claim_number,amount,currency,due_date,status,raw_json,created_at,updated_at)
    VALUES('payment-1','company-1','acct-1','claim-1',413.11,'EGP','2026-10-20','pending',
      '{"status":"pending"}','2026-10-15','2026-10-15')`).run()
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

  const { GET } = await import('../launcher/app/api/export/route.js')
  const cookie = await createAuthenticatedCookie('Viewer')
  const response = await GET(new Request(
    'http://localhost/api/export?section=payments&company=company-1&from=2026-10-20&to=2026-10-20',
    { headers: { host: 'localhost', cookie } }
  ))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /spreadsheetml\.sheet/)
  assert.match(response.headers.get('content-disposition'), /SAPAuto_/)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Summary', 'Details', 'شركة النور', 'Metadata'
  ])
  const details = workbook.getWorksheet('Details')
  assert.equal(details.rowCount, 2)
  assert.equal(details.getCell('B2').value, '001234')
  assert.equal(details.getCell('F2').value, 413.11)

  const companyResponse = await GET(new Request(
    'http://localhost/api/export?section=company&companyId=company-1',
    { headers: { host: 'localhost', cookie } }
  ))
  const companyWorkbook = new ExcelJS.Workbook()
  await companyWorkbook.xlsx.load(Buffer.from(await companyResponse.arrayBuffer()))
  assert.equal(companyWorkbook.getWorksheet('Details').rowCount, 2)
  assert.equal(companyWorkbook.getWorksheet('Details').getCell('B2').value, '001234')

  const excludedResponse = await GET(new Request(
    'http://localhost/api/export?section=payments&from=2026-10-21',
    { headers: { host: 'localhost', cookie } }
  ))
  const excludedWorkbook = new ExcelJS.Workbook()
  await excludedWorkbook.xlsx.load(Buffer.from(await excludedResponse.arrayBuffer()))
  assert.equal(excludedWorkbook.getWorksheet('Details').rowCount, 1)
})
