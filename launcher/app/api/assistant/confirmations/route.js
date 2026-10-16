import { createRequire } from 'node:module'
import { db } from '../../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'

const require = createRequire(import.meta.url)
const { createConfirmation, listPendingConfirmations } = require('../../../../../assistant/confirmations.js')
const TARGETS = new Set(['ZETA_MCFAPP', 'ZMCF_PAYROLL'])

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response
  return Response.json(listPendingConfirmations(authz.session.user.id, db), {
    headers: { 'cache-control': 'no-store' }
  })
}

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (body.toolName !== 'scan_now' || typeof body.args?.account !== 'string' ||
      !TARGETS.has(body.args.account.toUpperCase())) {
    return Response.json({ error: 'Only the two configured scan forms are available here.' }, { status: 400 })
  }
  const confirmationId = createConfirmation({
    userId: authz.session.user.id,
    toolName: 'scan_now',
    args: { account: body.args.account.toUpperCase() },
    db
  })
  return Response.json({ id: confirmationId, state: 'pending' }, { status: 202 })
}
