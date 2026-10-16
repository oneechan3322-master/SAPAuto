'use strict'

const { randomUUID } = require('node:crypto')

function id(prefix) {
  return `${prefix}_${randomUUID()}`
}

function now() {
  return new Date().toISOString()
}

function audit(db, { actorId = 'system', action, entityType = '', entityId = '', details = {} }) {
  if (!action) throw new Error('Audit action is required')
  db.prepare(`INSERT INTO audit_log(id, at, actor_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id('audit'), now(), actorId, action, entityType, entityId, JSON.stringify(details)
  )
}

module.exports = { id, now, audit }
