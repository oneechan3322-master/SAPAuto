'use strict'

/**
 * One-time import of portal accounts into V8's native accounts store
 * (plan 4.1 §4). Reads the legacy SAPAuto3 accounts.txt format, encrypts each
 * password with AES-256-GCM, and upserts into the `accounts` table. After this
 * runs, V8 never reads ../SAPAuto3 again.
 *
 * Usage:
 *   node harness/import-accounts.js [path/to/accounts.txt]
 *
 * Default source: ../SAPAuto3/accounts.txt relative to the V8 root (the
 * V8_BASE_DIR override is honored). Lines are "username|password" or
 * "Label|username|password"; "#" lines are comments. Re-running is safe:
 * existing accounts are updated in place.
 */

const fs = require('node:fs')
const path = require('node:path')
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { upsertAccount, resolveAccountsKey } = require('./accounts')
const { KNOWN_ACCOUNT_ALIASES } = require('./scraper/config/accounts-parser')

function defaultSourcePath() {
  const v8Root = process.env.V8_ROOT || path.resolve(__dirname, '..')
  return path.resolve(v8Root, process.env.V8_BASE_DIR || '../SAPAuto3', 'accounts.txt')
}

function parseAccountLines(content) {
  const accounts = []
  const errors = []
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split('|').map((part) => part.trim())
    if (parts.length < 2) {
      errors.push({ line: index + 1, error: 'Expected username|password' })
      continue
    }
    let username = ''
    let password = ''
    let label = ''
    if (parts.length === 2) {
      ;[username, password] = parts
      label = KNOWN_ACCOUNT_ALIASES[username] || username
    } else {
      // Same disambiguation the legacy parser used: a leading handle means the
      // remaining parts belong to the password; otherwise it is label|user|pass.
      if (parts[0].includes('@') || parts[0].includes('.com') || parts[0].includes('.eg')) {
        username = parts[0]
        password = parts.slice(1).join('|')
        label = KNOWN_ACCOUNT_ALIASES[username] || username
      } else {
        label = parts[0]
        username = parts[1]
        password = parts.slice(2).join('|')
      }
    }
    if (!username || !password) {
      errors.push({ line: index + 1, error: 'Missing username or password' })
      continue
    }
    accounts.push({ username, label: label || username, password })
  }
  return { accounts, errors }
}

function importAccounts(sourcePath = defaultSourcePath(), db = getDatabase()) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Accounts file not found: ${sourcePath}`)
  }
  runMigrations(db)
  const key = resolveAccountsKey()
  const { accounts, errors } = parseAccountLines(fs.readFileSync(sourcePath, 'utf8'))
  if (errors.length > 0) {
    throw new Error(`Refusing to import: ${errors.length} malformed line(s) at ${sourcePath} ` +
      `(lines ${errors.map((item) => item.line).join(', ')})`)
  }
  if (accounts.length === 0) throw new Error(`No accounts found in ${sourcePath}`)
  const imported = db.transaction((rows) => {
    let count = 0
    for (const account of rows) {
      upsertAccount(account, db, key)
      count += 1
    }
    return count
  })(accounts)
  return { imported, sourcePath }
}

if (require.main === module) {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
    const source = process.argv[2] ? path.resolve(process.argv[2]) : defaultSourcePath()
    const outcome = importAccounts(source)
    process.stdout.write(`Imported ${outcome.imported} account(s) from ${outcome.sourcePath}\n`)
  } catch (error) {
    console.error(`Account import failed: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { defaultSourcePath, importAccounts, parseAccountLines }
