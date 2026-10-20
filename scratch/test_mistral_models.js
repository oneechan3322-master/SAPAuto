'use strict'
const https = require('node:https')

const apiKey = 'REDACTED_SEE_ENV_MISTRAL_API_KEY'

const req = https.request('https://api.mistral.ai/v1/models', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json'
  },
  rejectUnauthorized: false
}, (res) => {
  let chunks = []
  res.on('data', d => chunks.push(d))
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString()
    try {
      const json = JSON.parse(text)
      const models = json.data?.map(m => m.id) || text
      console.log('Available Mistral models:', models.filter(m => m.includes('ocr') || m.includes('vision') || m.includes('small') || m.includes('large')))
    } catch {
      console.log('Raw response:', text)
    }
  })
})
req.on('error', e => console.error('Error:', e))
req.end()
