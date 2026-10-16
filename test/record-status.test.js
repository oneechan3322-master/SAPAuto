'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const recordStatus = require('../domain/record-status.cjs')

test('Cairo day boundaries use Africa/Cairo rather than UTC', () => {
  assert.equal(recordStatus.cairoDateKey(new Date('2026-04-23T21:59:00.000Z')), '2026-04-23')
  assert.equal(recordStatus.cairoDateKey(new Date('2026-04-23T22:00:00.000Z')), '2026-04-24')
  assert.equal(recordStatus.cairoDateKey(new Date('2026-10-16T20:59:00.000Z')), '2026-10-16')
  assert.equal(recordStatus.cairoDateKey(new Date('2026-10-16T21:00:00.000Z')), '2026-10-17')
})

test('date-only values must be real calendar dates', () => {
  assert.equal(recordStatus.validDateKey('2024-02-29'), true)
  assert.equal(recordStatus.validDateKey('2026-02-29'), false)
  assert.equal(recordStatus.validDateKey('2026-13-01'), false)
  assert.equal(recordStatus.validDateKey('2026-1-01'), false)
})

test('payment timing is derived from the stored due date and known source state', () => {
  const today = '2026-04-21'
  assert.equal(recordStatus.classifyRecord('payments', '2026-04-20', 'في انتظار السداد', today), 'overdue')
  assert.equal(recordStatus.classifyRecord('payments', today, 'في انتظار السداد', today), 'due_today')
  assert.equal(recordStatus.classifyRecord('payments', '2026-04-28', 'مسدد جزئياً', today), 'due_soon')
  assert.equal(recordStatus.classifyRecord('payments', '2026-04-29', 'pending', today), 'upcoming')
  assert.equal(recordStatus.classifyRecord('payments', '2026-04-20', 'paid', today), 'complete')
  assert.equal(recordStatus.classifyRecord('payments', '2026-04-20', 'unknown', today), 'unknown')
})

test('due counts only include records with known active source statuses', () => {
  const payments = [
    { date: '2026-04-20', status: 'في انتظار السداد' },
    { date: '2026-04-21', status: 'في انتظار السداد' },
    { date: '2026-04-28', status: 'مسدد جزئياً' },
    { date: '2026-04-20', status: 'paid' },
    { date: '2026-04-20', status: 'unknown' },
    { date: '2026-02-31', status: 'pending' }
  ]
  assert.deepEqual(recordStatus.countDue(payments, 'payments', '2026-04-21'), {
    overdue: 1,
    dueSoon: 2
  })
})

test('missing amounts and currencies are never presented as zero or EGP', () => {
  assert.equal(recordStatus.formatAmount(null, 'EGP'), 'المبلغ غير متاح')
  assert.equal(recordStatus.formatAmount('', 'EGP'), 'المبلغ غير متاح')
  assert.equal(recordStatus.formatAmount(413.11, ''), '413.11 · العملة غير محددة')
  assert.equal(recordStatus.formatAmount(413.11, 'الجنيه المصري (EGP)'), '413.11 EGP')
  assert.equal(recordStatus.formatAmount(413.111, 'EGP'), '413.111 EGP')
})
