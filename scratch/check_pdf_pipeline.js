'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { getDatabase } = require('../db/connect')
const db = getDatabase()

console.log('\n=== WHATSAPP STATE ===')
const connected = db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()
const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()
const wakeEnabled = db.prepare("SELECT value FROM settings WHERE key='whatsapp_wake_notifications'").get()
const selfAccount = db.prepare("SELECT value FROM settings WHERE key='whatsapp_self_account'").get()
console.log('connected:', connected?.value)
console.log('control_number:', controlNumber?.value)
console.log('wake_notifications:', wakeEnabled?.value)
console.log('self_account:', selfAccount?.value)

console.log('\n=== PDF FILES AVAILABLE ===')
const tasks = db.prepare('SELECT id, title, deadline, pdf_path FROM tasks WHERE pdf_path IS NOT NULL LIMIT 10').all()
let validPdfs = 0
for (const task of tasks) {
  const exists = task.pdf_path && fs.existsSync(task.pdf_path)
  if (exists) validPdfs++
  console.log(`  [${exists ? '✅' : '❌'}] ${task.title?.slice(0, 50)} — ${task.pdf_path}`)
}
console.log(`\nTotal valid PDFs on disk: ${validPdfs}/${tasks.length}`)

console.log('\n=== RECENT COMMANDS ===')
const cmds = db.prepare('SELECT id, type, status, result, created_at FROM commands ORDER BY created_at DESC LIMIT 5').all()
for (const c of cmds) {
  console.log(`  ${c.type} | ${c.status} | ${String(c.result || '').slice(0, 80)} | ${c.created_at}`)
}

console.log('\n=== PENDING wake_send_document ===')
const pending = db.prepare("SELECT * FROM commands WHERE type='wake_send_document' AND status='queued'").all()
console.log(pending.length ? pending : 'none queued')

console.log('\n=== PATH CHECK ===')
const { localDataRoot } = require('../assistant/paths.cjs')
console.log('localDataRoot:', localDataRoot())
