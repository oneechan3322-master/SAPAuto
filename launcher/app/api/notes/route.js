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
  if (!['company', 'task', 'obligation', 'payment'].includes(body.targetType) ||
      typeof body.targetId !== 'string' || !body.targetId || typeof body.text !== 'string' ||
      !body.text.trim() || body.text.length > 4000) {
    return Response.json({ error: 'Valid target and note text are required.' }, { status: 400 })
  }
  const noteId = id('note')
  db.transaction(() => {
    db.prepare('INSERT INTO notes(id,target_type,target_id,user_id,text,created_at) VALUES(?,?,?,?,?,?)')
      .run(noteId, body.targetType, body.targetId, authz.session.user.id, body.text.trim(), now())
    audit(db, { actorId: authz.session.user.id, action: 'note.created', entityType: body.targetType, entityId: body.targetId, details: { noteId } })
  })()
  return Response.json({ id: noteId }, { status: 201 })
}
