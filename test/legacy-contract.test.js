'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { parseCliArguments } = require('../../SAPAuto3/src/orchestrator')

test('SAPAuto3 JSON scan options select one account and disable email', () => {
  assert.deepEqual(parseCliArguments([
    '--account', 'acct-1', '--json-out', 'C:\\temp\\scan.json', '--no-email'
  ]), {
    listAccounts: false,
    accountKey: 'acct-1',
    jsonOutFile: 'C:\\temp\\scan.json'
  })
})

test('SAPAuto3 account-list mode cannot be mixed with a scan', () => {
  assert.throws(() => parseCliArguments(['--list-accounts', '--account', 'acct-1']))
  assert.throws(() => parseCliArguments(['--account']))
})
