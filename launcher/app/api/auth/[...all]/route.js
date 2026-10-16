import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '../../../../lib/auth.js'
import { db } from '../../../../lib/db.js'

const handlers = toNextJsHandler(auth)
export const GET = handlers.GET

export async function POST(request) {
  const pathname = new URL(request.url).pathname
  if (pathname.endsWith('/sign-up/email')) {
    return Response.json({ error: 'Account creation is disabled.' }, { status: 410 })
  }
  if (pathname.endsWith('/sign-in/email')) {
    let body
    try { body = await request.clone().json() }
    catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
    if (typeof body.email === 'string') {
      const user = db.prepare('SELECT disabled FROM users WHERE email=? COLLATE NOCASE').get(body.email.trim())
      if (user?.disabled) return Response.json({ error: 'This account is disabled.' }, { status: 403 })
    }
  }
  return handlers.POST(request)
}
