import { markDone } from '../../../../../db/queries/obligations.js'
import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (typeof body.id !== 'string' || body.id.length > 200 || String(body.evidence || '').length > 2000) {
    return Response.json({ error: 'Invalid obligation details' }, { status: 400 })
  }
  const updated = markDone(body.id, authz.session.user.id, body.evidence || '')
  return updated ? Response.json({ updated: true }) : Response.json({ error: 'Obligation not found' }, { status: 404 })
}
