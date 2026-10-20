require('dotenv').config()
const db = require('better-sqlite3')('./data/sapauto.db')

async function testWhatsAppDelivery() {
  console.log('\n=== Testing WhatsApp Live Delivery ===\n')
  
  const waConnected = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_connected')?.value === 'true'
  const waAccount = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_account_number')?.value
  const controlNumber = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_control_number')?.value
  const messageMode = process.env.V8_MESSAGE_MODE || 'dry-run'
  
  console.log('📱 WhatsApp Status:')
  console.log('  Connected:', waConnected ? '✅ YES' : '❌ NO')
  console.log('  Account:', waAccount || 'Not set')
  console.log('  Control:', controlNumber || 'Not set')
  console.log('  Mode:', messageMode)
  
  if (!waConnected) {
    console.log('\n⏱️  WhatsApp not ready yet. Check: pm2 logs sapauto-v8-channels')
    db.close()
    return
  }
  
  // Queue test message
  const timestamp = new Date().toISOString()
  const commandId = `test-wa-${Date.now()}`
  
  db.prepare(`
    INSERT INTO commands(id, type, status, payload, created_at, requested_by)
    VALUES(?, 'channel_test_message', 'queued', ?, ?, 'system-test')
  `).run(
    commandId,
    JSON.stringify({
      channel: 'whatsapp',
      to: controlNumber,
      text: `اختبار SAPAuto V8\nالوقت: ${new Date().toLocaleString('ar-EG')}\nالنظام جاهز! 🚀`
    }),
    timestamp
  )
  
  console.log('\n✅ Command queued:', commandId)
  console.log('⏳ Waiting for delivery (max 30s)...\n')
  
  // Poll result
  for (let i = 0; i < 15; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const cmd = db.prepare('SELECT status, result FROM commands WHERE id=?').get(commandId)
    
    if (cmd.status === 'done') {
      console.log('\n✅ WhatsApp message delivered!')
      console.log('Result:', cmd.result || 'OK')
      db.close()
      return
    }
    
    if (cmd.status === 'failed') {
      console.error('\n❌ Delivery failed:', cmd.result)
      db.close()
      process.exit(1)
    }
    
    process.stdout.write(`.`)
  }
  
  console.log('\n⏱️  Timeout')
  db.close()
}

testWhatsAppDelivery().catch(console.error)
