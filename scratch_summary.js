const db = require('./db/connect').getDatabase()
const accs = ['marwanhamada', '205971997', '315240679', '533158788']
const rows = accs.map(k => {
  const comp = db.prepare('SELECT name FROM companies WHERE account_key=?').get(k)
  const obs = db.prepare('SELECT COUNT(*) as n FROM obligations WHERE account_key=?').get(k).n
  const tasks = db.prepare('SELECT COUNT(*) as n FROM tasks WHERE account_key=?').get(k).n
  const msgs = db.prepare('SELECT COUNT(*) as n FROM messages WHERE account_key=?').get(k).n
  const pays = db.prepare('SELECT COUNT(*) as n FROM payments WHERE account_key=?').get(k).n
  const lastScanned = db.prepare('SELECT last_scanned_at FROM companies WHERE account_key=?').get(k)?.last_scanned_at
  return {
    account: k,
    company: (comp?.name || '').substring(0, 30),
    obligations: obs,
    tasks,
    messages: msgs,
    payments: pays,
    lastScanned: lastScanned || 'pending'
  }
})
console.table(rows)
