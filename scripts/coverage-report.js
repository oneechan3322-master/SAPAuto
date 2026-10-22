// scripts/coverage-report.js - Track B, task B0 (v8.2 plan §B.1)
// For every table and column: non-null %, sample value, and whether any
// API route / UI component / lib reads it. Output: docs/coverage-report.md
// Usage: node scripts/coverage-report.js
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const ROOT = path.resolve(__dirname, '..')
const DB_PATH = process.env.V8_DB_PATH || path.join(ROOT, 'data', 'sapauto.db')
const OUT_PATH = path.join(ROOT, 'docs', 'coverage-report.md')

const CODE_DIRS = ['launcher/app', 'channels', 'lib', 'assistant', 'db', 'mcp']
const codeFiles = []
;(function collect() {
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(js|cjs|mjs|tsx|ts)$/.test(entry.name)) codeFiles.push(path.relative(ROOT, full))
    }
  }
  for (const dir of CODE_DIRS) walk(path.join(ROOT, dir))
})()

const sources = codeFiles.map((f) => {
  let src = ''
  try { src = fs.readFileSync(path.join(ROOT, f), 'utf8') } catch {}
  return src
})

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND NOT (name LIKE 'fts%')`).all().map((r) => r.name)

const internalTables = new Set([
  '_migrations', 'schema_migrations', 'migrations', 'leases', 'heartbeats',
  'assistant_conversations', 'assistant_messages', 'service_health', 'scan_locks',
  'outbox_deliveries', 'notification_outbox'
])
const camel = (name) => name.toLowerCase()
const looksUsed = (table, column) => {
  const t = camel(table); const c = camel(column)
  const bare = sources.some((s) => s.includes(`.${c}`) || s.includes(`'${c}'`) || s.includes(`"${c}"`))
  const qualified = sources.some((s) => s.toLowerCase().includes(`${t}.`) && (s.includes(c)))
  const selectAll = sources.some((s) => new RegExp(`(?:from|into|update|join)\\s+${t}\\b`, 'i').test(s))
  return { bare, qualified, selectAll }
}

const out = []
const gapRows = []
out.push(`# Data Coverage Report — ${new Date().toISOString().replace('T', ' ').slice(0, 19)} (task B0)`)
out.push('')
out.push(`Database: ${DB_PATH} · tables: ${tables.length} · code files scanned: ${codeFiles.length}`)
out.push('')

for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all()
  let rowCount = 0
  try { rowCount = db.prepare(`SELECT COUNT(*) AS n FROM ${JSON.stringify(table)}`).get().n } catch {}
  out.push(`## ${table} (${rowCount} rows)${internalTables.has(table) ? ' — internal' : ''}`)
  out.push('')
  out.push('| column | non-null % | sample | referenced in code |')
  out.push('|---|---|---|---|')
  for (const col of columns) {
    const name = col.name
    let nonNull = 0
    let sample = null
    try {
      nonNull = db.prepare(`SELECT COUNT(${JSON.stringify(name)}) AS n FROM ${JSON.stringify(table)}`).get().n
      if (nonNull) sample = db.prepare(`SELECT ${JSON.stringify(name)} AS v FROM ${JSON.stringify(table)} WHERE ${JSON.stringify(name)} IS NOT NULL LIMIT 1`).get().v
    } catch {}
    const pct = rowCount ? Math.round(nonNull / rowCount * 100) : 0
    const usage = looksUsed(table, name)
    const usedText = `${usage.bare ? 'name,' : ''}${usage.selectAll ? 'tableInQuery,' : ''}`.replace(/,+$/, '') || '—'
    out.push(`| ${name} | ${pct}% | ${sample === null ? 'null' : JSON.stringify(String(sample).slice(0, 60))} | ${usedText} |`)
    const isInteresting = !internalTables.has(table) && rowCount > 0 && pct === 0
    if (isInteresting) gapRows.push(`- \`${table}.${name}\`: column exists, 0% populated in ${rowCount} rows`)
  }
  out.push('')
}
db.close()

out.push('## Empty-data flags (populated table, 0% columns)')
out.push(gapRows.length ? gapRows.join('\n') : '- none')

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, out.join('\n'))
console.log(`Wrote ${OUT_PATH} (${tables.length} tables, ${gapRows.length} empty-data flags)`)
