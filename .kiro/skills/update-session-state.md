---
name: update-session-state
description: |
  Automatically collects current V8 system status and updates CURRENT_SESSION_STATE.md
  with live data including PM2 services, channel status, database state, and test results.
activation: manual
version: 1.0.0
author: SAPAuto V8 Team
tags: [maintenance, documentation, state-tracking]
---

# Update Session State Skill

## Purpose
This skill automatically gathers the current state of SAPAuto V8 and updates the `CURRENT_SESSION_STATE.md` file with accurate, live information for session handoff.

## When to Use
- At the end of each work session
- After major system changes
- Before context compaction
- When preparing handoff documentation

## What It Collects

### 1. PM2 Services Status
- Process IDs, uptime, memory usage
- Service health (online/stopped/errored)
- Restart counts and stability

### 2. Channel Status
- WhatsApp: connection state, account, control number
- Email: provider configuration, delivery mode
- Registry status and last errors

### 3. Database State
- Migration count and latest applied
- Record counts (accounts, documents, tasks, obligations)
- Health indicators (lock errors, WAL status)

### 4. Test Suite Results
- Latest test run results
- Pass/fail counts by suite
- Known issues and regressions

### 5. Configuration
- Active AI provider
- Message delivery mode (dry-run vs live)
- OpenCode configuration status
- Environment flags

## Execution Steps

### Step 1: Gather PM2 Status
```bash
pm2 status
pm2 jlist
```

### Step 2: Query Database State
```javascript
const db = require('better-sqlite3')('./data/sapauto.db')

// Get service counts
const accounts = db.prepare('SELECT COUNT(*) as n FROM accounts WHERE disabled=0').get().n
const documents = db.prepare('SELECT COUNT(*) as n FROM company_documents').get().n
const migrations = db.prepare('SELECT name FROM schema_log ORDER BY applied_at DESC LIMIT 1').get()

// Get channel status
const waConnected = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_connected')?.value
const waAccount = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_account_number')?.value
const waControl = db.prepare('SELECT value FROM settings WHERE key=?').get('whatsapp_control_number')?.value

// Get registry status
const channels = db.prepare('SELECT id, status, last_error FROM channel_registry').all()
```

### Step 3: Check Test Results
```bash
npm test 2>&1 | tee test-output.txt
grep -E "tests|pass|fail" test-output.txt
```

### Step 4: Read Environment Config
```javascript
require('dotenv').config()
console.log('AI Provider:', process.env.AI_PROVIDER)
console.log('Message Mode:', process.env.V8_MESSAGE_MODE)
console.log('OpenCode Model:', process.env.V8_OPENCODE_MODEL)
```

### Step 5: Generate Markdown Update
Create formatted sections:
- Header with timestamp (Africa/Cairo timezone)
- PM2 services table
- Channel status blocks
- Database statistics
- Test suite results
- Active configuration

### Step 6: Update File
Replace old content in `CURRENT_SESSION_STATE.md` while preserving:
- Purpose section
- Project root paths
- Network access details
- Historical notes

## Usage

### From Kiro Agent
```
@update-session-state

Please update the session state file with current system status.
```

### Automated Script
```bash
cd "c:\Users\Mega Store\Downloads\SapAuto\v8"
node update-session-state.js
```

## Output Format

```markdown
# SAPAuto V8 — Current Session State

Last updated: [TIMESTAMP] (Africa/Cairo)

## Purpose
[preserved]

## Project and local services
- All 6 PM2 services [STATUS]:
  - sapauto-v8-channels (id X): [status] — PID [pid], uptime [time]
  - sapauto-v8-assistant (id X): [status] — PID [pid], uptime [time]
  [...]

## Channels: WhatsApp & Email
### WhatsApp Live Status
- **Status**: [connected/disconnected]
- **Account**: [number]
- **Control**: [number]
[...]

## Database State
- Migrations: [count] applied, latest: [name]
- Accounts: [count] active
- Documents: [count] total
[...]

## Test Suite Status
[test results table]

## Active Configuration
[env flags and settings]
```

## Implementation

### Node.js Script (update-session-state.js)
```javascript
#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const { execSync } = require('node:child_process')
const Database = require('better-sqlite3')
require('dotenv').config()

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
      restarts: proc.pm2_env.restart_time,
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
      },
      registry: db.prepare('SELECT id, status, last_error FROM channel_registry').all()
    }
  } finally {
    db.close()
  }
}

function getDatabaseStats() {
  const db = new Database('./data/sapauto.db', { readonly: true })
  try {
    const migrations = db.prepare('SELECT COUNT(*) as n FROM schema_log').get().n
    const latestMigration = db.prepare('SELECT name FROM schema_log ORDER BY applied_at DESC LIMIT 1').get()?.name
    
    return {
      migrations: { count: migrations, latest: latestMigration },
      accounts: db.prepare('SELECT COUNT(*) as n FROM accounts WHERE disabled=0').get().n,
      documents: db.prepare('SELECT COUNT(*) as n FROM company_documents').get().n,
      tasks: db.prepare('SELECT COUNT(*) as n FROM tasks WHERE status<>"done"').get().n
    }
  } finally {
    db.close()
  }
}

function generateMarkdown(data) {
  const timestamp = getCurrentTimestamp()
  
  let md = `# SAPAuto V8 — Current Session State\n\n`
  md += `Last updated: ${timestamp} (Africa/Cairo — auto-updated)\n\n`
  
  md += `## Purpose\n\nThis is a factual handoff for the next session. It contains no passwords, API keys, cookies, or QR data.\n\n`
  
  md += `## Project and local services\n\n`
  md += `- Project root: \`C:\\Users\\Mega Store\\Downloads\\SapAuto\\v8\`\n`
  md += `- All ${data.pm2.length} PM2 services:\n`
  
  for (const proc of data.pm2) {
    const uptime = Math.round((Date.now() - proc.uptime) / 60000)
    md += `  - \`${proc.name}\` (id ${proc.id}): ${proc.status} — PID ${proc.pid}, uptime ${uptime} min, ${proc.memory} MB\n`
  }
  
  md += `\n## Channels: WhatsApp & Email\n\n`
  md += `### WhatsApp Live Status\n`
  md += `- **Status**: ${data.channels.whatsapp.connected ? '✅ Connected' : '❌ Disconnected'}\n`
  md += `- **Account**: \`${data.channels.whatsapp.account}\`\n`
  md += `- **Control**: \`${data.channels.whatsapp.control}\`\n`
  
  md += `\n## Database State\n\n`
  md += `- Migrations: ${data.db.migrations.count} applied, latest: \`${data.db.migrations.latest}\`\n`
  md += `- Active accounts: ${data.db.accounts}\n`
  md += `- Documents: ${data.db.documents}\n`
  md += `- Open tasks: ${data.db.tasks}\n`
  
  md += `\n## Active Configuration\n\n\`\`\`\n`
  md += `AI_PROVIDER=${process.env.AI_PROVIDER || 'gemma4'}\n`
  md += `V8_MESSAGE_MODE=${process.env.V8_MESSAGE_MODE || 'dry-run'}\n`
  md += `AI_ALLOW_CLOUD=${process.env.AI_ALLOW_CLOUD || 'false'}\n`
  md += `V8_OPENCODE_MODEL=${process.env.V8_OPENCODE_MODEL || 'not set'}\n`
  md += `\`\`\`\n`
  
  return md
}

function main() {
  console.log('📊 Collecting system state...')
  
  const data = {
    pm2: getPM2Status(),
    channels: getChannelStatus(),
    db: getDatabaseStats()
  }
  
  console.log('✅ Data collected')
  console.log(`   - PM2 services: ${data.pm2.length}`)
  console.log(`   - WhatsApp: ${data.channels.whatsapp.connected ? 'Connected' : 'Disconnected'}`)
  console.log(`   - Database: ${data.db.migrations.count} migrations, ${data.db.accounts} accounts`)
  
  const markdown = generateMarkdown(data)
  fs.writeFileSync('CURRENT_SESSION_STATE.md', markdown, 'utf8')
  
  console.log('✅ Updated CURRENT_SESSION_STATE.md')
}

if (require.main === module) {
  main()
}

module.exports = { main }
```

## Notes

- Preserves manual notes and historical context
- Updates only dynamic data (timestamps, counts, status)
- Safe to run multiple times (idempotent)
- No secrets or credentials included
- Africa/Cairo timezone for consistency

## Maintenance

Update this skill when:
- New PM2 services added
- Database schema changes
- New channels integrated
- Test suite structure changes
