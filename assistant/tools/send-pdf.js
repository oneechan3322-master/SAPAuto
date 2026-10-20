'use strict'

const { getDatabase } = require('../../db/connect')
const { id, now } = require('../../db/queries/shared')

// Queues one real-PDF delivery to the WhatsApp control number. The channels
// worker owns the WhatsApp provider, so the send itself happens there
// (commands type 'wake_send_document'). The file orbit is re-verified in the
// worker before the document actually leaves.
module.exports = async function sendPdf({ task_id }, context) {
  if (!task_id || typeof task_id !== 'string') throw new Error('task_id is required')
  const db = getDatabase()
  const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
  const wakeEnabled = db.prepare("SELECT value FROM settings WHERE key='whatsapp_wake_notifications'").get()?.value === 'true'
  if (!controlNumber || !wakeEnabled) {
    throw new Error('The WhatsApp control number or wake notifications are not configured')
  }
  const task = db.prepare('SELECT id,title,account_key,deadline,pdf_path FROM tasks WHERE id=?').get(task_id)
  if (!task) throw new Error('Document was not found')
  if (!task.pdf_path) throw new Error('This document has no PDF file')
  const commandId = id('wake_pdf')
  const timestamp = now()
  db.prepare("INSERT INTO commands(id,type,payload,requested_by,status,result,created_at) VALUES(?,?,?,?,'queued','',?)")
    .run(commandId, 'wake_send_document', JSON.stringify({ taskId: task.id }), context.userId, timestamp)
  return {
    queued: true,
    commandId,
    recipient: controlNumber,
    document: { id: task.id, title: task.title, account: task.account_key, deadline: task.deadline }
  }
}
