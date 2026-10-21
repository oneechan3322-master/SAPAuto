'use strict'

const crypto = require('node:crypto')
const { getDatabase, writeTx } = require('../db/connect')
const { now } = require('../db/queries/shared')
const { log } = require('../lib/logger')

// Transactional outbox (Opus5.5 §6.2): the event dispatcher records what must
// be delivered, and transport senders drain their own channel rows. A delivery
// is therefore durable before a provider is contacted, retried with backoff
// after a crash, and deduplicated by idempotency key instead of being lost or
// sent twice.
const BACKOFF_SECONDS = [60, 300, 900, 3600, 21600]
const MAX_ATTEMPTS = BACKOFF_SECONDS.length
const LEASE_SECONDS = 120
const WORKER = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`

function idempotencyKey(eventId, channel, recipient) {
  return crypto.createHash('sha256').update(`${eventId}|${channel}|${recipient}`).digest('hex')
}

function enqueue({ eventId, channel, recipient, payload, shadow = false }, db = getDatabase()) {
  const key = idempotencyKey(eventId, channel, recipient) + (shadow ? ':shadow' : '')
  const result = db.prepare(`INSERT OR IGNORE INTO notification_outbox
    (event_id, channel, recipient, payload_json, idempotency_key, status, next_attempt_at, created_at, shadow)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .run(eventId, channel, recipient, JSON.stringify(payload || {}), key, now(), now(), shadow ? 1 : 0)
  return { inserted: result.changes > 0, idempotencyKey: key }
}

function recoverExpiredLeases(db = getDatabase(), timestamp = now()) {
  // A row stuck in 'sending' may or may not have reached the provider. It is
  // never retried automatically (WhatsApp has no reliable send check); it is
  // parked as 'uncertain' for explicit review/resend.
  return db.prepare(`UPDATE notification_outbox
    SET status = 'uncertain', lease_owner = NULL, lease_until = NULL
    WHERE status = 'sending' AND lease_until IS NOT NULL AND lease_until < ?`).run(timestamp).changes
}

function claim(channel, limit = 5, db = getDatabase()) {
  return writeTx(() => {
    recoverExpiredLeases(db)
    const leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString()
    return db.prepare(`UPDATE notification_outbox
      SET status = 'sending', lease_owner = ?, attempts = attempts + 1, lease_until = ?
      WHERE id IN (
        SELECT id FROM notification_outbox
        WHERE channel = ? AND shadow = 0 AND status IN ('pending', 'failed') AND next_attempt_at <= ?
        ORDER BY next_attempt_at LIMIT ?
      )
      RETURNING *`).all(WORKER, leaseUntil, channel, now(), limit)
  }, db)
}

function markSent(id, providerMsgId = null, db = getDatabase()) {
  db.prepare(`UPDATE notification_outbox
    SET status = 'sent', provider_msg_id = ?, sent_at = ?, lease_owner = NULL, lease_until = NULL
    WHERE id = ?`).run(providerMsgId ? String(providerMsgId) : null, now(), id)
}

function markFailed(id, message, attempts, db = getDatabase()) {
  const dead = attempts >= MAX_ATTEMPTS
  const delay = BACKOFF_SECONDS[Math.min(Math.max(attempts, 1) - 1, BACKOFF_SECONDS.length - 1)]
  db.prepare(`UPDATE notification_outbox
    SET status = ?, last_error = ?, lease_owner = NULL, lease_until = NULL, next_attempt_at = ?
    WHERE id = ?`).run(
    dead ? 'dead' : 'failed',
    String(message || 'unknown error').slice(0, 500),
    new Date(Date.now() + delay * 1000).toISOString(),
    id
  )
  return { dead }
}

/** Release a claimed row back to pending without cost when the transport
 * itself is unavailable (client offline, credentials not configured). The
 * claim's attempt increment is reversed so transport outages never count
 * against the delivery. */
function defer(id, { seconds = 30, db = getDatabase() } = {}) {
  db.prepare(`UPDATE notification_outbox
    SET status = 'pending', attempts = MAX(attempts - 1, 0), next_attempt_at = ?,
        lease_owner = NULL, lease_until = NULL
    WHERE id = ?`).run(new Date(Date.now() + seconds * 1000).toISOString(), id)
}

/** Reset an 'uncertain' or 'dead' row for an explicit operator-triggered resend. */
function resetForResend(id, db = getDatabase()) {
  return db.prepare(`UPDATE notification_outbox
    SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL,
        lease_owner = NULL, lease_until = NULL
    WHERE id = ? AND status IN ('uncertain', 'dead', 'failed')`).run(now(), id).changes === 1
}

async function drain(channel, sendFn, { batch = 5, gapMs = 1500, db = getDatabase() } = {}) {
  const rows = claim(channel, batch, db)
  let sent = 0
  let failed = 0
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    try {
      // Providers in this repo return { messageId } (WhatsApp/Telegram) or a
      // raw id string; both are recorded for the delivery audit trail.
      const result = await sendFn(row.recipient, JSON.parse(row.payload_json))
      markSent(row.id, result?.messageId ?? result?.id ?? (typeof result === 'string' ? result : null), db)
      sent += 1
      log.info({ outboxId: row.id, eventId: row.event_id, channel }, 'delivered')
    } catch (error) {
      const { dead } = markFailed(row.id, error?.message, row.attempts, db)
      failed += 1
      log.warn({ outboxId: row.id, attempts: row.attempts, dead, err: error?.message }, 'delivery failed')
    }
    // Deliberate human-like pacing between provider calls: rate limits and
    // number bans, not speed, are the risk with an unofficial client.
    if (index < rows.length - 1) await new Promise((resolve) => setTimeout(resolve, gapMs + Math.random() * 1000))
  }
  return { claimed: rows.length, sent, failed }
}

function outboxStats(db = getDatabase()) {
  const row = db.prepare(`SELECT
    COALESCE(SUM(shadow = 0 AND status IN ('pending', 'failed')), 0) AS backlog,
    COALESCE(SUM(shadow = 0 AND status = 'dead'), 0) AS dead,
    COALESCE(SUM(shadow = 0 AND status = 'uncertain'), 0) AS uncertain,
    MIN(CASE WHEN shadow = 0 AND status IN ('pending', 'failed') THEN created_at END) AS oldest,
    COALESCE(SUM(shadow = 1), 0) AS shadow
    FROM notification_outbox`).get()
  return {
    backlog: row.backlog,
    dead: row.dead,
    uncertain: row.uncertain,
    oldest: row.oldest || null,
    shadow: row.shadow
  }
}

module.exports = {
  enqueue,
  claim,
  markSent,
  markFailed,
  defer,
  resetForResend,
  recoverExpiredLeases,
  drain,
  outboxStats,
  idempotencyKey,
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  LEASE_SECONDS
}
