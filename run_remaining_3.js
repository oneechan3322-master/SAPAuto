const { scanAccount } = require('./harness/scraper')
const { getDatabase } = require('./db/connect')
const { ingestAccount } = require('./harness/ingest')

const ACCOUNTS = [
  { key: '205971997', name: 'Chemora (كيمورا)' },
  { key: '315240679', name: 'King Kissing (كينج كيسينج)' },
  { key: '533158788', name: 'Glob Chem (جلوب كيم)' }
]

async function runRemaining() {
  const db = getDatabase()
  console.log(`=== STARTING LIVE SCAN OF REMAINING 3 ACCOUNTS UNDER WATCH ===`)
  
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const { key, name } = ACCOUNTS[i]
    console.log(`\n-----------------------------------------------------------`)
    console.log(`[${i+1}/3] Scanning Account: ${key} (${name})...`)
    const start = Date.now()
    try {
      const result = await scanAccount(key)
      const elapsed = Math.round((Date.now() - start) / 1000)
      console.log(`✓ Scan finished in ${elapsed}s for ${key}`)
      console.log(`  Login success: ${result.login && result.login.success}`)
      console.log(`  Tasks: ${result.tasks.length}`)
      console.log(`  Obligations: ${result.obligations.length}`)
      console.log(`  Messages: ${result.messages.length}`)
      console.log(`  Payments: ${result.payments.length}`)
      
      ingestAccount(result, db)
      console.log(`  ✓ Data ingested into SQLite database!`)
    } catch (err) {
      console.error(`✗ Error scanning ${key}: ${err.message}`)
    }
  }
  console.log(`\n=== ALL 3 ACCOUNTS COMPLETED LIVE ===`)
}

runRemaining().catch(console.error)
