'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { definitions, execute, tools } = require('../assistant/tools')

test('assistant exposes the planned tools plus gated code-upgrade proposals', () => {
  assert.deepEqual(Object.keys(tools).sort(), [
    'add_reminder', 'add_task', 'list_documents', 'list_failures', 'mark_obligation_done',
    'request_code_upgrade', 'save_note', 'scan_now', 'send_pdf', 'send_pdf_email', 'send_report', 'status', 'summarize'
  ])
  assert.equal(definitions().length, 13)
})

test('viewer cannot execute a write tool', async () => {
  await assert.rejects(
    execute('scan_now', {}, { userId: 'viewer-1', role: 'Viewer' }),
    /Insufficient role/
  )
})

test('assistant rejects tools outside its fixed registry', async () => {
  await assert.rejects(
    execute('raw_sql', {}, { userId: 'owner-1', role: 'Owner' }),
    /Unknown assistant tool/
  )
})

test('only Owners may request code-upgrade proposals', async () => {
  await assert.rejects(
    execute('request_code_upgrade', { request: 'Add a dashboard badge' }, { userId: 'viewer-1', role: 'Viewer' }),
    /Insufficient role/
  )
})
