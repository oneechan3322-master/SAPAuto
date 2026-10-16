'use strict'

const { getDatabase } = require('../../db/connect')

module.exports = async function summarize({ scope = 'all', period = 'today' } = {}) {
  if (!['all', 'tasks', 'obligations', 'payments'].includes(scope)) throw new Error('Unsupported summary scope')
  if (!['today', 'week', 'month'].includes(period)) throw new Error('Unsupported summary period')
  const db = getDatabase()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())
  const overdue = db.prepare(`SELECT COUNT(*) AS n FROM obligations
    WHERE deadline<>'' AND deadline<? AND status NOT IN ('done','submitted','resolved')`).get(today).n
  const due = db.prepare(`SELECT COUNT(*) AS n FROM obligations WHERE deadline>=?
    AND deadline<=date(?, '+7 days') AND status NOT IN ('done','submitted','resolved')`).get(today, today).n
  const tasks = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status<>'done'").get().n
  const failures = db.prepare('SELECT COUNT(*) AS n FROM failures WHERE resolved_at IS NULL').get().n
  return { scope, period, asOf: today, tasks, overdueObligations: overdue, obligationsDueWithin7Days: due, openFailures: failures }
}
