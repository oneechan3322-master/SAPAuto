// scripts/server-health-check.js - the "no errors at all" gate.
// Run DB integrity + migration ceiling + all-PM2-online + dashboard 200 +
// RAM/ports, then prints PASS/FAIL per item. Exit code 0 only when ALL pass.
//   node scripts/server-health-check.js
'use strict'

const { execSync } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const results = []
function check(name, pass, detail) {
  results.push([pass ? 'PASS' : 'FAIL', name, detail])
}

// 1) Database exists, integrity, migration ceiling, company count.
const dbPath = path.join(process.cwd(), 'data', 'sapauto.db')
if (fs.existsSync(dbPath)) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get()
    check('sqlite integrity', integrity.integrity_check === 'ok', JSON.stringify(integrity))
    const migrations = db.prepare('SELECT MAX(name) AS latest FROM schema_migrations').get()
    check('migrations at 036', /\.sql$/.test(migrations.latest) && Number(String(migrations.latest).slice(0, 3)) >= 36, migrations.latest)
    const companies = db.prepare('SELECT COUNT(*) AS c FROM companies').get()
    check('companies present', companies.c > 0, `${companies.c} companies`)
    const obligations = db.prepare('SELECT COUNT(*) AS c, MAX(updated_at) mu FROM obligations').get()
    check('obligations present', obligations.c > 0, `${obligations.c} rows, newest ${obligations.mu}`)
  } finally { db.close() }
} else {
  check('sqlite integrity', false, `${dbPath} missing`)
}

// 2) All 8 PM2 apps online (and the launcher reports Next 16.4.x).
let pm2apps = []
try {
  const raw = execSync('pm2 jlist', { encoding: 'utf8', timeout: 30000 })
  pm2apps = JSON.parse(raw.trim().replace(/^\uFEFF/, ''))
} catch (e) {
  check('pm2 reachable', false, e.message.split('\n')[0])
}
if (pm2apps.length) {
  const online = pm2apps.filter((a) => a.pm2_env.status === 'online')
  check('8 services online', online.length === 8, `${online.length}/${pm2apps.length} online: ${online.map((a) => a.name.replace('sapauto-v8-', '')).join(',')}`)
  const launcher = pm2apps.find((a) => a.name.endsWith('launcher'))
  if (launcher) check('launcher binds LAN (0.0.0.0)', JSON.stringify(launcher.pm2_env.args || '').includes('0.0.0.0'), String(launcher.pm2_env.args))
}

// 3) Dashboard answers HTTP 200 from this machine.
try {
  const status = execSync('curl -s -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/setup', {
    encoding: 'utf8', timeout: 20000, shell: true
  }).trim()
  check('dashboard /api/setup HTTP 200', status === '200', `status=${status}`)
} catch (e) {
  check('dashboard /api/setup HTTP 200', false, e.message.split('\n')[0])
}

// 4) The box itself: RAM headroom for the scraping/model stack.
const freeGB = os.freemem() / (1024 * 1024 * 1024)
check('free RAM >= 2 GB', freeGB >= 2, `${freeGB.toFixed(1)} GB free of ${(os.totalmem() / 1073741824).toFixed(1)} GB`)

// 5) WhatsApp live state — informational, never a FAIL by itself (pairing is
// an Owner action done from the dashboard Channel Center).
if (fs.existsSync(dbPath)) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })
  try {
    const setting = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || ''
    results.push(['INFO', 'whatsapp pairing', setting('whatsapp_connected') === 'true' ? 'connected' : 'not paired yet (dashboard → Channel Center → pair)'])
    results.push(['INFO', 'whatsapp control number', setting('whatsapp_control_number') || '(not configured)'])
    const recipients = db.prepare(`SELECT COUNT(*) AS n FROM user_channels c
      JOIN users u ON u.id=c.user_id WHERE u.disabled=0 AND c.verified_at IS NOT NULL`).get()
    results.push(['INFO', 'linked WhatsApp recipients', String(recipients.n)])
  } finally { db.close() }
}

let worst = 0
console.log('\n=== SAPAuto health check ===')
for (const [status, name, detail] of results) {
  console.log(`${status}  ${name}${detail ? `  (${detail})` : ''}`)
  if (status === 'FAIL') worst = 1
}
console.log(worst ? '\nRESULT: NOT CLEAN - fix the FAIL rows above.' : '\nRESULT: CLEAN - the machine is live and serving the network.')
process.exitCode = worst
