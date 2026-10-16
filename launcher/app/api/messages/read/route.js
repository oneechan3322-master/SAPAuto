import { db } from '../../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'
import { audit } from '../../../../../db/queries/shared.js'

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (typeof body.id !== 'string') return Response.json({ error: 'Message id is required' }, { status: 400 })
  const result = db.prepare('UPDATE messages SET is_read=1 WHERE id=?').run(body.id)
  if (!result.changes) return Response.json({ error: 'Message not found' }, { status: 404 })
  audit(db, { actorId: authz.session.user.id, action: 'message.marked_read', entityType: 'message', entityId: body.id })
  return Response.json({ updated: true })
}
