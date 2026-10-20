const db = require('./db/connect').getDatabase()
const titles = db.prepare('SELECT title, COUNT(*) as cnt FROM obligations GROUP BY title ORDER BY cnt DESC').all()
console.log('DISTINCT OBLIGATION TITLES:')
titles.forEach(t => console.log(`- ${t.title} (${t.cnt})`))

const statuses = db.prepare('SELECT status, COUNT(*) as cnt FROM obligations GROUP BY status').all()
console.log('\nSTATUSES:', statuses)

const overdue = db.prepare("SELECT title, deadline, status, account_key FROM obligations WHERE status='overdue' LIMIT 10").all()
console.log('\nSAMPLE OVERDUE:', overdue)

const payrollObs = db.prepare("SELECT title, period, deadline, status FROM obligations WHERE title LIKE '%مرتب%' OR title LIKE '%أجور%' OR title LIKE '%كسب%' LIMIT 5").all()
console.log('\nSAMPLE PAYROLL OBS:', payrollObs)
