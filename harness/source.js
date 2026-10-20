'use strict'

/**
 * Account source for the harness (plan 4.1 §4).
 *
 * V8 reads its own accounts table. There is no external directory and no child
 * process: importing legacy credentials is a one-time, explicit step run via
 * `node harness/import-accounts.js`, after which the legacy tree is never
 * touched again.
 */

const { listAccounts: listNativeAccounts } = require('./accounts')
const { getDatabase } = require('../db/connect')

async function listAccounts(db = getDatabase()) {
  const accounts = listNativeAccounts(db)
  if (accounts.length === 0) {
    throw new Error(
      'لا توجد حسابات مسجّلة في V8. استورد الحسابات أولًا عبر: node harness/import-accounts.js')
  }
  return accounts
}

module.exports = { listAccounts }

