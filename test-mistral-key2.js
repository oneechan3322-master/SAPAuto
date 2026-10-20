require('dotenv').config()

async function testMistralWithSecondKey() {
  console.log('\n=== Testing Mistral with Secondary API Key ===\n')
  
  const keys = process.env.MISTRAL_API_KEYS?.split(',').map(k => k.trim()) || []
  console.log('Available keys:', keys.length)
  
  if (keys.length < 2) {
    console.log('❌ No secondary key available')
    return
  }
  
  const secondKey = keys[1]
  console.log('Testing key:', secondKey.slice(0, 15) + '...')
  
  try {
    console.log('🚀 Sending test request...')
    
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${secondKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'user',
            content: 'قل: اختبار ناجح'
          }
        ]
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      console.error('❌ API error:', response.status, error)
      return
    }
    
    const result = await response.json()
    const message = result.choices?.[0]?.message
    
    if (message) {
      console.log('✅ Mistral secondary key working!')
      console.log('Response:', message.content)
      console.log('\n💡 Update .env: MISTRAL_API_KEY=' + secondKey)
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

testMistralWithSecondKey()
