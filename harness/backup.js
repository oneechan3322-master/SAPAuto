'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { getDatabase, resolveDatabasePath } = require('../db/connect')

async function createBackup({ db = getDatabase(), directory = path.join(__dirname, '..', 'data', 'backups'), keep = 14 } = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
  const target = path.join(directory, `sapauto-${date}-${Date.now()}.db`)
  await db.backup(target)
  const backups = fs.readdirSync(directory)
    .filter((name) => /^sapauto-\d{4}-\d{2}-\d{2}-\d+\.db$/.test(name))
    .map((name) => ({ name, time: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
  for (const item of backups.slice(Math.max(1, keep))) fs.unlinkSync(path.join(directory, item.name))
  return { file: target, database: resolveDatabasePath() }
}

module.exports = { createBackup }
