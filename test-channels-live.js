require('dotenv').config()
const db = require('better-sqlite3')('./data/sapauto.db')

async function testChannels() {
  console.log('\n=== SAPAuto V8 Channel Delivery Test ===\n')
  
  // Check WhatsApp status
  const waConnected = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_connected')?.value === 'true'
  const waAccount = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_account_number')?.value
  const controlNumber = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_control_number')?.value
  
  console.log('?? WhatsApp Status:')
  console.log('  Connected:', waConnected ? '? YES' : '? NO')
  console.log('  Account:', waAccount || 'Not set')
  console.log('  Control:', controlNumber || 'Not set')
  console.log(`  Mode: ${process.env.V8_MESSAGE_MODE || 'dry-run'}`)
  
  // Check email status
  console.log('\n?? Email Status:')
  console.log('  Resend API:', process.env.RESEND_API_KEY ? '? Configured' : '? Not set')
  console.log('  Sender:', process.env.SENDER_EMAIL || 'Not set')
  console.log('  Recipient:', process.env.RECIPIENT_EMAIL || 'Not set')
  
  if (!waConnected) {
    console.log('\n??  WhatsApp is not connected. Check PM2 logs: pm2 logs sapauto-v8-channels')
    process.exit(1)
  }
  
  // Test WhatsApp delivery
  if (waConnected && controlNumber) {
    try {
      console.log('\n?? Testing WhatsApp delivery...')
      const { sendMessage } = require('./channels/whatsapp')
      const result = await sendMessage(controlNumber, `«Œ »«— SAPAuto V8\n«·Êﬁ : ${new Date().toLocaleString('ar-EG')}\n«·‰Ÿ«„ Ã«Â“! ??`)
      console.log('? WhatsApp message sent successfully!')
      console.log('   Message ID:', result.messageId || 'N/A')
    } catch (error) {
      console.error('? WhatsApp delivery failed:', error.message)
    }
  }
  
  // Test email delivery with Resend
  if (process.env.RESEND_API_KEY && process.env.RECIPIENT_EMAIL) {
    try {
      console.log('\n?? Testing Resend email delivery...')
      const fetch = (await import('node-fetch')).default
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.SENDER_EMAIL || 'onboarding@resend.dev',
          to: process.env.RECIPIENT_EMAIL,
          subject: 'SAPAuto V8 - «Œ »«— «·‰Ÿ«„',
          text: `«Œ »«— „‰ SAPAuto V8\n\n«·Êﬁ : ${new Date().toLocaleString('ar-EG')}\n\n«·‰Ÿ«„ Ã«Â“ ··⁄„·! ??`
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        console.log('? Email sent successfully!')
        console.log('   Email ID:', data.id)
      } else {
        const error = await response.text()
        console.error('? Email delivery failed:', error)
      }
    } catch (error) {
      console.error('? Email test failed:', error.message)
    }
  } else {
    console.log('\n??  Resend not configured - skipping email test')
  }
  
  console.log('\n=== Test Complete ===\n')
  db.close()
}

testChannels()
