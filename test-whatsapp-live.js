const { sendMessage } = require('./channels/whatsapp')

async function test() {
  try {
    console.log('Testing WhatsApp delivery...')
    const result = await sendMessage('+201126170117', '«Œ »«— „‰ SAPAuto V8 - «·‰Ÿ«„ Ã«Â“! ??')
    console.log('? WhatsApp message sent successfully!')
    console.log('Message ID:', result.messageId || 'N/A')
  } catch (error) {
    console.error('? WhatsApp test failed:', error.message)
    process.exit(1)
  }
}

test()
