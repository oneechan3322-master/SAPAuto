'use strict'

const { getDatabase } = require('../../db/connect')

module.exports = async function listDocuments() {
  const db = getDatabase()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())
  const documents = db.prepare(`SELECT id, account_key, doc_number, title, deadline, status, pdf_path
    FROM tasks WHERE status<>'done' ORDER BY updated_at DESC LIMIT 15`).all()
    .map((row) => ({
      id: row.id,
      account: row.account_key,
      doc_number: row.doc_number,
      title: row.title,
      deadline: row.deadline,
      has_pdf: Boolean(row.pdf_path)
    }))
  const where = "deadline<>'' AND status NOT IN ('done','submitted','resolved')"
  const upcoming = db.prepare(`SELECT id,title,deadline,status FROM obligations
    WHERE ${where} AND deadline>=? ORDER BY deadline ASC LIMIT 8`).all(today)
  const overdue = db.prepare(`SELECT id,title,deadline,status FROM obligations
    WHERE ${where} AND deadline<? ORDER BY deadline DESC LIMIT 8`).all(today)
  return { documents, upcoming, overdue }
}
