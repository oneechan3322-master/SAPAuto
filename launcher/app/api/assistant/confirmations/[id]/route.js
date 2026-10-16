import { createRequire } from 'node:module'
import { db } from '../../../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../../../lib/guard.js'

const require = createRequire(import.meta.url)
const { decideConfirmation } = require('../../../../../../assistant/confirmations.js')

export async function POST(request, { params }) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (typeof body.confirm !== 'boolean') {
    return Response.json({ error: 'Choose confirm or decline.' }, { status: 400 })
  }
  try {
    const { id } = await params
    const result = await decideConfirmation({
      confirmationId: id,
      userId: authz.session.user.id,
      role: authz.session.user.role,
      confirm: body.confirm,
      db
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: error.message || 'Could not process confirmation' }, { status: 409 })
  }
}
