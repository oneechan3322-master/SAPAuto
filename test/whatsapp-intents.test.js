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

test('WhatsApp remote control intents (tasks, stop, restart, rdp, help) are recognized', () => {
  assert.equal(intents.isStatusRequest('tasks'), true)
  assert.equal(intents.isStatusRequest('المهام'), true)
  assert.equal(intents.isStatusRequest('status'), true)

  assert.deepEqual(intents.parseStopRequest('stop all'), { target: 'all' })
  assert.deepEqual(intents.parseStopRequest('stop llm'), { target: 'llm' })
  assert.deepEqual(intents.parseStopRequest('إيقاف الكل'), { target: 'الكل' })
  assert.deepEqual(intents.parseStopRequest('إيقاف السيرفر'), { target: 'السيرفر' })

  assert.deepEqual(intents.parseRestartRequest('restart all'), { target: 'all' })
  assert.deepEqual(intents.parseRestartRequest('restart llm'), { target: 'llm' })

  assert.equal(intents.isHelpRequest('help'), true)
  assert.equal(intents.isHelpRequest('مساعدة'), true)
  assert.equal(intents.isHelpRequest('الأوامر'), true)

  assert.equal(intents.isRdpRequest('rdp'), true)
  assert.equal(intents.isRdpRequest('ريموت'), true)
})

test('WhatsApp enterprise intents (reports, alerts, digest, company inquiry) are recognized', () => {
  assert.equal(intents.isReportRequest('تقرير'), true)
  assert.equal(intents.isReportRequest('report'), true)
  assert.equal(intents.isReportRequest('تقرير النور'), true)
  assert.equal(intents.parseReportCompany('تقرير النور'), 'النور')
  assert.equal(intents.parseReportCompany('report ABC Co'), 'ABC Co')

  assert.equal(intents.isAlertRequest('alerts'), true)
  assert.equal(intents.isAlertRequest('إشعارات'), true)
  assert.equal(intents.isAlertRequest('مواعيد حرجة'), true)

  assert.equal(intents.isDigestControlRequest('تفعيل اليومية'), true)
  assert.equal(intents.isDigestControlRequest('إيقاف اليومية'), true)
  assert.equal(intents.isDigestControlRequest('اليومية الآن'), true)
  assert.equal(intents.parseDigestControlAction('تفعيل اليومية'), 'enable')
  assert.equal(intents.parseDigestControlAction('إيقاف اليومية'), 'disable')
  assert.equal(intents.parseDigestControlAction('اليومية الآن'), 'now')

  assert.equal(intents.isCompanyInquiry('شركة الأمل'), 'الأمل')
  assert.equal(intents.isCompanyInquiry('ضرائب المصرية للاتصالات'), 'المصرية للاتصالات')
  assert.equal(intents.isCompanyInquiry('مستندات متاحة'), null)

  assert.deepEqual(intents.parseScanRequest('فحص'), { account: '' })
  assert.deepEqual(intents.parseScanRequest('scan'), { account: '' })
  assert.deepEqual(intents.parseScanRequest('فحص النور'), { account: 'النور' })
})

test('WhatsApp details intent recognises details hi, doc numbers, and companies', () => {
  assert.equal(intents.isDetailsRequest('details'), true)
  assert.equal(intents.isDetailsRequest('details hi'), true)
  assert.equal(intents.isDetailsRequest('hi details'), true)
  assert.equal(intents.isDetailsRequest('تفاصيل'), true)
  assert.equal(intents.isDetailsRequest('تفاصيل 180000221747'), true)
  assert.equal(intents.isDetailsRequest('details Aroba2024'), true)

  assert.equal(intents.parseDetailsTarget('details hi'), null)
  assert.equal(intents.parseDetailsTarget('hi details'), null)
  assert.equal(intents.parseDetailsTarget('تفاصيل'), null)
  assert.equal(intents.parseDetailsTarget('تفاصيل 180000221747'), '180000221747')
  assert.equal(intents.parseDetailsTarget('details Aroba2024'), 'aroba2024')
})

test('WhatsApp Enterprise company resolution maps IDs to official Arabic names', () => {
  assert.equal(intents.resolveCompanyName('evgeegypt'), 'افجي مصر للتوكيلات الملاحية والاعمال البحرية')
  assert.equal(intents.resolveCompanyName('205971997'), 'كيمورا للبويات والصناعات الكيماوية')
  assert.equal(intents.resolveCompanyName('Aroba2024'), 'حميده فوزي خيرالله سليمان (العروبة للمقاولات)')
  assert.equal(intents.resolveCompanyName('533158788'), 'مروه مصطفى عبدالحميد طه (جلوب كيم)')

  const evgeKeys = intents.resolveAccountKeysForFilter('افجي')
  assert.ok(evgeKeys.includes('evgeegypt'))

  const arobaKeys = intents.resolveAccountKeysForFilter('العروبة')
  assert.ok(arobaKeys.includes('Aroba2024') || arobaKeys.includes('aroba2024'))

  const chemoraKeys = intents.resolveAccountKeysForFilter('كيمورا')
  assert.ok(chemoraKeys.includes('205971997'))
})

test('Card S0: bare Arabic news words match; possessive forms do not hijack lanes', () => {
  assert.equal(intents.isNewsRequest('\u0627\u0644\u0627\u062E\u0628\u0627\u0631'), true) // bare "akhbar" list word
  assert.equal(intents.isNewsRequest('\u0627\u0644\u0623\u062E\u0628\u0627\u0631'), true) // the-News with hamza alef
  assert.equal(intents.isNewsRequest('\u0627\u062E\u0628\u0627\u0631 \u0627\u0644\u064A\u0648\u0645'), true) // news of today
  assert.equal(intents.isNewsRequest('\u0645\u0627 \u0627\u0644\u062C\u062F\u064A\u062F\u061F'), true) // what's new + Arabic question mark
  assert.equal(intents.isNewsRequest('hi \u0627\u062E\u0628\u0627\u0631'), true) // command prefix + news word
  assert.equal(intents.isNewsRequest('\u0623\u062E\u0628\u0627\u0631\u0643'), false) // "your news" — possessive, no bare token
  assert.equal(intents.isGreetingRequest('\u0633\u0644\u0627\u0645 \u0639\u0644\u064A\u0643\u0645 \u064A\u0627 \u0623\u062E\u0628\u0627\u0631\u0643'), false) // greeting sentence stays out of the wake lane
})

test('WhatsApp Enterprise help and command guides are styled for executive use', () => {
  const helpText = intents.helpAnswer()
  assert.ok(helpText.includes('SAPAuto Enterprise'))
  assert.ok(helpText.includes('tasks'))
  assert.ok(helpText.includes('details'))
  assert.ok(helpText.includes('تقرير'))
  assert.ok(helpText.includes('إشعارات'))
})
