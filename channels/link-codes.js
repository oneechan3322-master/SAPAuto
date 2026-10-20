'use strict'

const { createHash } = require('node:crypto')
const { getDatabase } = require('../db/connect')
const { id, now, audit } = require('../db/queries/shared')

function consumeLinkCode(channel, externalId, code, db = getDatabase()) {
  const hash = createHash('sha256').update(String(code)).digest('hex')
  return db.transaction(() => {
    const link = db.prepare(`SELECT user_id,expires_at,used_at FROM link_codes WHERE code_hash=?`).get(hash)
    if (!link || link.used_at || Date.parse(link.expires_at) <= Date.now()) return null
    const result = db.prepare('UPDATE link_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL')
      .run(now(), hash)
    if (!result.changes) return null
    db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
      VALUES(?,?,?,?,?) ON CONFLICT(channel,external_id) DO UPDATE SET
      user_id=excluded.user_id,verified_at=excluded.verified_at`)
      .run(id('channel'), link.user_id, channel, externalId, now())
    audit(db, { actorId: link.user_id, action: 'channel.linked', entityType: 'channel', entityId: channel })
    return { userId: link.user_id, channel, externalId }
  })()
}

function linkedUser(channel, externalId, db = getDatabase()) {
  return db.prepare(`SELECT u.id AS userId,u.role,u.disabled FROM user_channels c
    JOIN users u ON u.id=c.user_id WHERE c.channel=? AND c.external_id=?`).get(channel, externalId) || null
}

module.exports = { consumeLinkCode, linkedUser }
