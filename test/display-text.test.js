'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { displayText } = require('../domain/display-text.cjs')

test('display text preserves legal and financial identifiers verbatim', () => {
  assert.equal(displayText('Claim 205971997 / ضريبة ١٢٣٤٥٦٧٨'), 'Claim 205971997 / ضريبة ١٢٣٤٥٦٧٨')
  assert.equal(displayText('Invoice — 000341380431'), 'Invoice — 000341380431')
  assert.equal(displayText('Ref: 123456789abcdef'), 'Ref: 123456789abcdef')
})

test('display text only normalizes whitespace and uses honest fallbacks', () => {
  assert.equal(displayText('  شركة   النور \n  001234  '), 'شركة النور 001234')
  assert.equal(displayText('', 'غير متاح'), 'غير متاح')
  assert.equal(displayText(null, 'غير متاح'), 'غير متاح')
})
