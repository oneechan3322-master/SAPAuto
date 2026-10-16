import { createHash, randomInt } from 'node:crypto'
import { db } from '../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'
import { now } from '../../../../db/queries/shared.js'

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = String(randomInt(100000, 1000000))
    const hash = createHash('sha256').update(code).digest('hex')
    try {
      db.prepare('INSERT INTO link_codes(code_hash,user_id,expires_at) VALUES(?,?,?)')
        .run(hash, authz.session.user.id, new Date(Date.now() + 10 * 60000).toISOString())
      return Response.json({ code, expiresInMinutes: 10 }, { status: 201 })
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') throw error
    }
  }
  return Response.json({ error: 'Could not allocate a link code. Try again.' }, { status: 503 })
}
