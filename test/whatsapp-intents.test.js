'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const intents = require('../channels/whatsapp-intents')

test('WhatsApp natural-language intents are recognised', () => {
  assert.equal(intents.isNewsRequest('hello'), true)
  assert.equal(intents.isNewsRequest('ما الجديد؟'), true)
  assert.equal(intents.isDateRequest('متى تم إرسال هذا؟'), true)
  assert.equal(intents.isPdfRequest('اقرأ هذا PDF'), true)
})

test('WhatsApp recognises Arabic document-list requests without model inference', () => {
  assert.equal(intents.isDocumentListRequest('\u0642\u0648\u0645 \u0628\u0625\u062f\u0631\u0627\u062c \u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629'), true)
  assert.equal(intents.isDocumentListRequest('list available documents'), true)
})

test('WhatsApp scan commands can target all accounts or one configured username', () => {
  assert.deepEqual(intents.parseScanRequest('scan all accounts'), { account: '' })
  assert.deepEqual(intents.parseScanRequest('launch 205971997'), { account: '205971997' })
  assert.deepEqual(intents.parseScanRequest('\u0627\u0641\u062d\u0635 205971997'), { account: '205971997' })
  assert.equal(intents.parseScanRequest('hi'), null)
})
