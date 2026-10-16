import assistant from '../../../../assistant/run.js'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'

const { runAssistant } = assistant

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) {
    return Response.json({ error: 'Message must be 1–4000 characters.' }, { status: 400 })
  }
  try {
    const result = await runAssistant({ userId: authz.session.user.id, role: authz.session.user.role, text: body.text })
    return Response.json(result)
  } catch (error) {
    console.error(`Assistant request failed: ${error.message}`)
    return Response.json({ error: error.message || 'Assistant is unavailable' }, { status: 503 })
  }
}
