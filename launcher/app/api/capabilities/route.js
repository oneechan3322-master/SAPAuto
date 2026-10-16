import { createRequire } from 'node:module'
import { requireRole } from '../../../lib/guard.js'
import service from '../../../../assistant/capabilities.js'

const require = createRequire(import.meta.url)
const proposalStore = require('../../../../assistant/code-proposals.js')

/**
 * Plan 2.0 §12.1 — read-only status for each capability. Never returns a key,
 * a secret path, a raw command line, or a credential of any kind.
 */
export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response
  const configured = service.capabilityInputs().system_adviser.configured
  return Response.json({
    ...service.readiness(),
    proposals: {
      inbox: configured
        ? proposalStore.listUpgradeProposals().map((row) => ({
          id: row.id, status: row.status, created_at: row.created_at
        }))
        : []
    },
    policyEvents: service.listPolicyEvents(20).map((event) => ({
      id: event.id, capability: event.capability, action: event.action, at: event.at
    }))
  }, { headers: { 'cache-control': 'no-store' } })
}