#!/usr/bin/env cjs
// scripts/phase0-crash-inventory.cjs — READ-ONLY crash & error inventory (upgradeplan.md Card P0.1).
// Scans logs/pm2/*.log (+ optional pm2 process capture) and writes docs/crash-inventory-<date>[-<label>].md.
// Guardrails: never reads .env, vault, or session folders; masks phones/emails/company numbers (last 3 digits only).
// Usage:
//   node scripts/phase0-crash-inventory.cjs --host-label server --logs-root "X:\Scan\v8.1\logs\pm2" --data-root "X:\Scan\v8.1\data"
//   node scripts/phase0-crash-inventory.cjs --host-label laptop
// Deterministic: same inputs -> same report body (except the generatedAt timestamp, which is isolated in the header).
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const readline = require('node:readline')

const TODAY = new Date()
const DATE_TAG = TODAY.toISOString().slice(0, 10)
const ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const out = {
    hostLabel: 'local',
    logsRoot: null,
    dataRoot: null,
    hostRam: null
  }
  const assign = (key, value) => {
    if (key === 'host-label') out.hostLabel = value
    else if (key === 'logs-root') out.logsRoot = value
    else if (key === 'data-root') out.dataRoot = value
    else if (key === 'host-ram') out.hostRam = value
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const m = /^--([\w-]+)=(.*)$/.exec(a)
    if (m) { assign(m[1], m[2]); continue }
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { assign(a.slice(2), next); i++; continue }
    }
  }
  if (!out.logsRoot) out.logsRoot = path.join(ROOT, 'logs', 'pm2')
  if (!out.dataRoot) out.dataRoot = path.join(ROOT, 'data')
  return out
}

// ---- masking ----------------------------------------------------------------
const MASK3 = (digits) => '\u2022\u2022\u2022' + digits.slice(-3)
const unmaskedNumbers = []
function maskText(text) {
  if (!text) return text
  return String(text)
    .replace(/\d{7,}/g, (d) => { unmaskedNumbers.push(d.length); return MASK3(d) })
    .replace(/(mailto:)?([A-Za-z0-9._%+-]*)(@)([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (full, mailto, local, at, domain) => {
      if (local.length <= 2) return full
      return (mailto || '') + '*' + local.slice(-1) + at + domain
    })
    .replace(/\+\d{2,}[\s-]?\d{3,}[\s-]?\d{3,}/g, (d) => MASK3(String(d).replace(/\D/g, '')))
}

// ---- pino/iso line parsing --------------------------------------------------
const ISO_RE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]*)\]\s+\[(WARN|ERROR|INFO|FATAL|DEBUG)\]\s+(.*)$/
function parseLine(rawLine) {
  const line = rawLine.replace(/\uFEFF/g, '')
  const trimmed = line.trimEnd()
  if (!trimmed) return null
  const iso = ISO_RE.exec(trimmed)
  if (iso) return { kind: 'iso', ts: iso[1], level: iso[2], msg: iso[3], raw: trimmed }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed)
      if (obj && (obj.msg || obj.message || obj.level)) {
        const ts = obj.time != null ? new Date(Number(obj.time) || obj.time).toISOString() : (obj.time || null)
        return { kind: 'pino', ts, level: typeof obj.level === 'number' ? pinoLevelName(obj.level) : String(obj.level || 'INFO'), msg: obj.msg || obj.message || '', err: obj.err || obj.error || null, obj, raw: trimmed }
      }
    } catch { /* fall through: raw text line */ }
  }
  return { kind: 'raw', ts: null, level: null, msg: trimmed, raw: trimmed }
}
function pinoLevelName(n) {
  if (n >= 60) return 'FATAL'
  if (n >= 50) return 'ERROR'
  if (n >= 40) return 'WARN'
  if (n >= 30) return 'INFO'
  return 'DEBUG'
}

// ---- per-service collectors -------------------------------------------------
function newServiceStats(service, file, fileStat) {
  return {
    service, file,
    bytes: fileStat.size,
    mtime: fileStat.mtime.toISOString(),
    lines: 0,
    levels: { FATAL: 0, ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, NONE: 0 },
    tsMin: null, tsMax: null,
    signatures: new Map(),       // crash-tier sig -> { count, firstTs, lastTs, example }
    sqliteLines: new Map(),      // lock/malformed lines (§5 detail, separate from signatures)
    diagnostics: new Map(),      // patch/pin diagnostics (not crashes)
    warnSummaries: new Map(),    // warning-tier lines (not crashes)
    waPatterns: new Map(),       // pattern -> count
    http500: [],                 // { ts, line }
    unhandled: [],               // { ts, kind, line }
    lastErrorTs: null,
    overflow: 0
  }
}
const MAX_KEYS = 6000
function bump(map1, key, ts, stats, exampleLine) {
  let rec = map1.get(key)
  if (!rec) {
    if (map1.size >= MAX_KEYS) { stats.overflow++; return }
    rec = { count: 0, firstTs: null, lastTs: null, example: null }
    map1.set(key, rec)
  }
  rec.count++
  if (ts) {
    if (!rec.firstTs || ts < rec.firstTs) rec.firstTs = ts
    if (!rec.lastTs || ts > rec.lastTs) rec.lastTs = ts
  }
  if (!rec.example && exampleLine) rec.example = maskText(exampleLine).slice(0, 400)
}

// Generalize volatile tokens so the same logical failure merges into one signature:
// - Next/turbopack chunk hashes -> <chunk>       - puppeteer Frame hex -> <hex>
// - host-specific tree roots     -> <tree>       - heredoc raw digits are NOT touched here.
function normalizeSigKey(msg) {
  let key = String(msg)
    .replace(/\[root-of-the-server\]__[^\s]+?\.js/g, '[root-of-the-server]__<chunk>.js')
    .replace(/Frame '[A-F0-9]{16,}'/g, "Frame '<hex>'")
    .replace(/E:\\Drive\\Scan\\v8\.1/g, '<tree>')
    .replace(/C:\\Users\\Mega Store\\Downloads\\SapAuto\\v8\.1/g, '<tree>')
  // logical-class merges: same failure, different account on the tail
  key = key.replace(/^Account scan failed \([^)]*\):/, 'Account scan failed (<account>):')
  if (/^WhatsApp pairing code request failed/.test(key)) key = 'WhatsApp pairing code request failed (<varied error/frames>)'
  return key.slice(0, 200)
}

const WA_PATTERNS = [
  ['authenticated', /\bauthenticated\b/i],
  ['ready', /\bI am ready\b|\bclient ready\b|\bis ready\b/i],
  ['connected', /\bchannel connected\b|session authenticated and connected/i],
  ['disconnected', /\bdisconnected\b/i],
  ['wwebjs-pin', /\bwwebjs-pin\b/i],
  ['qr', /\bqr\b|generating qr/i]
]

// ---- scan one log file ------------------------------------------------------
async function scanFile(stats, filterConfig) {
  const rl = readline.createInterface({ input: fs.createReadStream(stats.file, 'utf8'), crlfDelay: Infinity })
  let window = []          // rolling window of recent lines (for stack continuation)
  const onLine = (record) => {
    stats.lines++
    if (record.ts) {
      if (!stats.tsMin || record.ts < stats.tsMin) stats.tsMin = record.ts
      if (!stats.tsMax || record.ts > stats.tsMax) stats.tsMax = record.ts
    }
    const lvl = record.level || 'NONE'
    if (lvl in stats.levels) stats.levels[lvl]++

    // tiered classification: crash-tier vs patch/pin diagnostics vs warnings
    const msg = record.msg || ''
    if (filterConfig.diagnosticStart.test(msg)) {
      bump(stats.diagnostics, normalizeSigKey(msg), record.ts, stats, msg)
    } else if (record.level === 'WARN' || filterConfig.warnOnly.test(msg)) {
      bump(stats.warnSummaries, normalizeSigKey(msg), record.ts, stats, msg)
    } else {
      let sig = null
      if (record.kind === 'pino') {
        const stack = (record.err && record.err.stack) || (record.obj && record.obj.stack) || null
        const name = (record.err && (record.err.type || record.err.name)) || (record.obj && record.obj.type) || null
        if (name || stack) {
          const frames = stack ? String(stack).split('\n').filter((l) => /\bat\s/.test(l)).slice(0, 3).map((l) => l.trim().replace(/\s+/g, ' ')) : []
          sig = [name || 'Error', String(record.msg || '').slice(0, 120), frames.join(' | ')].filter(Boolean).join(' :: ')
        } else if (String(record.level) === 'ERROR' || String(record.level) === 'FATAL') {
          sig = [record.msg.slice(0, 160), 'no-stack'].join(' :: ')
        }
      } else if (filterConfig.rawCrash.test(msg) || record.level === 'ERROR' || record.level === 'FATAL' ||
                 (/\b(Error|Exception)\b/.test(msg) && !filterConfig.warnOnly.test(msg))) {
        sig = msg.slice(0, 220) + ' :: ' + framesFromWindowStyle(window)
      }
      if (sig) bump(stats.signatures, normalizeSigKey(sig), record.ts, stats, msg)
    }

    // unhandled / uncaught
    if (filterConfig.unhandled.test(record.msg)) {
      if (stats.unhandled.length < 200) stats.unhandled.push({ ts: record.ts, line: maskText(record.msg).slice(0, 300) })
    }
    // sqlite lock / corruption — detail bucket (not a signature family: §5 owns it)
    if (filterConfig.sqlite.test(record.msg)) {
      bump(stats.sqliteLines, normalizeSigKey(record.msg), record.ts, stats, record.msg)
    }
    // launcher 500
    if (filterConfig.http500.test(record.msg) && stats.http500.length < 200) {
      const line = record.msg
      if (/\b500\b/.test(line) && /\b(GET|POST|PUT|DELETE)\b/.test(line)) {
        stats.http500.push({ ts: record.ts, line: maskText(line).slice(0, 300) })
      } else if (filterConfig.nextError.test(line)) {
        stats.http500.push({ ts: record.ts, line: maskText(line).slice(0, 300) })
      }
    }
    // whatsapp states
    for (const [name, re] of filterConfig.waPatterns) {
      if (re.test(record.msg)) bump(stats.waPatterns, name, record.ts, stats, record.msg)
    }
  }

  for await (const rawLine of rl) {
    const record = parseLine(rawLine)
    // tolerate multi-line stacks: continuation lines are folded into the window
    if (/^\s+(at\s|- |[}|]|code:|requireStack:)/.test(rawLine.trimEnd()) && record) {
      if (window.length < 24) window.push(rawLine.trim())
      else window.shift(), window.push(rawLine.trim())
      if (stats.service === 'launcher' || true) {
        // continuation lines also checked against signature-capable prefixes
        if (/^\s+at\s/.test(rawLine) && window.length >= 2) {
          // counted via the block starter; continuations themselves don't create new signatures
        }
      }
      onLine({ ts: null, level: null, msg: rawLine.trim(), raw: rawLine, kind: 'cont' })
      continue
    }
    if (window.length >= 4) window.shift()
    window.push(rawLine.trim())
    if (record) onLine(record)
    else { stats.lines++; stats.levels.NONE++; waFallback(record, stats, rawLine) }
  }
  rl.close()
}
function waFallback(record, stats, rawLine) {
  for (const [name, re] of WA_PATTERNS) {
    if (re.test(rawLine)) bump(stats.waPatterns, name, null, stats, rawLine)
  }
}
function framesFromWindowStyle(window) {
  const frames = window.filter((l) => /^\s*(at\s|- )/.test(l)).slice(-3)
  return frames.length ? frames.map((l) => l.trim().replace(/\s+/g, ' ')).join(' | ') : 'no-frames'
}

// ---- pm2 capture parsing (pretty table best-effort) -------------------------
function parsePm2Capture(text) {
  const apps = new Map()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[\u0000-\u001F]/g, ' ')
    const nameM = /(sapauto-v8-[\w-]+)/.exec(line)
    if (!nameM) continue
    const svc = nameM[1]
    const statusM = /\s(online|stopped|errored|launching|waiting restart)\s/i.exec(line)
    const restartM = /(\d+)\s+(?=online|stopped|errored|launching|waiting restart)/.exec(line)
    const memM = /([\d.]+)\s?(mb|gb|b)\s+\S+\s+(true|false)\s*$/i.exec(line)
    const pidM = /(\d{3,8})\s+\S+\s+\S+\s+(?=[\d.]+$)/.exec(line)
    if (!apps.has(svc)) apps.set(svc, { name: svc, status: null, restarts: null, mem: null, pid: null })
    const rec = apps.get(svc)
    rec.status = statusM ? statusM[1] : rec.status
    rec.restarts = restartM ? Number(restartM[1]) : rec.restarts
    if (!rec.mem && memM) rec.mem = memM[1] + ' ' + memM[2].toLowerCase()
    if (!rec.pid && pidM) rec.pid = pidM[1]
  }
  return apps
}

// ---- report -----------------------------------------------------------------
function hr(line) { return line.repeat(4) }

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const services = []
  let filesEmpty = true
  if (fs.existsSync(args.logsRoot)) {
    const entries = fs.readdirSync(args.logsRoot).filter((f) => f.endsWith('.log')).sort()
    for (const f of entries) {
      const file = path.join(args.logsRoot, f)
      const stat = fs.statSync(file)
      if (stat.size === 0) continue
      filesEmpty = false
      const service = f.replace(/\.(out|error)\.log$/, '')
      const stats = newServiceStats(service, file, stat)
      const filterConfig = {
        unhandled: /UnhandledPromiseRejection|unhandledRejection|uncaughtException|uncaught exception/i,
        sqlite: /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database is busy|disk image is malformed|corrupt/i,
        http500: /\b500\b/,
        nextError: /(Error \[|\u2003Error |ChunkLoadError|Chunk|route[^\n]*\.js)/,
        stackStart: /(Error|Exception)[^a-z]*(\[:|:)/,
        diagnosticStart: /^\[wwebjs-(pin|patch)\]/,
        warnOnly: /^Warning:|^WARN\b|Cannot polyfill/i,
        rawCrash: /\b(failed|malformed|SQLITE_|ENOENT|EBUSY|ENOTEMPTY|EPERM|Fatal|ChunkLoadError|Cannot find module|Target closed|detached Frame|corrupt)\b/i,
        waPatterns: new Map(WA_PATTERNS)
      }
      await scanFile(stats, filterConfig)
      services.push(stats)
    }
  }

  // pm2 capture
  let capture = null
  const capturePath = path.join(args.dataRoot, 'pm2-list.txt')
  if (fs.existsSync(capturePath)) {
    const text = fs.readFileSync(capturePath, 'utf8')
    const apps = parsePm2Capture(text)
    capture = { path: capturePath, mtime: fs.statSync(capturePath).mtime.toISOString(), apps }
  }

  const outPath = path.join(ROOT, 'docs', `crash-inventory-${DATE_TAG}-${args.hostLabel}.md`)
  const report = []
  const push = (s) => report.push(s)
  push(`# Crash & error inventory — ${args.hostLabel}`)
  push('')
  push(`- Generated at: ${TODAY.toISOString()} (Cairo ${TODAY.toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })})`)
  push(`- Logs root: ${args.logsRoot}`)
  push(`- PM2 capture: ${capture ? capture.path + ' (captured ' + capture.mtime + ')' : 'NOT FOUND'}`)
  push(`- Host RAM (running machine): ${os.totalmem() ? (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1) + ' GB total / ' + (os.freemem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB free' : 'unknown'}${args.hostRam ? ` (requested override: ${args.hostRam})` : ''}`)
  push(`- Read policy: PM2 logs + pm2 capture ONLY. Never read: .env, data/accounts.key*, channels/.wwebjs_auth*, DPAPI vault. Evidence masking: phones/emails/company numbers keep last 3 digits.`)
  push('')
  push('---')
  push('')
  push('## 1. Log files scanned')
  push('')
  if (filesEmpty) {
    push('**No non-empty PM2 logs found under the logs root.** For the laptop this is expected today: PM2 was reset by the Oct 30 incident reboot and services are not started (Owner approval pending).')
  } else {
    push('| service | file | MB | mtime | lines | ts range |')
    push('|---|---|---|---|---|---|')
    for (const st of services.sort((a, b) => a.service.localeCompare(b.service))) {
      push(`| ${st.service} | ${path.basename(st.file)} | ${(st.bytes / 1048576).toFixed(2)} | ${st.mtime} | ${st.lines} | ${st.tsMin || 'no timestamps in log'} → ${st.tsMax || ''} |`)
    }
  }
  push('')
  push('## 2. PM2 restart counts (best effort from capture)')
  push('')
  if (capture && capture.apps.size) {
    push('| service | status | restarts | mem |')
    push('|---|---|---|---|')
    for (const [svc, rec] of capture.apps) {
      push(`| ${svc} | ${rec.status || '?'} | ${rec.restarts === null ? 'GAP (table format/mojibake)' : rec.restarts} | ${rec.mem || 'GAP'} |`)
    }
    push('')
    push('Note: the capture file is a `pm2 list` pretty table (mojibaked), not `pm2 jlist`, so counts and RSS are best-effort. Re-capture with `pm2 jlist > data\\pm2-list.txt` for exact monit values.')
  } else {
    push('**No PM2 capture file** (data/pm2-list.txt not found) — restart counts GAP.')
  }
  push('')
  push('## 3. Top error signatures')
  push('')
  const all = []
  for (const st of services) for (const [sig, rec] of st.signatures) all.push({ sig, rec, svc: st.service })
  all.sort((a, b) => b.rec.count - a.rec.count)
  if (!all.length) {
    push('None found in scanned files.')
  } else {
    push('| # | signature | count | service | first / last |')
    push('|---|---|---|---|---|')
    for (const [i, e] of all.slice(0, 40).entries()) {
      push(`| ${i + 1} | \`${maskText(e.sig)}\` | ${e.rec.count} | ${e.svc} | ${e.rec.firstTs || 'no ts'} / ${e.rec.lastTs || 'no ts'} |`)
    }
  }
  push('')
  push('## 4. Unhandled rejections / uncaught exceptions')
  push('')
  const unhandledTotal = services.reduce((a, st) => a + st.unhandled.length, 0)
  push(unhandledTotal ? `Counted hit lines: **${unhandledTotal}**` : '**None found.**')
  for (const st of services) {
    for (const u of st.unhandled.slice(0, 5)) push(`- ${st.service}${u.ts ? ' ' + u.ts : ' (no ts in log)'}: ${u.line}`)
  }
  push('')
  push('## 5. SQLite lock / corruption lines')
  push('')
  const lockSigs = []
  for (const st of services) for (const [sig, rec] of st.sqliteLines) lockSigs.push({ sig, rec, svc: st.service })
  lockSigs.sort((a, b) => b.rec.count - a.rec.count)
  if (!lockSigs.length) push('**None found.**')
  for (const e of lockSigs) push(`- **${e.rec.count}×** ${maskText(e.sig)} (${e.svc}, ${e.rec.firstTs || 'no ts'} … ${e.rec.lastTs || 'no ts'})`)
  push('')
  push('## 6. Launcher HTTP 500 lines')
  push('')
  const launcher500 = []
  for (const st of services) if (/launcher/.test(st.service)) launcher500.push(...st.http500)
  push(launcher500.length ? `Collected evidence lines: **${launcher500.length}**` : '**None found.** (No access-log-style 500 lines exist in these files — Next does not log access lines here. The 500-class evidence is the ChunkLoadError module-failure family; it is counted under §3 crash signatures.)')
  for (const l of launcher500.slice(0, 10)) push(`- ${l.ts || 'no ts'}: ${l.line}`)
  push('')
  push('## 7. WhatsApp state lines')
  push('')
  const wa = services.filter((st) => /wa-sender|channels/.test(st.service))
  if (!wa.length) push('No wa-sender/channels log entries scanned.')
  for (const st of wa) {
    push(`- **${st.service}** total state hits: ${[...st.waPatterns.values()].reduce((a, r) => a + r.count, 0)}`)
    for (const [name, rec] of st.waPatterns) push(`  - ${name}: ${rec.count} (example: \`${(rec.example || '').slice(0, 120)}\`)`)
  }
  push('')
  push('### wa-sender boot → ready durations')
  push('')
  push('**GAP:** wa-sender `.out.log` lines carry no timestamps (the service logger is raw-text; PM2 adds no time header for legacy configs). Durations are not derivable until timestamped logging ships (upgradeplan Card S9). Recorded as an inventory finding, not a fake number.')
  push('')
  push('## 7b. Patch/pin diagnostics (wa-sender .error.log — not crashes)')
  push('')
  const diags = []
  for (const st of services) for (const [sig, rec] of st.diagnostics) diags.push({ sig, rec, svc: st.service })
  diags.sort((a, b) => b.rec.count - a.rec.count)
  if (!diags.length) push('None found.')
  for (const d of diags.slice(0, 10)) push(`- **${d.rec.count}×** (${d.svc}) \`${maskText(d.sig.slice(0, 150))}\``)
  push('')
  push('## 7c. Warning-tier summary')
  push('')
  const warns = []
  for (const st of services) for (const [sig, rec] of st.warnSummaries) warns.push({ sig, rec, svc: st.service })
  warns.sort((a, b) => b.rec.count - a.rec.count)
  if (!warns.length) push('None found.')
  for (const wbar of warns.slice(0, 12)) push(`- **${wbar.rec.count}×** (${wbar.svc}) \`${maskText(wbar.sig.slice(0, 150))}\``)
  push('')
  push('## 8. Errors left unclassified (overflow)')
  push('')
  for (const st of services) if (st.overflow) push(`- ${st.service}: ${st.overflow} additional distinct signatures beyond the ${MAX_KEYS} key cap`)
  if (!services.some((st) => st.overflow)) push('None — all signatures counted under the cap.')
  push('')
  push('## 9. Findings for Track S (top-5 crash/error signatures)')
  push('')
  const top5 = all.slice(0, 5)
  for (const [i, e] of top5.entries()) push(`${i + 1}. (${e.rec.count}×, ${e.svc}) \`${maskText(e.sig.slice(0, 180))}\``)
  push('')
  push('## 10. Reproducibility')
  push('')
  push('Run this script twice with the same inputs: the body of this report (all count tables) must match exactly. The generatedAt line is the only varying field.')
  push('')
  push('## 11. What was NOT done on purpose (card scope)')
  push('')
  push('- No runtime file or service touched; no restarts; no DB opened; no new migration; no test added.')
  push('- Restart counts and RSS come from the existing capture (best effort) because the script never shells into a foreign host\u2019s pm2.')
  push('- Raw evidence lines are masked and truncated; no customer data, message bodies, or PDF text reproduced.')
  push('')
  fs.writeFileSync(outPath, report.join('\n'), 'utf8')
  console.log('report written: ' + outPath)
  console.log('unmasked-ish digit runs masked: ' + unmaskedNumbers.filter((n) => n > 0).length + ' patterns')
}

main().catch((e) => { console.error('phase0-crash-inventory failed:', e && e.message); process.exitCode = 1 })
