require('dotenv').config()

async function testMistral() {
  console.log('\n=== Testing Mistral AI ===\n')
  
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) {
    console.error('❌ MISTRAL_API_KEY not set')
    return
  }
  
  console.log('AI Provider:', process.env.AI_PROVIDER)
  console.log('Cloud allowed:', process.env.AI_ALLOW_CLOUD)
  console.log('Mistral model:', process.env.MISTRAL_MODEL)
  console.log('API Key:', apiKey.slice(0, 15) + '...')
  
  try {
    console.log('\n🚀 Sending test request to Mistral...')
    
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
        messages: [
          {
            role: 'user',
            content: 'مرحبًا! هل يمكنك الرد بالعربية؟ قل فقط "اختبار ناجح"'
          }
        ]
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      console.error('❌ Mistral API error:', response.status, error)
      return
    }
    
    const result = await response.json()
    const message = result.choices && result.choices[0] && result.choices[0].message
    
    if (message) {
      console.log('✅ Mistral response received!')
      console.log('Response:', message.content)
    } else {
      console.error('❌ Invalid response format:', JSON.stringify(result, null, 2))
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

testMistral()
