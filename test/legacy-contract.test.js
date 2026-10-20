'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { parseCliArguments } = require('../harness/scraper/cli')

test('V8 scraper CLI accepts a single-account scan with an output path', () => {
  assert.deepEqual(parseCliArguments([
    '--account', 'acct-1', '--json-out', 'C:\\temp\\scan.json'
  ]), {
    accountKey: 'acct-1',
    jsonOutFile: 'C:\\temp\\scan.json'
  })
})

test('V8 scraper CLI rejects incomplete or contradictory arguments', () => {
  assert.throws(() => parseCliArguments(['--account']))
  assert.throws(() => parseCliArguments(['--account', 'acct-1']))
  assert.throws(() => parseCliArguments(['--json-out', 'out.json']))
  assert.throws(() => parseCliArguments(['--account', 'a', '--account', 'b', '--json-out', 'o.json']))
})
