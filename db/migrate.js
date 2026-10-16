'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { getDatabase } = require('./connect')

function runMigrations(db = getDatabase(), directory = path.join(process.env.V8_ROOT || path.resolve(__dirname, '..'), 'db', 'migrations')) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const files = fs.readdirSync(directory).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
  const apply = db.transaction((name, sql) => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) return false
    db.exec(sql)
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString())
    return true
  }).immediate

  const newlyApplied = []
  for (const file of files) {
    if (apply(file, fs.readFileSync(path.join(directory, file), 'utf8'))) {
      newlyApplied.push(file)
      process.stdout.write(`applied ${file}\n`)
    }
  }
  return newlyApplied
}

if (require.main === module) {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
    runMigrations()
  } catch (error) {
    console.error(`Database migration failed: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { runMigrations }
