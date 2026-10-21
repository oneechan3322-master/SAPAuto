'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

let singleton

function resolveDatabasePath(value = process.env.V8_DB_PATH) {
  const root = process.env.V8_ROOT || path.resolve(__dirname, '..')
  const configured = value || path.join(root, 'data', 'sapauto.db')
  return path.isAbsolute(configured) ? configured : path.resolve(root, configured)
}

function openDatabase(filePath = resolveDatabasePath()) {
  const resolved = resolveDatabasePath(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const db = new Database(resolved, { timeout: 5000 })
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')
  db.pragma('wal_autocheckpoint = 1000')
  return db
}

function getDatabase() {
  if (!singleton || !singleton.open) singleton = openDatabase()
  return singleton
}

/** Write transaction that grabs the write lock up front (avoids BUSY lock upgrades). */
function writeTx(fn, db = getDatabase()) {
  return db.transaction(fn).immediate()
}

function checkpointDb() {
  if (!singleton || !singleton.open) return
  try { singleton.pragma('wal_checkpoint(TRUNCATE)'); } catch { }
}

function closeDatabase() {
  if (!singleton || !singleton.open) return
  try { checkpointDb(); } finally { singleton.close(); singleton = null; }
}

module.exports = { getDatabase, openDatabase, resolveDatabasePath, writeTx, checkpointDb, closeDatabase }
