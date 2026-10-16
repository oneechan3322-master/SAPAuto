import { auth } from './auth.js'
import { db } from './db.js'

const ROLE_LEVEL = { Viewer: 0, Operator: 1, Owner: 2 }

export async function requireRole(request, minimum = 'Viewer') {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session || session.user.disabled) {
    return { response: Response.json({ error: 'Authentication required' }, { status: 401 }) }
  }
  if ((ROLE_LEVEL[session.user.role] ?? -1) < ROLE_LEVEL[minimum]) {
    return { response: Response.json({ error: 'Insufficient role' }, { status: 403 }) }
  }
  return { session }
}

export function requireSameOrigin(request) {
  const origin = request.headers.get('origin')
  if (!origin) return Response.json({ error: 'Origin header is required' }, { status: 403 })
  try {
    const url = new URL(origin)
    const host = request.headers.get('host')
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
      || new URL(request.url).protocol
    const expectedOrigin = host && new URL(`${protocol.replace(/:$/, '')}://${host}`).origin
    if (expectedOrigin && url.origin === expectedOrigin) return null
  } catch {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 })
}

export async function pageSession() {
  const { headers } = await import('next/headers')
  return auth.api.getSession({ headers: await headers() })
}

export function pageSetupRequired() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0
}
