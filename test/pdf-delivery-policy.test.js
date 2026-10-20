'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { buildExecutiveEmailPayload } = require('../channels/send-report')

test('executive email is a summary-only lane with no PDF attachments', () => {
  const payload = buildExecutiveEmailPayload({
    from: 'SAPAuto <office@example.test>', to: 'owner@example.test',
    subject: 'Briefing', html: '<p>Summary</p>'
  })
  assert.deepEqual(payload, {
    from: 'SAPAuto <office@example.test>', to: ['owner@example.test'],
    subject: 'Briefing', html: '<p>Summary</p>'
  })
  assert.equal(Object.hasOwn(payload, 'attachments'), false)
})
