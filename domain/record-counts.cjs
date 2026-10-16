'use strict'

const recordStatus = require('./record-status.cjs')

function getRecordCounts(db, currentTime = new Date()) {
  const today = recordStatus.cairoDateKey(currentTime)
  const tasks = db.prepare('SELECT status,deadline AS date FROM tasks').all()
  const obligations = db.prepare('SELECT status,deadline AS date FROM obligations').all()
  const payments = db.prepare('SELECT status,due_date AS date FROM payments').all()
  const companySyncTimes = db.prepare('SELECT last_scanned_at FROM companies').all()
  const eventDates = db.prepare("SELECT created_at FROM events WHERE kind='new_doc'").all()
  const taskDue = recordStatus.countDue(tasks, 'tasks', today)
  const obligationDue = recordStatus.countDue(obligations, 'obligations', today)
  const paymentDue = recordStatus.countDue(payments, 'payments', today)

  return {
    companies: db.prepare('SELECT COUNT(*) AS n FROM companies').get().n,
    tasks: tasks.filter((task) => recordStatus.isOpenRecord('tasks', task.status)).length,
    obligations: obligations.filter((item) => recordStatus.isOpenRecord('obligations', item.status)).length,
    unknownObligations: obligations.filter((item) =>
      recordStatus.statusDisposition('obligations', item.status) === 'unknown'
    ).length,
    payments: payments.length,
    openPayments: payments.filter((payment) => recordStatus.isOpenRecord('payments', payment.status)).length,
    messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
    unreadMessages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE is_read=0').get().n,
    openFailures: db.prepare('SELECT COUNT(*) AS n FROM failures WHERE resolved_at IS NULL').get().n,
    openAttention: db.prepare("SELECT COUNT(*) AS n FROM assistant_attention WHERE state='open'").get().n,
    users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled=0').get().n,
    linkedChannels: db.prepare(`SELECT COUNT(*) AS n FROM user_channels c
      JOIN users u ON u.id=c.user_id WHERE u.disabled=0 AND c.verified_at IS NOT NULL`).get().n,
    newToday: eventDates.filter((event) => {
      const timestamp = Date.parse(event.created_at)
      return !Number.isNaN(timestamp) && recordStatus.cairoDateKey(new Date(timestamp)) === today
    }).length,
    overdueTasks: taskDue.overdue,
    overdueObligations: obligationDue.overdue,
    overduePayments: paymentDue.overdue,
    dueSoonTasks: taskDue.dueSoon,
    dueSoonObligations: obligationDue.dueSoon,
    dueSoonPayments: paymentDue.dueSoon,
    staleCompanies: companySyncTimes.filter((company) => {
      const timestamp = Date.parse(company.last_scanned_at)
      return Number.isNaN(timestamp) || currentTime.getTime() - timestamp > 24 * 60 * 60 * 1000
    }).length,
    neverScannedCompanies: companySyncTimes.filter((company) => !company.last_scanned_at).length
  }
}

module.exports = { getRecordCounts }
