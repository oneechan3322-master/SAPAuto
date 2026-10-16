import { markTaskDone } from '../../../../../db/queries/tasks.js'
import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (typeof body.id !== 'string' || body.id.length > 200) return Response.json({ error: 'Invalid task id' }, { status: 400 })
  const updated = markTaskDone(body.id, authz.session.user.id)
  return updated ? Response.json({ updated: true }) : Response.json({ error: 'Task not found' }, { status: 404 })
}
