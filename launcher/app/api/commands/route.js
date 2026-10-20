import { createCommand } from '../../../../db/queries/commands.js'
import { audit } from '../../../../db/queries/shared.js'
import { db } from '../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { listAccounts } = require('../../../../harness/source.js')

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!['scan_now', 'pause', 'resume', 'set_interval', 'send_report_now', 'retry_account', 'unpark_account', 'backup_now'].includes(body.type)) {
    return Response.json({ error: 'Unsupported command type' }, { status: 400 })
  }
  if (body.type === 'set_interval' && (!Number.isInteger(body.payload?.minutes) || body.payload.minutes < 5 || body.payload.minutes > 1440)) {
    return Response.json({ error: 'Interval must be between 5 and 1440 minutes' }, { status: 400 })
  }
  if (['retry_account', 'unpark_account', 'scan_now'].includes(body.type) &&
      body.payload?.account !== undefined &&
      (typeof body.payload.account !== 'string' || body.payload.account.length > 150)) {
    return Response.json({ error: 'Invalid account key' }, { status: 400 })
  }
  if (body.type === 'scan_now' && body.payload?.account) {
    const accounts = await listAccounts()
    const account = accounts.find((item) => item.username.toLowerCase() === body.payload.account.toLowerCase())
    if (!account) return Response.json({ error: 'That scan account is not configured in V8.' }, { status: 404 })
    body.payload.account = account.username
  }
  const commandId = createCommand(body.type, body.payload || {}, authz.session.user.id, db)
  audit(db, { actorId: authz.session.user.id, action: 'command.created', entityType: 'command', entityId: commandId, details: { type: body.type } })
  return Response.json({ id: commandId, status: 'queued' }, { status: 202 })
}
