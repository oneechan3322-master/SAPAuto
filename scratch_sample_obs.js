const db = require('./db/connect').getDatabase()
const rows = db.prepare('SELECT title, period, deadline, status, required_doc, ai_risk_score, raw_json FROM obligations LIMIT 15').all()
rows.forEach((r, i) => {
  let raw = {}
  try { raw = JSON.parse(r.raw_json || '{}') } catch(e) {}
  console.log(`[${i+1}] Title: ${r.title} | Period: ${r.period} | Deadline: ${r.deadline} | Status: ${r.status} | TaxType: ${raw.taxType || raw.taxLabel} | Form: ${raw.formLabel}`)
})
