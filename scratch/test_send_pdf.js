'use strict'
const { getDatabase } = require('../db/connect')
const { id, now } = require('../db/queries/shared')
const db = getDatabase()

// Use the first valid PDF task
const task = db.prepare('SELECT id, title, deadline, pdf_path FROM tasks WHERE id=?').get('tasks_362b02a924da6eb7a364f183')
if (!task) { console.error('Task not found!'); process.exit(1) }

const commandId = id('wake_pdf_test')
db.prepare("INSERT INTO commands(id,type,payload,requested_by,status,result,created_at) VALUES(?,?,?,?,'queued','',?)")
  .run(commandId, 'wake_send_document', JSON.stringify({ taskId: task.id }), 'system', now())

console.log('✅ Queued wake_send_document command:')
console.log('  commandId:', commandId)
console.log('  taskId:', task.id)
console.log('  title:', task.title)
console.log('  pdf_path:', task.pdf_path)
console.log('\nWaiting for channels process to pick up (polling up to 60s)...')

// Poll for result
const started = Date.now()
const interval = setInterval(() => {
  const cmd = db.prepare('SELECT status, result FROM commands WHERE id=?').get(commandId)
  const elapsed = Math.round((Date.now() - started) / 1000)
  process.stdout.write(`\r  [${elapsed}s] status: ${cmd?.status}          `)
  if (!cmd || cmd.status === 'queued' || cmd.status === 'running') return
  clearInterval(interval)
  console.log('\n\n=== RESULT ===')
  console.log('status:', cmd.status)
  console.log('result:', cmd.result)
  if (cmd.status === 'done') {
    console.log('\n✅ PDF sent successfully via WhatsApp!')
  } else {
    console.log('\n❌ PDF send FAILED. Reason above.')
  }
  process.exit(0)
}, 2000)

// Max 60s then timeout
setTimeout(() => {
  clearInterval(interval)
  const cmd = db.prepare('SELECT status, result FROM commands WHERE id=?').get(commandId)
  console.log('\n⏰ TIMEOUT after 60s. Final status:', cmd?.status, cmd?.result)
  process.exit(1)
}, 60000)
