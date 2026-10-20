'use strict'

const { getDatabase } = require('../../db/connect')
const { id, now } = require('../../db/queries/shared')

// Queues a PDF delivery to a specified email address via Gmail.
// The channels worker owns the Gmail provider, so the actual send
// happens there (command type 'wake_send_document_email').
module.exports = async function sendPdfEmail({ task_id, email }, context) {
  if (!task_id || typeof task_id !== 'string') throw new Error('task_id is required')
  if (!email || typeof email !== 'string' || !email.includes('@')) throw new Error('A valid email address is required')
  const db = getDatabase()
  const gmailUser = process.env.GMAIL_USER || ''
  if (!gmailUser) throw new Error('Gmail is not configured on this server (GMAIL_USER missing)')
  const task = db.prepare('SELECT id,title,account_key,deadline,pdf_path FROM tasks WHERE id=?').get(task_id)
  if (!task) throw new Error('Document was not found')
  if (!task.pdf_path) throw new Error('This document has no PDF file')
  const commandId = id('wake_email')
  const timestamp = now()
  db.prepare("INSERT INTO commands(id,type,payload,requested_by,status,result,created_at) VALUES(?,?,?,?,'queued','',?)")
    .run(commandId, 'wake_send_document_email', JSON.stringify({ taskId: task.id, email: email.trim() }), context.userId, timestamp)
  return {
    queued: true,
    commandId,
    recipient: email.trim(),
    document: { id: task.id, title: task.title, account: task.account_key, deadline: task.deadline }
  }
}
