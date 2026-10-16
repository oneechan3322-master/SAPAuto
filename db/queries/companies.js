'use strict'

const { getDatabase } = require('../connect')

function listCompanies(db = getDatabase()) {
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM tasks t
    WHERE t.company_id = c.id AND t.status <> 'done') AS open_tasks
    FROM companies c ORDER BY c.name`).all()
}

function getCompany(accountKey, db = getDatabase()) {
  return db.prepare('SELECT * FROM companies WHERE account_key = ?').get(accountKey) || null
}

module.exports = { listCompanies, getCompany }
