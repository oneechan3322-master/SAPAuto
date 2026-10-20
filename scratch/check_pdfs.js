'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { getDatabase } = require('../db/connect')
const db = getDatabase()

// Check all tasks with pdf_path
const all = db.prepare('SELECT id, title, pdf_path, updated_at FROM tasks WHERE pdf_path IS NOT NULL AND pdf_path != \'\' ORDER BY updated_at DESC LIMIT 30').all()
console.log('\n=== ALL TASKS WITH pdf_path SET ===')
let valid = 0, missing = 0
for (const t of all) {
  const exists = fs.existsSync(t.pdf_path)
  if (exists) valid++; else missing++
  console.log(`${exists ? '✅' : '❌'} | ${String(t.title).slice(0, 45)} | ${t.pdf_path}`)
}
console.log(`\n✅ Valid: ${valid}  ❌ Missing path: ${missing}`)

// Check the actual pdfs directory
console.log('\n=== FILES IN data/pdfs/ ===')
const pdfDir = path.join(__dirname, '..', 'data', 'pdfs')
if (fs.existsSync(pdfDir)) {
  const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.PDF') || f.endsWith('.pdf'))
  console.log(`${files.length} PDF files found:`)
  for (const f of files) {
    const fpath = path.join(pdfDir, f)
    const size = fs.statSync(fpath).size
    console.log(`  ${f.slice(0, 60)} (${Math.round(size/1024)} KB)`)
  }
} else {
  console.log('data/pdfs directory does not exist!')
}

// Show ONE valid task we can test with
const validTask = all.find(t => fs.existsSync(t.pdf_path))
if (validTask) {
  console.log('\n=== VALID TASK FOR TESTING ===')
  console.log('id:', validTask.id)
  console.log('title:', validTask.title)
  console.log('path:', validTask.pdf_path)
}
