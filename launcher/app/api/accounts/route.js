import { createRequire } from 'node:module'
import { requireRole } from '../../../lib/guard.js'

const require = createRequire(import.meta.url)
const {
  listAccounts,
  upsertAccount,
  disableAccount,
  resolveAccountsKey,
  encryptSecret,
  decryptSecret
} = require('../../../../harness/accounts.js')
const { getDatabase } = require('../../../../db/connect.js')
const { now } = require('../../../../db/queries/shared.js')

/* GET /api/accounts — list all accounts (enabled + disabled), with decrypted password for direct display */
export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response

  try {
    const db = getDatabase()
    const rows = db.prepare(
      `SELECT account_key AS id, label, username, enabled, secret_cipher, secret_iv, secret_tag, created_at, updated_at
       FROM accounts ORDER BY label COLLATE NOCASE`
    ).all()

    let key = null
    try {
      key = resolveAccountsKey({ allowGenerate: false })
    } catch {
      key = null
    }

    const result = rows.map((r) => {
      let password = ''
      if (key && r.secret_cipher && r.secret_iv && r.secret_tag) {
        try {
          password = decryptSecret({ cipher: r.secret_cipher, iv: r.secret_iv, tag: r.secret_tag }, key)
        } catch {
          password = ''
        }
      }
      return {
        id: r.id,
        label: r.label,
        username: r.username,
        enabled: r.enabled,
        password,
        created_at: r.created_at,
        updated_at: r.updated_at
      }
    })

    return Response.json(result, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error('[accounts GET]', err.message)
    return Response.json({ error: 'فشل تحميل الحسابات: ' + err.message }, { status: 500 })
  }
}

/* POST /api/accounts — create a new account */
export async function POST(request) {
  const authz = await requireRole(request, 'Admin')
  if (authz.response) return authz.response

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const { id, username, label, password } = body ?? {}
  if (!id || typeof id !== 'string' || !id.trim()) {
    return Response.json({ error: 'معرف الحساب مطلوب' }, { status: 400 })
  }
  if (!username || typeof username !== 'string' || !username.trim()) {
    return Response.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 })
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return Response.json({ error: 'كلمة المرور مطلوبة لحساب جديد' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const exists = db.prepare('SELECT 1 FROM accounts WHERE account_key = ?').get(id.trim())
    if (exists) {
      return Response.json({ error: 'معرف الحساب موجود مسبقاً' }, { status: 409 })
    }
    const key = resolveAccountsKey()
    const secret = encryptSecret(password.trim(), key)
    const ts = now()
    db.prepare(
      `INSERT INTO accounts(account_key,username,label,secret_cipher,secret_iv,secret_tag,enabled,created_at,updated_at)
       VALUES(?,?,?,?,?,?,1,?,?)`
    ).run(id.trim(), username.trim(), (label || username).trim(), secret.cipher, secret.iv, secret.tag, ts, ts)
    return Response.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('[accounts POST]', err.message)
    return Response.json({ error: 'فشل إنشاء الحساب: ' + err.message }, { status: 500 })
  }
}

/* PATCH /api/accounts — edit label, username, enabled, optionally new password */
export async function PATCH(request) {
  const authz = await requireRole(request, 'Admin')
  if (authz.response) return authz.response

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const { id, username, label, password, enabled } = body ?? {}
  if (!id || typeof id !== 'string' || !id.trim()) {
    return Response.json({ error: 'معرف الحساب مطلوب' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM accounts WHERE account_key = ?').get(id.trim())
    if (!row) {
      return Response.json({ error: 'الحساب غير موجود' }, { status: 404 })
    }

    const ts = now()
    const newUsername = (username && username.trim()) ? username.trim() : row.username
    const newLabel    = (label    && label.trim())    ? label.trim()    : row.label
    const newEnabled  = typeof enabled === 'number' ? enabled : row.enabled

    if (password && password.trim()) {
      const key = resolveAccountsKey()
      const secret = encryptSecret(password.trim(), key)
      db.prepare(
        `UPDATE accounts SET username=?,label=?,secret_cipher=?,secret_iv=?,secret_tag=?,enabled=?,updated_at=?
         WHERE account_key=?`
      ).run(newUsername, newLabel, secret.cipher, secret.iv, secret.tag, newEnabled, ts, id.trim())
    } else {
      db.prepare(
        `UPDATE accounts SET username=?,label=?,enabled=?,updated_at=? WHERE account_key=?`
      ).run(newUsername, newLabel, newEnabled, ts, id.trim())
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[accounts PATCH]', err.message)
    return Response.json({ error: 'فشل تعديل الحساب: ' + err.message }, { status: 500 })
  }
}

/* DELETE /api/accounts?key=ACCOUNT_KEY — permanently remove an account */
export async function DELETE(request) {
  const authz = await requireRole(request, 'Admin')
  if (authz.response) return authz.response

  const key = new URL(request.url).searchParams.get('key')
  if (!key || !key.trim()) {
    return Response.json({ error: 'معرف الحساب مطلوب' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const result = db.prepare('DELETE FROM accounts WHERE account_key = ?').run(key.trim())
    if (result.changes === 0) {
      return Response.json({ error: 'الحساب غير موجود' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[accounts DELETE]', err.message)
    return Response.json({ error: 'فشل حذف الحساب: ' + err.message }, { status: 500 })
  }
}
