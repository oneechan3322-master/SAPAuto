'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { extractPdfText } = require('../assistant/pdf-reader.cjs')

const pdfDir = path.join(__dirname, '..', 'data', 'pdfs')
const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.PDF') || f.endsWith('.pdf')).slice(0, 10)

async function testAll() {
  for (const f of files) {
    const fullPath = path.join(pdfDir, f)
    try {
      const res = await extractPdfText(fullPath)
      const text = res.text || ''
      console.log(`\n========================================`)
      console.log(`FILE: ${f}`)
      console.log(`LENGTH: ${text.length} chars`)
      console.log(`FIRST 300 CHARS:`)
      console.log(text.slice(0, 300))
    } catch (e) {
      console.log(`FILE: ${f} -> ERROR: ${e.message}`)
    }
  }
}

testAll().catch(console.error)
