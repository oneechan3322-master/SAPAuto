'use strict'

const { getDatabase } = require('../../db/connect')
const { id, now } = require('../../db/queries/shared')

module.exports = async function saveNote({ target_type, target_id, text }, context) {
  if (!['company', 'task', 'obligation', 'payment'].includes(target_type)) throw new Error('Invalid note target')
  if (typeof target_id !== 'string' || !target_id || target_id.length > 200) throw new Error('Invalid note id')
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Note text must be 1–4000 characters')
  const db = getDatabase()
  const noteId = id('note')
  db.prepare('INSERT INTO notes(id,target_type,target_id,user_id,text,created_at) VALUES(?,?,?,?,?,?)')
    .run(noteId, target_type, target_id, context.userId, text.trim(), now())
  return { id: noteId, saved: true }
}
