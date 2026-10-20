'use strict'

/**
 * Multi-provider Email Sender for SAPAuto V8.
 * Uses the proven V5 Executive Email Design.
 * Supports Resend API with multi-key rotation and failover,
 * plus graceful fallback to Nodemailer / SMTP.
 */

const https = require('node:https')
const { renderV5ExecutiveEmail } = require('./email-templates')
const { getDatabase } = require('../db/connect')

function postHttps(urlStr, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const bodyStr = typeof data === 'string' ? data : JSON.stringify(data)
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
      },
      rejectUnauthorized: false
    }

    const req = https.request(options, (res) => {
      let chunks = []
      res.on('data', (d) => chunks.push(d))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try {
          resolve({ status: res.statusCode, data: JSON.parse(text) })
        } catch {
          resolve({ status: res.statusCode, data: text })
        }
      })
    })

    req.on('error', (err) => reject(err))
    req.write(bodyStr)
    req.end()
  })
}

// Email is the executive briefing lane. PDF evidence has a single delivery
// lane—WhatsApp—so a report email can never accidentally include attachments.
function buildExecutiveEmailPayload({ from, to, subject, html }) {
  return { from, to: [to], subject, html }
}

/**
 * Sends V5-designed executive email to recipient with key rotation.
 */
async function sendExecutiveReport({
  to = process.env.RECIPIENT_EMAIL || 'ramygalal235@gmail.com',
  subject = 'تقرير مستندات وموقف مصلحة الضرائب المصرية (SAP MCF)',
  recipientName = 'الأستاذ رامي جلال',
  apiKey = null,
  db = getDatabase()
} = {}) {
  // 1. Gather live statistics
  const stats = {
    companies: db.prepare('SELECT count(*) as c FROM companies').get().c,
    tasks: db.prepare('SELECT count(*) as c FROM tasks').get().c,
    obligations: db.prepare('SELECT count(*) as c FROM obligations').get().c,
    payments: db.prepare('SELECT count(*) as c FROM payments').get().c,
    messages: db.prepare('SELECT count(*) as c FROM messages').get().c,
    docs: db.prepare('SELECT count(*) as c FROM company_documents').get().c
  }

  // 2. Urgent / overdue tasks
  const urgentTasks = db.prepare(
    `SELECT id, title, urgency, deadline, doc_number, account_key FROM tasks
     WHERE urgency IN ('urgent', 'overdue')
     ORDER BY updated_at DESC LIMIT 8`
  ).all()

  // 3. Open obligations
  const openObligations = db.prepare(
    `SELECT title, period, deadline, account_key FROM obligations
     ORDER BY updated_at DESC LIMIT 6`
  ).all()

  // 4. Recent messages
  const recentMessages = db.prepare(
    `SELECT title, received_at, account_key FROM messages
     ORDER BY received_at DESC LIMIT 4`
  ).all()

  // 5. Accounts summary
  const accountsSummary = db.prepare(
    `SELECT a.account_key, a.label, c.name,
     (SELECT COUNT(*) FROM tasks t WHERE t.account_key = a.account_key) as doc_count
     FROM accounts a
     LEFT JOIN companies c ON c.account_key = a.account_key
     WHERE a.enabled = 1
     ORDER BY a.label COLLATE NOCASE LIMIT 12`
  ).all()

  // Render V5 executive email
  const html = renderV5ExecutiveEmail({
    recipientName,
    reportTitle: subject,
    monthKey: '2026-10',
    stats,
    urgentTasks,
    openObligations,
    recentMessages,
    accountsSummary,
    dashboardUrl: 'http://192.168.100.14:3000/board'
  })

  // Extract all available Resend keys for rotation/failover
  const candidateKeys = []
  if (apiKey) candidateKeys.push(apiKey)
  if (process.env.RESEND_API_KEYS) {
    candidateKeys.push(...process.env.RESEND_API_KEYS.split(',').map((k) => k.trim()).filter(Boolean))
  }
  if (process.env.RESEND_API_KEY && !candidateKeys.includes(process.env.RESEND_API_KEY.trim())) {
    candidateKeys.push(process.env.RESEND_API_KEY.trim())
  }

  let lastError = null
  for (const key of candidateKeys) {
    try {
      const fromAddr = process.env.SENDER_EMAIL || 'onboarding@resend.dev'
      const payload = buildExecutiveEmailPayload({
        from: `SAPAuto Secretary <${fromAddr}>`, to, subject, html
      })
      const res = await postHttps('https://api.resend.com/emails', payload, {
        'Authorization': `Bearer ${key}`
      })

      if (res.status >= 200 && res.status < 300) {
        return { ok: true, provider: 'resend', id: res.data.id, recipient: to, html }
      } else {
        lastError = res.data?.message || JSON.stringify(res.data)
      }
    } catch (err) {
      lastError = err.message
    }
  }

  if (candidateKeys.length > 0) {
    return { ok: false, provider: 'resend', error: lastError, html }
  }

  // Fallback to Gmail SMTP if configured
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      const nodemailer = require('nodemailer')
      const transport = nodemailer.createTransport({
        host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.GMAIL_SMTP_PORT || 465),
        secure: true,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
      })

      const info = await transport.sendMail({
        from: `SAPAuto Secretary <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html
      })

      return { ok: true, provider: 'gmail_smtp', id: info.messageId, recipient: to, html }
    } catch (err) {
      return { ok: false, provider: 'gmail_smtp', error: err.message, html }
    }
  }

  return {
    ok: false,
    provider: 'none',
    error: 'لم يتم العثور على مفاتيح Resend صالحة أو إعدادات بريد في .env',
    html
  }
}

module.exports = {
  sendExecutiveReport,
  buildExecutiveEmailPayload
}
