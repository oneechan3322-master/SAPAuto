require('dotenv').config()
const db = require('better-sqlite3')('./data/sapauto.db')

async function testChannelCommands() {
  console.log('\n=== Testing WhatsApp Delivery via V8 Command Queue ===\n')
  
  // Check current status
  const waConnected = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_connected')?.value === 'true'
  console.log('WhatsApp connected:', waConnected ? '✅' : '❌')
  
  if (!waConnected) {
    console.log('\n⏱️  WhatsApp is still connecting. Wait 10 seconds and try again.')
    db.close()
    return
  }
  
  // Create a test delivery command
  const timestamp = new Date().toISOString()
  const commandId = `test-wa-${Date.now()}`
  
  db.prepare(`
    INSERT INTO commands(id, type, status, payload, created_at, updated_at, requested_by)
    VALUES(?, 'channel_test_message', 'queued', ?, ?, ?, 'system-test')
  `).run(
    commandId,
    JSON.stringify({
      channel: 'whatsapp',
      to: '+201126170117',
      text: `اختبار SAPAuto V8\nالوقت: ${new Date().toLocaleString('ar-EG')}\nالنظام جاهز! 🚀`
    }),
    timestamp,
    timestamp
  )
  
  console.log('✅ Test command queued:', commandId)
  console.log('⏳ Waiting for delivery...\n')
  
  // Poll for result
  for (let i = 0; i < 15; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    const command = db.prepare('SELECT status, result FROM commands WHERE id=?').get(commandId)
    
    if (command.status === 'done') {
      console.log('\n✅ WhatsApp message delivered successfully!')
      console.log('Result:', command.result)
      db.close()
      return
    }
    
    if (command.status === 'failed') {
      console.error('\n❌ Delivery failed:', command.result)
      db.close()
      process.exit(1)
    }
    
    process.stdout.write(`.`)
  }
  
  console.log('\n⏱️  Timeout')
  db.close()
}

testChannelCommands().catch(console.error)
