'use strict'

const { getDatabase } = require('../../db/connect')
const { id, now } = require('../../db/queries/shared')
const summarize = require('./summarize')

module.exports = async function sendReport({ channel, recipients = '' }, context) {
  if (!['telegram', 'whatsapp', 'email'].includes(channel)) throw new Error('Unsupported report channel')
  const db = getDatabase()
  const linked = db.prepare('SELECT external_id FROM user_channels WHERE user_id=? AND channel=?')
    .all(context.userId, channel).map((row) => row.external_id)
  const requested = Array.isArray(recipients) ? recipients.map(String) : String(recipients).split(',').map((item) => item.trim()).filter(Boolean)
  const recipientList = requested.length ? requested : linked
  if (!recipientList.length || recipientList.some((item) => !linked.includes(item))) {
    throw new Error('Reports may only be sent to your linked channel recipients')
  }
  const safeRecipients = recipientList.join(',')
  if (safeRecipients.length > 1000) throw new Error('Recipient list is too long')
  const summary = await summarize({ scope: 'all', period: 'today' })
  const body = `ملخص SAPAuto: ${summary.tasks} مهمة مفتوحة، ${summary.overdueObligations} التزام متأخر، ${summary.openFailures} إخفاق مفتوح.`
  const reportId = id('report')
  const timestamp = now()
  db.prepare('INSERT INTO reports(id,user_id,channel,recipients,body,created_at) VALUES(?,?,?,?,?,?)')
    .run(reportId, context.userId, channel, safeRecipients, body, timestamp)
  db.prepare('INSERT INTO events(id,kind,payload,created_at) VALUES(?,?,?,?)')
    .run(id('event'), 'report_requested', JSON.stringify({ reportId, channel, userId: context.userId, recipients: recipientList }), timestamp)
  return { id: reportId, queued: true, body }
}
