import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'
import proposals from '../../../../../assistant/code-proposals.js'

export async function POST(request, { params }) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  try {
    const result = proposals.decideUpgradeProposal({
      proposalId: (await params).id,
      userId: authz.session.user.id,
      decision: body.decision
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: error.message }, { status: 409 })
  }
}
