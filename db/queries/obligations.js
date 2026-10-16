'use strict'

const { getDatabase } = require('../connect')
const { audit, now } = require('./shared')

function listObligations({ accountKey, limit = 1000 } = {}, db = getDatabase()) {
  const key = accountKey ? 'WHERE account_key = ?' : ''
  const values = accountKey ? [accountKey, Math.min(Number(limit) || 1000, 4000)] : [Math.min(Number(limit) || 1000, 4000)]
  return db.prepare(`SELECT * FROM obligations ${key} ORDER BY deadline LIMIT ?`).all(...values)
}

/**
 * Plan 2.3 §2 "source is not opinion" — completing an obligation locally is an
 * office record, not a change to what the portal said. `status` and `evidence`
 * are left exactly as the source supplied them.
 */
function markDone(id, userId, evidence = '', db = getDatabase()) {
  const actorId = userId || 'system'
  const note = String(evidence).slice(0, 2000)
  return db.transaction(() => {
    const result = db.prepare(`UPDATE obligations
      SET local_review_status='completed_locally', local_review_note=?,
          local_reviewed_at=?, local_reviewed_by=?, updated_at=?
      WHERE id=?`).run(note, now(), actorId, now(), id)
    if (result.changes) {
      const source = db.prepare('SELECT status,evidence FROM obligations WHERE id=?').get(id)
      audit(db, {
        actorId: actorId,
        action: 'obligation.done',
        entityType: 'obligation',
        entityId: id,
        details: { sourceStatusUnchanged: source.status, sourceEvidenceUnchanged: source.evidence, portalChanged: false }
      })
    }
    return result.changes === 1
  })()
}

module.exports = { listObligations, markDone }
