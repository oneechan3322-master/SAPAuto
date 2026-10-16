import { db } from '../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'
import proposals from '../../../../assistant/code-proposals.js'

export async function GET(request) {
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  const enabled = db.prepare("SELECT value FROM settings WHERE key='opencode_proposals_enabled'").get()?.value === 'true'
  return Response.json({
    enabled,
    available: proposals.isOpenCodeConfigured(),
    model: process.env.V8_OPENCODE_MODEL || '',
    proposals: proposals.listUpgradeProposals()
  })
}

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  const enabled = db.prepare("SELECT value FROM settings WHERE key='opencode_proposals_enabled'").get()?.value === 'true'
  if (!enabled) return Response.json({ error: 'OpenCode proposals are disabled in Owner settings' }, { status: 403 })
  if (!proposals.isOpenCodeConfigured()) {
    return Response.json({ error: 'Configure the OpenCode CLI, model, and sign-in before requesting a proposal' }, { status: 503 })
  }
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 1500) {
    return Response.json({ error: 'Code-upgrade request must be 1–1500 characters' }, { status: 400 })
  }
  try { proposals.validateCodeOnlyRequest(body.request) }
  catch (error) { return Response.json({ error: error.message }, { status: 400 }) }
  try {
    const proposal = await proposals.createUpgradeProposal({
      userId: authz.session.user.id,
      request: body.request
    })
    return Response.json(proposal, { status: 201 })
  } catch (error) {
    console.error(`OpenCode proposal request failed (${error.code || error.name})`)
    return Response.json({ error: error.message || 'OpenCode proposal failed' }, { status: 503 })
  }
}
