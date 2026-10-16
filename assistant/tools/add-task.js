'use strict'

const { getDatabase } = require('../../db/connect')
const { id, now } = require('../../db/queries/shared')

module.exports = async function addTask({ company, title, deadline = '', assignee = '' }) {
  if (typeof company !== 'string' || !company.trim()) throw new Error('company account key is required')
  if (typeof title !== 'string' || !title.trim() || title.length > 300) throw new Error('Task title must be 1–300 characters')
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error('deadline must use YYYY-MM-DD')
  const db = getDatabase()
  const row = db.prepare('SELECT id FROM companies WHERE account_key=?').get(company)
  if (!row) throw new Error('Company account was not found')
  const taskId = id('task')
  const timestamp = now()
  db.prepare(`INSERT INTO tasks(id,company_id,account_key,doc_number,title,deadline,status,urgency,
    assigned_to,origin,created_at,updated_at) VALUES(?,?,?,?,?,?,'open','normal',?,'user_created',?,?)`)
    .run(taskId, row.id, company, `manual-${taskId}`, title.trim(), deadline, String(assignee).slice(0, 100), timestamp, timestamp)
  return { id: taskId, created: true, portalOrigin: 'user_created' }
}
