const db = require('./db/connect').getDatabase()
const { classifyTaxObligation } = require('./domain/tax-classifier.cjs')
const rows = db.prepare('SELECT id, title, period, status, raw_json FROM obligations').all()
const breakdown = {}
rows.forEach(r => {
  const c = classifyTaxObligation(r)
  breakdown[c.type.key] = (breakdown[c.type.key] || 0) + 1
})
console.log('TAX CLASSIFICATION BREAKDOWN:')
console.table(breakdown)

console.log('\nSAMPLE RESULTS:')
rows.slice(0, 10).forEach(r => {
  const c = classifyTaxObligation(r)
  console.log(`Original: [${r.title}] -> [${c.officialTitle}] | Code: ${c.formCode} | Type: ${c.type.shortLabel}`)
})
