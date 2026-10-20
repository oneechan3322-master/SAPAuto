const { scanAccount } = require('./harness/scraper')
const { getDatabase } = require('./db/connect')
const { ingestAccount } = require('./harness/ingest')

async function testOne() {
  console.log('Testing scanAccount for marwanhamada...')
  const start = Date.now()
  try {
    const result = await scanAccount('marwanhamada')
    const elapsed = Math.round((Date.now() - start) / 1000)
    console.log(`Scan completed in ${elapsed}s!`)
    console.log('Login success:', result.login && result.login.success)
    console.log('Tasks:', result.tasks.length)
    console.log('Obligations:', result.obligations.length)
    console.log('Messages:', result.messages.length)
    console.log('Payments:', result.payments.length)
    
    // Ingest into DB
    const db = getDatabase()
    ingestAccount(result, db)
    console.log('Successfully ingested into SQLite database!')
  } catch (err) {
    console.error('Scan error:', err.message)
  }
}

testOne()
