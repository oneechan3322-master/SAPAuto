'use strict';

// One-time backfill (and manual re-run) for the company folder mirror:
// creates data/companies/<company>/ and copies every real task PDF inside.
// Safe to re-run: idempotent, additive only, never deletes anything.
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
if (!process.env.DB_PATH) {
  const dataDir = path.join(root, 'data')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  process.env.DB_PATH = path.join(dataDir, 'sapauto.db')
}

const { openDatabase } = require(path.join(root, 'db', 'connect'))
const { runMigrations } = require(path.join(root, 'db', 'migrate'))
const { syncCompanyFolders } = require(path.join(root, 'domain', 'company-folders.cjs'))

const db = openDatabase(process.env.DB_PATH)
try {
  runMigrations(db)
  const stats = syncCompanyFolders(db)
  console.log(JSON.stringify(stats, null, 2))
} finally {
  db.close()
}
