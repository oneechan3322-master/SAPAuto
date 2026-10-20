'use strict'
const fs = require('node:fs')
const https = require('node:https')

const apiKey = process.env.MISTRAL_API_KEY || 'REDACTED-USE-ENV'
const pdfPath = 'C:\\Users\\Mega Store\\Downloads\\SapAuto\\v8\\data\\pdfs\\ملاحظات قبول-٩٣٣٠٠٠٠٢٨١٣٨.PDF'
const pdfBuffer = fs.readFileSync(pdfPath)
const base64Pdf = pdfBuffer.toString('base64')

const payload = JSON.stringify({
  model: 'mistral-ocr-latest',
  document: {
    type: 'document_url',
    document_url: `data:application/pdf;base64,${base64Pdf}`
  }
})

console.log('Sending PDF to Mistral OCR (size:', Math.round(pdfBuffer.length / 1024), 'KB)...')

const req = https.request('https://api.mistral.ai/v1/ocr', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  },
  rejectUnauthorized: false
}, (res) => {
  let chunks = []
  res.on('data', d => chunks.push(d))
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString()
    console.log('Status:', res.statusCode)
    try {
      const json = JSON.parse(text)
      if (json.pages && json.pages[0]) {
        console.log('\n=== OCR RESULT (Page 1 Markdown) ===\n')
        console.log(json.pages[0].markdown.slice(0, 1500))
      } else {
        console.log('Response:', JSON.stringify(json, null, 2).slice(0, 500))
      }
    } catch {
      console.log('Raw response:', text.slice(0, 500))
    }
  })
})

req.on('error', e => console.error('Error:', e))
req.write(payload)
req.end()
