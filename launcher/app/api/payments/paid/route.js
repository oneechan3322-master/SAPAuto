import { db } from '../../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'
import { audit, now } from '../../../../../db/queries/shared.js'

const MAX_REASON = 200

/**
 * Plan 2.1 §2.3 / §4.3 — "marked paid locally" is a local statement about the
 * administrator's own review. It never overwrites the status the portal
 * supplied and never implies that a portal payment happened.
 */
export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (typeof body.id !== 'string' || !body.id) {
    return Response.json({ error: 'Payment id is required' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : ''
  if (reason.length < 3) {
    return Response.json({ error: 'يلزم سبب موجز لتحديد الحالة محليًا.', code: 'PAYMENT_SOURCE_STATUS_UNKNOWN' }, { status: 400 })
  }

  const payment = db.prepare('SELECT id,status,local_review_status FROM payments WHERE id=?').get(body.id)
  if (!payment) return Response.json({ error: 'Payment not found' }, { status: 404 })

  const timestamp = now()
  const updated = db.transaction(() => {
    const result = db.prepare(`UPDATE payments
      SET local_review_status='paid_locally', local_paid_at=?, local_paid_reason=?, updated_at=?
      WHERE id=?`)
      .run(timestamp, reason, timestamp, body.id)
    audit(db, {
      actorId: authz.session.user.id,
      action: 'payment.marked_paid_local',
      entityType: 'payment',
      entityId: body.id,
      details: { sourceStatusUnchanged: payment.status, reason: reason.slice(0, MAX_REASON), portalChanged: false }
    })
    return result
  })()

  if (!updated.changes) return Response.json({ error: 'Payment not found' }, { status: 404 })
  return Response.json({
    updated: true,
    portalChanged: false,
    sourceStatus: payment.status,
    localReviewStatus: 'paid_locally'
  })
}