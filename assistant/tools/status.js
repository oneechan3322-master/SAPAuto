'use strict'

const { getDatabase } = require('../../db/connect')

module.exports = async function status() {
  const db = getDatabase()
  return {
    harness: db.prepare('SELECT state,current_account,account_index,account_total,last_heartbeat,next_cycle_at,paused FROM harness_status WHERE id=1').get(),
    companies: db.prepare('SELECT COUNT(*) AS count FROM companies').get().count,
    openTasks: db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status<>'done'").get().count,
    openObligations: db.prepare("SELECT COUNT(*) AS count FROM obligations WHERE status NOT IN ('done','submitted','resolved')").get().count,
    failures: db.prepare('SELECT COUNT(*) AS count FROM failures WHERE resolved_at IS NULL').get().count
  }
}
