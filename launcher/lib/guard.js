import { auth } from './auth.js'
import { db } from './db.js'
import { openAccessEnabled, fallbackWorkspaceUser } from './open-access.js'

const ROLE_LEVEL = { Viewer: 0, Operator: 1, Owner: 2 }

export async function requireRole(request, minimum = 'Viewer') {
  let session
  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch {
    return { response: Response.json({ error: 'Authentication required' }, { status: 401 }) }
  }
  if (!session || session.user.disabled) {
    if (openAccessEnabled()) {
      const owner = fallbackWorkspaceUser(db)
      if (owner) {
        return {
          session: {
            user: {
              id: owner.id,
              name: owner.name,
              email: owner.email,
              role: owner.role,
              disabled: false
            }
          }
        }
      }
    }
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
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (session?.user && !session.user.disabled) return session
  } catch {}
  if (openAccessEnabled()) {
    const owner = fallbackWorkspaceUser(db)
    if (owner) {
      return {
        user: {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          role: owner.role,
          disabled: false
        }
      }
    }
  }
  return null
}

export function pageSetupRequired() {
  return !db.prepare('SELECT role FROM users WHERE role=? LIMIT 1').get('Owner')
}

