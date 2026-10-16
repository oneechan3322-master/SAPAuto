import { auth } from '../../../lib/auth.js'
import { db } from '../../../lib/db.js'
import { requireSameOrigin } from '../../../lib/guard.js'
import { audit, now } from '../../../../db/queries/shared.js'

export async function GET() {
  const setupRequired = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0
  return Response.json({ setupRequired }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError

  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'تعذر قراءة بيانات الإعداد.' }, { status: 400 }) }
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (name.length < 2 || name.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      password.length < 12 || password.length > 128) {
    return Response.json({ error: 'أدخل اسمًا وبريدًا صحيحين وكلمة مرور من 12 إلى 128 حرفًا.' }, { status: 400 })
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) {
    return Response.json({ error: 'تم إعداد المالك الأول مسبقًا. سجّل الدخول بدلًا من ذلك.' }, { status: 409 })
  }

  const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const lease = db.prepare(`UPDATE setup_bootstrap SET lease_until=?
    WHERE id=1 AND lease_until<?`).run(leaseUntil, now())
  if (!lease.changes) {
    return Response.json({ error: 'إعداد المالك قيد التنفيذ بالفعل. انتظر قليلًا ثم حاول مجددًا.' }, { status: 409 })
  }

  try {
    const signupUrl = new URL('/api/auth/sign-up/email', request.url)
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    headers.set('content-type', 'application/json')
    const signupRequest = new Request(signupUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, email, password, callbackURL: '/' })
    })
    const signupResponse = await auth.handler(signupRequest)
    let result
    try { result = await signupResponse.clone().json() }
    catch { throw new Error('تعذر إنشاء جلسة المالك.') }
    if (!signupResponse.ok || !result.user?.id) {
      db.prepare("UPDATE setup_bootstrap SET lease_until='1970-01-01T00:00:00.000Z' WHERE id=1").run()
      return Response.json({ error: result.message || result.error || 'تعذر إنشاء حساب المالك.' }, { status: signupResponse.status || 400 })
    }

    db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
      if (count !== 1) throw new Error('First-owner creation is no longer exclusive')
      db.prepare("UPDATE users SET role='Owner' WHERE id=?").run(result.user.id)
      db.prepare("UPDATE setup_bootstrap SET lease_until='1970-01-01T00:00:00.000Z' WHERE id=1").run()
      audit(db, {
        actorId: result.user.id,
        action: 'owner.bootstrap_completed',
        entityType: 'user',
        entityId: result.user.id
      })
    }).immediate()

    const responseHeaders = new Headers({ 'cache-control': 'no-store' })
    for (const cookie of signupResponse.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie)
    return Response.json({ created: true, user: { name: result.user.name, email: result.user.email } }, {
      status: 201,
      headers: responseHeaders
    })
  } catch (error) {
    db.prepare(`UPDATE setup_bootstrap SET lease_until='1970-01-01T00:00:00.000Z'
      WHERE id=1 AND lease_until=?`).run(leaseUntil)
    throw error
  }
}
