'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { getDatabase } = require('./connect')

function checksumOf(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex')
}

function runMigrations(db = getDatabase(), directory = path.join(process.env.V8_ROOT || path.resolve(__dirname, '..'), 'db', 'migrations')) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  // checksum column added when migrations gain integrity verification (Opus5.5 §6.8).
  const columns = db.prepare('PRAGMA table_info(schema_migrations)').all().map((col) => col.name)
  if (!columns.includes('checksum')) {
    db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT')
  }

  const files = fs.readdirSync(directory).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
  const apply = db.transaction((name, sql) => {
    const known = db.prepare('SELECT checksum FROM schema_migrations WHERE name = ?').get(name)
    if (known) {
      const sum = checksumOf(sql)
      // Existing ledger rows apply their checksum on first run after upgrade (baseline backfill).
      if (!known.checksum) {
        db.prepare('UPDATE schema_migrations SET checksum = ? WHERE name = ?').run(sum, name)
        return false
      }
      if (known.checksum !== sum) {
        throw new Error(`Migration ${name} was edited after it was applied (checksum ${sum.slice(0, 12)}… ≠ stored ${known.checksum.slice(0, 12)}…)`)
      }
      return false
    }
    db.exec(sql)
    db.prepare('INSERT INTO schema_migrations (name, applied_at, checksum) VALUES (?, ?, ?)')
      .run(name, new Date().toISOString(), checksumOf(sql))
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
