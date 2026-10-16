'use strict'

const { getDatabase } = require('../../db/connect')
const { createUpgradeProposal, isOpenCodeConfigured } = require('../code-proposals')

module.exports = async ({ request }, { userId, role }) => {
  if (role !== 'Owner') throw new Error('Only an Owner can request a code-upgrade proposal')
  const db = getDatabase()
  const enabled = db.prepare("SELECT value FROM settings WHERE key='opencode_proposals_enabled'").get()?.value === 'true'
  if (!enabled) throw new Error('OpenCode proposals are disabled in Owner settings')
  if (!isOpenCodeConfigured()) throw new Error('OpenCode CLI, model, or sign-in is not configured')
  return createUpgradeProposal({ userId, request, db })
}
