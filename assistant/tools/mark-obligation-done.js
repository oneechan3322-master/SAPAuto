'use strict'

const { markDone } = require('../../db/queries/obligations')

module.exports = async function markObligationDone({ obligation_id, evidence = '' }, context) {
  if (typeof obligation_id !== 'string' || !obligation_id || evidence.length > 2000) throw new Error('Invalid obligation update')
  const changed = markDone(obligation_id, context.userId, evidence)
  if (!changed) throw new Error('Obligation was not found')
  return { updated: true, portalChanged: false }
}
