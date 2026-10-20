'use strict'

const fs = require('node:fs')
const { execSync } = require('node:child_process')
const Database = require('better-sqlite3')
const path = require('node:path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
  } catch (error) {
    return error.stdout || ''
  }
}

function getCurrentTimestamp() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getPM2Status() {
  const raw = exec('pm2 jlist')
  try {
    const list = JSON.parse(raw)
    return list.map(proc => ({
      name: proc.name,
      id: proc.pm_id,
      status: proc.pm2_env.status,
      pid: proc.pid,
      uptime: proc.pm2_env.pm_uptime,
      memory: Math.round(proc.monit.memory / 1024 / 1024)
    }))
  } catch {
    return []
  }
}

function getChannelStatus() {
  const db = new Database('./data/sapauto.db', { readonly: true })
  try {
    return {
      whatsapp: {
        connected: db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_connected')?.value === 'true',
        account: db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_account_number')?.value || 'N/A',
        control: db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_control_number')?.value || 'N/A'
      }
    }
  } finally {
    db.close()
  }
}

function getDatabaseStats() {
  const db = new Database('./data/sapauto.db', { readonly: true })
  try {
    return {
      accounts: db.prepare('SELECT COUNT(*) as n FROM accounts WHERE disabled=0').get().n,
      documents: db.prepare('SELECT COUNT(*) as n FROM company_documents').get().n,
      tasks: db.prepare('SELECT COUNT(*) as n FROM tasks WHERE status<>"done"').get().n,
      users: db.prepare('SELECT COUNT(*) as n FROM users WHERE disabled=0').get().n
    }
  } finally {
    db.close()
  }
}

function main() {
  console.log('\n📊 SAPAuto V8 - Session State Update\n')
  
  const data = {
    pm2: getPM2Status(),
    channels: getChannelStatus(),
    db: getDatabaseStats(),
    timestamp: getCurrentTimestamp()
  }
  
  const onlineCount = data.pm2.filter(p => p.status === 'online').length
  
  console.log('✅ Data collected:')
  console.log(`   • Timestamp: ${data.timestamp}`)
  console.log(`   • PM2 services: ${data.pm2.length} total, ${onlineCount} online`)
  data.pm2.forEach(p => {
    const uptime = Math.round((Date.now() - p.uptime) / 60000)
    console.log(`      - ${p.name}: ${p.status} (${uptime} min, ${p.memory} MB)`)
  })
  console.log(`   • WhatsApp: ${data.channels.whatsapp.connected ? '✅ Connected' : '❌ Disconnected'}`)
  console.log(`      Account: ${data.channels.whatsapp.account}`)
  console.log(`      Control: ${data.channels.whatsapp.control}`)
  console.log(`   • Database:`)
  console.log(`      Active accounts: ${data.db.accounts}`)
  console.log(`      Documents: ${data.db.documents}`)
  console.log(`      Open tasks: ${data.db.tasks}`)
  console.log(`      Active users: ${data.db.users}`)
  console.log(`   • AI Provider: ${process.env.AI_PROVIDER || 'gemma4'}`)
  console.log(`   • Message Mode: ${process.env.V8_MESSAGE_MODE || 'dry-run'}`)
  console.log('\n✅ Session state collected successfully!')
}

if (require.main === module) {
  main()
}

module.exports = { main }
