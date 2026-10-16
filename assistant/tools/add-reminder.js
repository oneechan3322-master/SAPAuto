'use strict'

const { getDatabase } = require('../../db/connect')
const { id, now } = require('../../db/queries/shared')

module.exports = async function addReminder({
  description = '', target = '', target_type = 'general', when, channel = 'launcher'
}, context) {
  const due = Date.parse(when)
  if (!Number.isFinite(due) || due < Date.now() || due > Date.now() + 366 * 86400000) throw new Error('when must be within the next year')
  if (!['launcher', 'telegram', 'whatsapp', 'email'].includes(channel)) throw new Error('Unsupported reminder channel')
  if (!['general', 'task', 'obligation', 'payment'].includes(target_type)) throw new Error('Unsupported reminder target type')
  const targetId = String(target).trim().slice(0, 200)
  const message = String(description).trim().slice(0, 300)
  if (!targetId && !message) throw new Error('A reminder description or target is required')
  const targetTables = { task: 'tasks', obligation: 'obligations', payment: 'payments' }
  const db = getDatabase()
  if (target_type !== 'general') {
    if (!targetId || !db.prepare(`SELECT 1 FROM ${targetTables[target_type]} WHERE id=?`).get(targetId)) {
      throw new Error('Reminder target was not found')
    }
  }
  if (channel !== 'launcher' && !db.prepare('SELECT 1 FROM user_channels WHERE user_id=? AND channel=?').get(context.userId, channel)) {
    throw new Error('Link this notification channel before scheduling a reminder')
  }
  const key = `${context.userId}:${target_type}:${targetId}:${message}:${new Date(due).toISOString()}`
  const reminderId = id('reminder')
  db.prepare(`INSERT INTO reminders(id,target_type,target_id,user_id,due_at,channel,dedupe_key,created_at,message)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(reminderId, target_type, targetId,
    context.userId, new Date(due).toISOString(), channel, key, now(), message)
  return { id: reminderId, added: true }
}
