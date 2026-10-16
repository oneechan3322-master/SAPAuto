'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { createRequire } = require('node:module')

const launcherRequire = createRequire(path.resolve(__dirname, '../launcher/package.json'))
const ExcelJS = launcherRequire('exceljs')

test('XLSX export preserves typed values, totals, RTL layout, sheets, and safe text', async () => {
  const { createExportWorkbook } = await import('../launcher/lib/export-workbook.js')
  const exportedAt = new Date('2026-10-16T12:00:00.000Z')
  const buffer = await createExportWorkbook([
    {
      section: 'payments',
      company_id: 'company-1',
      company_name: 'شركة النور',
      company_known: true,
      company_tax_registration_number: '001234',
      title: '=1+1',
      source_status: 'open',
      due_date: '2026-04-21',
      amount: 413.11,
      currency: 'EGP',
      company_last_synced_at: '2026-10-15T08:00:00.000Z'
    },
    {
      section: 'payments',
      company_id: 'company-1',
      company_name: 'شركة النور',
      company_known: true,
      company_tax_registration_number: '001234',
      title: 'موعد دفع',
      source_status: 'open',
      due_date: '2026-04-22',
      amount: 1.89,
      currency: 'EGP'
    },
    {
      section: 'payments',
      company_id: 'company-2',
      company_name: 'اسم غير مسجّل',
      company_known: false,
      title: 'موعد دفع',
      source_status: 'unknown',
      due_date: null,
      amount: null,
      currency: ''
    }
  ], { exportedAt })

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Summary', 'Details', 'شركة النور', 'اسم غير مسجّل', 'Metadata'
  ])

  const summary = workbook.getWorksheet('Summary')
  const details = workbook.getWorksheet('Details')
  assert.equal(summary.views[0].rightToLeft, true)
  assert.equal(summary.views[0].ySplit, 1)
  assert.equal(summary.getCell('E2').value, 415)
  assert.equal(summary.getCell('D2').value, 2)
  assert.ok(details.autoFilter)
  assert.equal(details.getCell('B2').value, '001234')
  assert.equal(details.getCell('B2').type, ExcelJS.ValueType.String)
  assert.equal(details.getCell('C2').value, '\'=1+1')
  assert.equal(details.getCell('E2').value instanceof Date, true)
  assert.equal(details.getCell('F2').value, 413.11)
  assert.equal(typeof details.getCell('F2').value, 'number')
  assert.match(details.getCell('F2').numFmt, /EGP/)
  assert.equal(workbook.getWorksheet('شركة النور').rowCount, 3)
  assert.equal(workbook.getWorksheet('Metadata').getCell('A1').value, 'تاريخ التصدير')
})
