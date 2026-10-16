'use strict'

const { getDatabase } = require('../connect')
const { audit, now } = require('./shared')

function listTasks({ accountKey, status, limit = 500 } = {}, db = getDatabase()) {
  const filters = []
  const params = []
  if (accountKey) { filters.push('account_key = ?'); params.push(accountKey) }
  if (status) { filters.push('status = ?'); params.push(status) }
  params.push(Math.max(1, Math.min(Number(limit) || 500, 2000)))
  return db.prepare(`SELECT * FROM tasks ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY CASE WHEN deadline = '' THEN 1 ELSE 0 END, deadline LIMIT ?`).all(...params)
}

/**
 * Plan 2.3 §2 — completing a portal task locally never rewrites the status the
 * portal supplied. A locally-created task has no source observation, so its
 * own status is still the office record.
 */
function markTaskDone(taskId, userId, db = getDatabase()) {
  const actorId = userId || 'system'
  const transaction = db.transaction(() => {
    const current = db.prepare('SELECT status,origin FROM tasks WHERE id=?').get(taskId)
    if (!current) return false
    const timestamp = now()
    const result = current.origin === 'portal'
      ? db.prepare(`UPDATE tasks SET local_review_status='completed_locally', local_reviewed_at=?,
            local_reviewed_by=?, updated_at=? WHERE id=? AND local_review_status<>'completed_locally'`)
        .run(timestamp, actorId, timestamp, taskId)
      : db.prepare("UPDATE tasks SET status='done', updated_at=? WHERE id=? AND status <> 'done'")
        .run(timestamp, taskId)
    if (result.changes) {
      audit(db, {
        actorId: actorId,
        action: 'task.done',
        entityType: 'task',
        entityId: taskId,
        details: { origin: current.origin, sourceStatusUnchanged: current.origin === 'portal' ? current.status : null, portalChanged: false }
      })
    }
    return result.changes === 1
  })
  return transaction()
}

module.exports = { listTasks, markTaskDone }
