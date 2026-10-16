'use strict'

const { createCommand } = require('../../db/queries/commands')
const { listAccounts } = require('../../harness/source')

module.exports = async function scanNow({ account = '' } = {}, context) {
  if (typeof account !== 'string' || account.length > 150) throw new Error('Invalid account key')
  if (account) {
    const configured = await listAccounts()
    const selected = configured.find((item) => item.username.toLowerCase() === account.toLowerCase())
    if (!selected) throw new Error('That scan account is not configured in SAPAuto3')
    account = selected.username
  }
  return { commandId: createCommand('scan_now', account ? { account } : {}, context.userId), status: 'queued' }
}
