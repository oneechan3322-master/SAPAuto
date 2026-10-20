const { createRequire } = require('module')
const r = createRequire(require.resolve('./package.json'))
const db = r('./db/connect').getDatabase()

// accounts schema
const cols = db.prepare("PRAGMA table_info(accounts)").all()
console.log('ACCOUNTS COLS:', cols.map(c => c.name).join(', '))

const accounts = db.prepare("SELECT * FROM accounts ORDER BY rowid").all()
console.log('\nACCOUNTS:', JSON.stringify(accounts, null, 2))

// harness_status schema
const hcols = db.prepare("PRAGMA table_info(harness_status)").all()
console.log('\nHARNESS_STATUS COLS:', hcols.map(c => c.name).join(', '))

const hs = db.prepare("SELECT * FROM harness_status ORDER BY rowid DESC LIMIT 1").get()
console.log('HARNESS STATUS:', JSON.stringify(hs))

// obligations by company counts
const obsByCompany = db.prepare("SELECT account_key, COUNT(*) as n, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_n FROM obligations GROUP BY account_key").all()
console.log('\nOBLIGATIONS BY COMPANY:', JSON.stringify(obsByCompany))

// obligation statuses
const obStatuses = db.prepare("SELECT status, COUNT(*) as n FROM obligations GROUP BY status").all()
console.log('OB STATUSES:', JSON.stringify(obStatuses))

// obligation fields for UI planning
const obSample = db.prepare("SELECT * FROM obligations LIMIT 1").get()
console.log('\nOB FULL SAMPLE KEYS:', Object.keys(obSample || {}).join(', '))

// tasks
const taskStatuses = db.prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status").all()
console.log('\nTASK STATUSES:', JSON.stringify(taskStatuses))
const taskSample = db.prepare("SELECT * FROM tasks LIMIT 1").get()
console.log('TASK SAMPLE KEYS:', Object.keys(taskSample || {}).join(', '))

// payments
const paySample = db.prepare("SELECT * FROM payments LIMIT 1").get()
console.log('\nPAYMENT SAMPLE KEYS:', Object.keys(paySample || {}).join(', '))
const payStatuses = db.prepare("SELECT status, COUNT(*) as n FROM payments GROUP BY status").all()
console.log('PAY STATUSES:', JSON.stringify(payStatuses))
