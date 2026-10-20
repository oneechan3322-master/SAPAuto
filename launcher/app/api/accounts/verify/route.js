import { createRequire } from 'node:module'
import { requireRole } from '../../../../lib/guard.js'

const require = createRequire(import.meta.url)
const { verifyAndFetchCompanyName } = require('../../../../../harness/verifier.js')

export async function POST(request) {
  const authz = await requireRole(request, 'Admin')
  if (authz.response) return authz.response

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'طلب غير صالح' }, { status: 400 })
  }

  const { username, password } = body ?? {}
  if (!username || typeof username !== 'string' || !username.trim()) {
    return Response.json({ ok: false, error: 'اسم المستخدم مطلوب' }, { status: 400 })
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return Response.json({ ok: false, error: 'كلمة المرور مطلوبة' }, { status: 400 })
  }

  try {
    const verification = await verifyAndFetchCompanyName(username.trim(), password.trim())
    return Response.json(verification)
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 })
  }
}
