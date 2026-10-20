require('dotenv').config()

async function testResendEmail() {
  console.log('\n=== Testing Resend Email Delivery ===\n')
  
  console.log('📧 Resend Configuration:')
  console.log('  API Key:', process.env.RESEND_API_KEY ? '✅ Configured' : '❌ Not set')
  console.log('  From:', process.env.SENDER_EMAIL || 'onboarding@resend.dev')
  console.log('  To:', process.env.RECIPIENT_EMAIL || 'Not set')
  
  if (!process.env.RESEND_API_KEY || !process.env.RECIPIENT_EMAIL) {
    console.log('\n❌ Resend not fully configured')
    return
  }
  
  try {
    const https = require('https')
    
    const data = JSON.stringify({
      from: process.env.SENDER_EMAIL || 'onboarding@resend.dev',
      to: process.env.RECIPIENT_EMAIL,
      subject: 'SAPAuto V8 - اختبار النظام ✅',
      html: `
        <div dir="rtl" style="font-family: 'Arial', sans-serif; padding: 20px;">
          <h2 style="color: #16a34a;">✅ اختبار SAPAuto V8 نجح!</h2>
          <p><strong>الوقت:</strong> ${new Date().toLocaleString('ar-EG', {timeZone: 'Africa/Cairo'})}</p>
          <p><strong>النظام:</strong> SAPAuto V8 Mission Control</p>
          <p><strong>حالة البريد:</strong> جاهز للإرسال</p>
          <p><strong>حالة واتساب:</strong> متصل ويعمل</p>
          <hr />
          <p style="color: #666;">هذه رسالة اختبار تلقائية من نظام SAPAuto V8</p>
        </div>
      `
    })
    
    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }
    
    console.log('\n🚀 Sending email...')
    
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(body)
          console.log('✅ Email sent successfully!')
          console.log('  Email ID:', result.id)
          console.log('\n📬 Check your inbox:', process.env.RECIPIENT_EMAIL)
        } else {
          console.error('❌ Email failed:', res.statusCode, body)
        }
      })
    })
    
    req.on('error', (error) => {
      console.error('❌ Request failed:', error.message)
    })
    
    req.write(data)
    req.end()
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

testResendEmail()
