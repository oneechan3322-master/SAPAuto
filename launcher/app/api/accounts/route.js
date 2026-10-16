import { createRequire } from 'node:module'
import { requireRole } from '../../../lib/guard.js'

const require = createRequire(import.meta.url)
const { listAccounts } = require('../../../../harness/source.js')
const SCAN_TARGETS = [
  { key: 'ZETA_MCFAPP', label: 'ZETA MCFAPP' },
  { key: 'ZMCF_PAYROLL', label: 'ZMCF PAYROLL' }
]

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response
  const accounts = await listAccounts()
  const keys = new Set(accounts.map((account) => account.username.toLowerCase()))
  return Response.json(SCAN_TARGETS.map((target) => ({
    ...target,
    configured: keys.has(target.key.toLowerCase())
  })), { headers: { 'cache-control': 'no-store' } })
}
