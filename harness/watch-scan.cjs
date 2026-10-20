'use strict'
// §2.A of test.txt — headed browser watch-run of one account.
const { scanAccount } = require('C:/Users/Mega Store/Downloads/SapAuto/v8/harness/scraper')
const { loadScanConfig } = require('C:/Users/Mega Store/Downloads/SapAuto/v8/harness/scraper/config')

const accountKey = process.argv[2] || 'marwanhamada'
const config = loadScanConfig()
config.headedMode = true
config.slowMoMs = 150

console.log('Starting headed scan for:', accountKey)
scanAccount(accountKey, { config })
  .then((result) => {
    console.log('=== SCAN COMPLETE ===')
    console.log('Account:', result.account.key, '|', result.account.label)
    console.log('Login success:', result.login.success)
    console.log('Tasks scraped:', result.tasks.length)
    console.log('Obligations scraped:', result.obligations.length)
    console.log('Messages scraped:', result.messages.length)
    console.log('Payments scraped:', result.payments.length)
  })
  .catch((error) => { console.error('Scan failed:', error); process.exitCode = 1 })
