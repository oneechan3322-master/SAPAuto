import { db } from '../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'
import { audit, id, now } from '../../../../db/queries/shared.js'

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  const dueAt = Date.parse(body.dueAt)
  if (!Number.isFinite(dueAt) || dueAt < Date.now() - 60000 || dueAt > Date.now() + 366 * 86400000) {
    return Response.json({ error: 'Reminder time must be within the next year.' }, { status: 400 })
  }
  const targetType = String(body.targetType || 'general')
  const targetId = String(body.targetId || '')
  if (!['general', 'task', 'obligation', 'payment'].includes(targetType) || targetId.length > 200) {
    return Response.json({ error: 'Invalid reminder target' }, { status: 400 })
  }
  const key = `${authz.session.user.id}:${targetType}:${targetId}:${new Date(dueAt).toISOString()}`
  const reminderId = id('reminder')
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO reminders(id,target_type,target_id,user_id,due_at,channel,dedupe_key,created_at)
        VALUES(?,?,?,?,?,'launcher',?,?)`)
        .run(reminderId, targetType, targetId, authz.session.user.id, new Date(dueAt).toISOString(), key, now())
      audit(db, { actorId: authz.session.user.id, action: 'reminder.created', entityType: targetType, entityId: targetId, details: { reminderId } })
    })()
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return Response.json({ error: 'This reminder already exists.' }, { status: 409 })
    throw error
  }
  return Response.json({ id: reminderId }, { status: 201 })
}
