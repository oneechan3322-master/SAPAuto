import fs from 'node:fs'
import path from 'node:path'
import { requireRole } from '../../../../lib/guard.js'
import { sendExecutiveReport } from '../../../../../channels/send-report.js'

function getEnvPath() {
  return path.resolve(process.cwd(), '..', '.env')
}

function readEnvMap() {
  const envPath = getEnvPath()
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, 'utf8')
  const map = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim()
      map[key] = val
    }
  }
  return map
}

function writeEnvMap(map) {
  const envPath = getEnvPath()
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const lines = content.split(/\r?\n/)
  const handled = new Set()
  const newLines = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      newLines.push(line)
      continue
    }
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim()
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        newLines.push(`${key}=${map[key]}`)
        handled.add(key)
        continue
      }
    }
    newLines.push(line)
  }

  for (const [key, val] of Object.entries(map)) {
    if (!handled.has(key)) {
      newLines.push(`${key}=${val}`)
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf8')
}

/* GET /api/settings/keys — returns current API keys configuration */
export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response

  const env = readEnvMap()
  return Response.json({
    resendKeys: env.RESEND_API_KEYS || env.RESEND_API_KEY || '',
    recipientEmail: env.RECIPIENT_EMAIL || 'ramygalal235@gmail.com',
    senderEmail: env.SENDER_EMAIL || 'onboarding@resend.dev',
    mistralKeys: env.MISTRAL_API_KEYS || env.MISTRAL_API_KEY || '',
    mistralModel: env.MISTRAL_MODEL || 'mistral-small-latest'
  }, { headers: { 'cache-control': 'no-store' } })
}

/* PUT /api/settings/keys — updates or adds API keys and email configuration */
export async function PUT(request) {
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response

  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'طلب غير صالح' }, { status: 400 }) }

  const { resendKeys, recipientEmail, senderEmail, mistralKeys, mistralModel } = body ?? {}

  const updates = {}
  if (typeof resendKeys === 'string') {
    updates.RESEND_API_KEYS = resendKeys.trim()
    updates.RESEND_API_KEY = resendKeys.split(',')[0]?.trim() || ''
    process.env.RESEND_API_KEYS = updates.RESEND_API_KEYS
    process.env.RESEND_API_KEY = updates.RESEND_API_KEY
  }
  if (typeof recipientEmail === 'string') {
    updates.RECIPIENT_EMAIL = recipientEmail.trim()
    process.env.RECIPIENT_EMAIL = updates.RECIPIENT_EMAIL
  }
  if (typeof senderEmail === 'string') {
    updates.SENDER_EMAIL = senderEmail.trim()
    process.env.SENDER_EMAIL = updates.SENDER_EMAIL
  }
  if (typeof mistralKeys === 'string') {
    updates.MISTRAL_API_KEYS = mistralKeys.trim()
    updates.MISTRAL_API_KEY = mistralKeys.split(',')[0]?.trim() || ''
    process.env.MISTRAL_API_KEYS = updates.MISTRAL_API_KEYS
    process.env.MISTRAL_API_KEY = updates.MISTRAL_API_KEY
  }
  if (typeof mistralModel === 'string') {
    updates.MISTRAL_MODEL = mistralModel.trim()
    process.env.MISTRAL_MODEL = updates.MISTRAL_MODEL
  }

  try {
    writeEnvMap(updates)
    return Response.json({ ok: true, saved: updates })
  } catch (err) {
    return Response.json({ error: 'فشل حفظ الإعدادات: ' + err.message }, { status: 500 })
  }
}

/* POST /api/settings/keys — trigger test email send */
export async function POST(request) {
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response

  let body = {}
  try { body = await request.json() } catch {}

  const env = readEnvMap()
  const to = body.to || env.RECIPIENT_EMAIL || 'ramygalal235@gmail.com'

  try {
    const res = await sendExecutiveReport({ to })
    if (res.ok) {
      return Response.json({ ok: true, message: `تم إرسال التقرير بنجاح إلى ${to}`, id: res.id })
    } else {
      return Response.json({ ok: false, error: res.error || 'تعذر إرسال البريد' }, { status: 500 })
    }
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 })
  }
}
