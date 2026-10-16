'use strict'

const { getDatabase } = require('../db/connect')
const { audit, id, now } = require('../db/queries/shared')
const { execute, WRITE_TOOLS } = require('./tools')

function createConfirmation({ userId, toolName, args, db = getDatabase() }) {
  if (!userId || !WRITE_TOOLS.has(toolName)) throw new Error('Unsupported confirmation action')
  const encoded = JSON.stringify(args || {})
  const existing = db.prepare(`SELECT id FROM assistant_confirmations
    WHERE user_id=? AND tool_name=? AND args_json=? AND state='pending' AND expires_at>?`)
    .get(userId, toolName, encoded, now())
  if (existing) return existing.id
  const confirmationId = id('confirm')
  const timestamp = now()
  db.prepare(`INSERT INTO assistant_confirmations
    (id,user_id,tool_name,args_json,created_at,expires_at)
    VALUES(?,?,?,?,?,?)`).run(
    confirmationId, userId, toolName, encoded, timestamp,
    new Date(Date.now() + 15 * 60 * 1000).toISOString()
  )
  audit(db, {
    actorId: userId, action: 'assistant.action.confirmation_requested',
    entityType: 'assistant_action', entityId: confirmationId,
    details: { toolName, argumentKeys: Object.keys(args || {}) }
  })
  return confirmationId
}

function listPendingConfirmations(userId, db = getDatabase()) {
  return db.prepare(`SELECT id,tool_name,args_json,created_at,expires_at
    FROM assistant_confirmations WHERE user_id=? AND state='pending' AND expires_at>?
    ORDER BY created_at DESC LIMIT 20`).all(userId, now())
    .map((row) => ({ ...row, args: JSON.parse(row.args_json), args_json: undefined }))
}

async function decideConfirmation({ confirmationId, userId, role, confirm, db = getDatabase() }) {
  if (typeof confirmationId !== 'string' || !/^confirm_[a-f0-9-]{36}$/.test(confirmationId)) {
    throw new Error('Invalid confirmation id')
  }
  const timestamp = now()
  const claim = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM assistant_confirmations
      WHERE id=? AND user_id=? AND state='pending'`).get(confirmationId, userId)
    if (!row) return { error: 'Pending action was not found or was already handled' }
    if (Date.parse(row.expires_at) <= Date.now()) {
      db.prepare(`UPDATE assistant_confirmations SET state='expired',completed_at=? WHERE id=?`)
        .run(timestamp, confirmationId)
      return { error: 'Confirmation expired; ask the assistant to create it again' }
    }
    if (!confirm) {
      db.prepare(`UPDATE assistant_confirmations SET state='declined',completed_at=? WHERE id=?`)
        .run(timestamp, confirmationId)
      audit(db, { actorId: userId, action: 'assistant.action.declined', entityType: 'assistant_action', entityId: confirmationId })
      return { declined: true }
    }
    db.prepare(`UPDATE assistant_confirmations SET state='running' WHERE id=? AND state='pending'`)
      .run(confirmationId)
    return { action: row }
  }).immediate()
  if (claim.error) throw new Error(claim.error)
  if (claim.declined) return { declined: true }

  const action = claim.action
  try {
    const result = await execute(action.tool_name, JSON.parse(action.args_json), { userId, role })
    db.prepare(`UPDATE assistant_confirmations SET state='confirmed',result=?,completed_at=? WHERE id=?`)
      .run(JSON.stringify(result).slice(0, 4000), now(), confirmationId)
    audit(db, {
      actorId: userId, action: 'assistant.action.confirmed',
      entityType: 'assistant_action', entityId: confirmationId,
      details: { toolName: action.tool_name }
    })
    return { confirmed: true, result }
  } catch (error) {
    db.prepare(`UPDATE assistant_confirmations SET state='failed',result=?,completed_at=? WHERE id=?`)
      .run(String(error.message || error).slice(0, 1000), now(), confirmationId)
    audit(db, {
      actorId: userId, action: 'assistant.action.failed',
      entityType: 'assistant_action', entityId: confirmationId,
      details: { toolName: action.tool_name, error: String(error.message || error).slice(0, 300) }
    })
    throw error
  }
}

module.exports = { createConfirmation, listPendingConfirmations, decideConfirmation }
