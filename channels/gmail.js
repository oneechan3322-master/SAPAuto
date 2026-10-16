'use strict'

const { ImapFlow } = require('imapflow')
const { simpleParser } = require('mailparser')
const nodemailer = require('nodemailer')
const { getDatabase } = require('../db/connect')
const { runAssistant } = require('../assistant/run')
const { boundedText } = require('../domain/bounded-text.cjs')
const { consumeLinkCode, linkedUser, allowUnlinkedReply } = require('./link-codes')

function smtpTransport() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are required')
  return nodemailer.createTransport({
    host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.GMAIL_SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    disableFileAccess: true,
    disableUrlAccess: true
  })
}

async function sendGmail(to, text) {
  const transport = smtpTransport()
  await transport.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: 'SAPAuto V8',
    text,
    disableFileAccess: true,
    disableUrlAccess: true
  })
}

async function processMail(message, db = getDatabase()) {
  const parsed = await simpleParser(message.source)
  const sender = parsed.from?.value?.[0]?.address?.toLowerCase()
  if (!sender) throw new Error('Incoming mail has no valid sender')
  const text = String(parsed.text || '').trim().slice(0, 4000)
  const code = text.match(/^link\s+(\d{6})\s*$/i)
  if (code) {
    const linked = consumeLinkCode('email', sender, code[1], db)
    await sendGmail(sender, linked ? 'تم ربط البريد بنجاح.' : 'رمز الربط غير صالح أو انتهت صلاحيته.')
    return
  }
  const user = linkedUser('email', sender, db)
  if (!user || user.disabled) {
    if (allowUnlinkedReply('email', sender, db)) await sendGmail(sender, 'اطلب من مالك SAPAuto رمز ربط قبل إرسال الطلبات.')
    return
  }
  const result = await runAssistant({ userId: user.userId, role: user.role, text })
  await sendGmail(sender, boundedText(result.reply, 10000))
}

async function pollMailboxOnce({ db = getDatabase() } = {}) {
  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false
  })
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const uids = await client.search({ seen: false }, { uid: true })
    for await (const message of client.fetch(uids.slice(-50), { uid: true, source: true }, { uid: true })) {
      await processMail(message, db)
      await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true })
    }
  } finally {
    lock.release()
    await client.logout()
  }
}

function startGmailPoller({ intervalMs = 120000, db = getDatabase() } = {}) {
  let busy = false
  const poll = async () => {
    if (busy) return
    busy = true
    try { await pollMailboxOnce({ db }) }
    catch (error) { console.error(`Gmail poll failed: ${error.message}`) }
    finally { busy = false }
  }
  void poll()
  const timer = setInterval(poll, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

module.exports = { sendGmail, processMail, pollMailboxOnce, startGmailPoller }
