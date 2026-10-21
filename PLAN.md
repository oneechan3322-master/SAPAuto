Parallel Search
whatsapp-web.js latest release version
better-sqlite3-multiple-ciphers SQLCipher encryption
pino-roll log rotation pino transport
Gemma 4 E2B GGUF size
PaddleOCR Arabic vs Tesseract Arabic accuracy
Node.js 24 LTS end of life schedule
View
Parallel Search
Mistral free Experiment plan data used for training opt out
PM2 shutdown_with_message Windows graceful shutdown
GitHub Actions private repo free minutes Windows multiplier
sqlite-vec Node.js better-sqlite3 extension
Egypt Personal Data Protection Law 151 2020 executive regulations
whatsapp-web.js LocalAuth EBUSY Windows logout
View
Read
https://endoflife.date/nodejs
View
Read
https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models
View
Read
https://github.com/Unitech/pm2/issues/6142
View
Read
https://www.bakermckenzie.com/en/insight/publications/2026/01/egypt-important-data-protection-update
View
Read
https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions
View
Read
https://github.com/wwebjs/whatsapp-web.js/issues/3904
View
opus5.5plan.md: SAPAuto V8 upgrade plan
Scope: stability, security, scalability, performance, AI and developer experience Cost limit: everything here is free or open-source. The few optional cloud items are marked and none is required, so the offline-first constraint still holds. Platform: Windows, offline-capable, Arabic/RTL Basis: the V8 architecture document dated 19 Oct 2026. I didn't have access to the repository, so where you asked for file/line references I've given grep commands that will find them.

0. Corrections to the brief, and how I scoped the plan
Some statements in the brief are wrong or are steering effort the wrong way. They change the priorities, so I'm correcting them first.

Claim in the brief	What's actually true	What it means for the plan
"whatsapp-web.js 1.34.7 is 2 years old, should update"	1.34.7 is the newest release, published about 5 months ago (npm)	There's nothing to upgrade to. The real risk is that the library is unofficial, so the fix is isolation, not a version bump.
"Node 24+ (latest LTS)"	Node 24's Active LTS ends today (20 Oct 2026). It stays in maintenance until 30 Apr 2028. Node 26 becomes LTS on 27 Oct 2026 (endoflife.date)	Pin 24.x now. Evaluate Node 26 in Q1 2027. No rush.
"Test coverage 97.6%"	That figure is the pass rate (40 of 41 tests). Coverage hasn't been measured.	Measure it before setting targets.
"6 direct dependencies"	The stack list alone names more than 8 (better-sqlite3, playwright, whatsapp-web.js, imapflow, nodemailer, pdfjs-dist, next, react, plus Python deps)	Run an inventory (§9.1).
135k lines of JS against 41 tests	Very likely counts vendored, generated, or .next output	Re-count with npx cloc . --exclude-dir=node_modules,.next,data,.wwebjs_auth,.wwebjs_cache.
Benchmark targets like "<30 s scan", "<1 s dispatcher", "<200 ms WhatsApp send"	Scan time depends on ETA portal latency. WhatsApp Web speed should be throttled on purpose, not optimised. A 10 s delay is irrelevant for tax deadlines measured in days.	I replaced these with targets that matter to the business (§3).
"Pass SOC 2 / ISO 27001", "cut cloud costs 30%"	Cloud spend is already about $0. SOC 2 means audit firms and policy work, not code.	Reframed as "SOC 2-aligned controls" (§5.6).
Scale. The system has 26 companies, 800 obligations, 1,717 events and 187 PDFs. That is a very small workload. SQLite on one Windows machine can handle 100× this. Most of section 6 of the brief (PostgreSQL, Kubernetes, Redis, BullMQ, event sourcing, Jaeger, Loki, multi-tenancy) would add cost and failure modes and would break the offline/Windows constraint without fixing any problem you actually have. I've rejected those explicitly in §11. The real risks are more mundane: the box going down unnoticed, secrets in plaintext, an unauthenticated dashboard on two networks, unofficial WhatsApp, and taxpayer data going to free-tier LLMs.

1. Top 5 critical issues (outage and business risk)
C1. Nothing runs after a reboot until someone logs in, and nothing tells you the machine is down
PM2 "auto-restart on Windows logon" means that after a power cut or a Windows Update reboot, all six services stay down until a person logs in. On top of that, every alert path (assistant → events → channels → WhatsApp) runs on the same machine, so a dead machine sends no alert.

Fix (free):

Start PM2 at boot, not at logon. Use a Task Scheduler task with the "At startup" trigger and "Run whether user is logged on or not", running pm2 resurrect under a dedicated local service account. NSSM or pm2-installer are alternatives.
Set the BIOS to "Restore on AC power loss = On". A UPS is strongly recommended for an office machine.
Add an external dead-man's switch (optional cloud). Every 5 minutes the harness pings a free healthchecks.io-style endpoint. If pings stop, it alerts you by email or Telegram. If you want zero cloud, run Uptime Kuma on a second machine on the LAN, even an old laptop.
Send infrastructure alerts over a different channel from the one being monitored. "WhatsApp is down" should arrive on Telegram or email, never on WhatsApp.
C2. Crashes in the WhatsApp channel take Email and Telegram down with it
The 12 channel restarts fit a known whatsapp-web.js failure: after a logout or disconnect, a Puppeteer task left running throws Protocol error … Session closed as an unhandled rejection, and that kills the Node process even when disconnected is handled (wwebjs #3904). Windows also has file-lock (EBUSY) problems when the session folder gets cleaned up (wwebjs #3072). Because Gmail and Telegram run in the same process, a WhatsApp crash stops them too.

Fix: move WhatsApp into its own PM2 process (sapauto-v8-wa) that only drains WhatsApp rows from a durable outbox. Add a process-level rejection guard and a supervisor with exponential backoff (§6.3). Email and Telegram then keep working when WhatsApp fails.

C3. Deliveries are neither durable nor idempotent
A failed send is marked failed and never retried. A restart in the middle of a send can lose the message or, once retries exist, send it twice. When the content is "penalty deadline in 3 days", that's a business risk.

Fix: a transactional outbox with leases, idempotency keys, exponential backoff and a dead-letter state (§6.2).

C4. Several processes write to one SQLite file with no busy handling, no automated backup, and foreign keys off
With six processes and one file, the risk is SQLITE_BUSY errors, not "writer starvation". PRAGMA foreign_keys applies per connection, so it has to be set in every process. Turning it on blindly will break writes if orphan rows already exist. There's also no tested backup, so one bad migration or disk failure loses everything.

Fix: a shared db.js that sets the pragmas (§6.1), BEGIN IMMEDIATE for write transactions, nightly online backups with a restore test (§6.9), and a migration runner with a checksum ledger (§6.8).

C5. False confidence in obligation status (resolved_unconfirmed, tasks past the 60-day band)
Ten obligations disappeared from the portal and are now "resolved_unconfirmed". Six tasks are past the 60-day penalty band. This is the product's core value, and it's currently unsafe in both directions: false "resolved" means missed penalties, false "open" means alert fatigue.

Fix: a status state machine. An obligation only counts as resolved after N consecutive successful scans in which it's absent and the section scrape passed its schema check. Before that it sits in a manual review queue on the dashboard. Past-band tasks escalate daily to the owner with a computed penalty estimate, and the escalation can only be cleared by acknowledging it.

2. Top 5 security issues (CVSS 3.1 base scores)
The scores are my own estimates from your description, and the vectors are included so you can check them.

#	Issue	Vector	Score	Fix
S1	Dashboard has no authentication and is reachable on the LAN (192.168.1.111) and on the Radmin VPN (26.x). It exposes controls such as live mode and settings, not just read-only views.	AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H	8.8	Add local auth now (§6.6). Lock the firewall rule to specific remote IPs. Bind to 127.0.0.1 unless remote access is needed.
S2	The 26 ETA portal credentials are read from ../SAPAuto3/accounts.txt (probably plaintext). Stealing them lets someone act as the taxpayers on ETA.	AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N	8.4	Import into the DPAPI secure store, delete the file, rotate any passwords that were exposed, and cut the SAPAuto3 dependency.
S3	.wwebjs_auth/ is a full WhatsApp session. Copying it means account takeover with no QR code needed.	AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N	8.4	NTFS ACL so only the service account can read it (icacls), BitLocker on the drive, a weekly review of linked devices, and "log out all devices" if it's ever suspected.
S4	MCP bearer token stored in plaintext in .env. Any local process or user can drive the MCP tools.	AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N	7.1	Move it to DPAPI and grant MCP tools least privilege (read-only by default, write tools opt-in).
S5	Secrets end up in logs (a Mistral key appeared in PM2 logs).	AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N	5.5	Revoke the leaked key. Rotating to a new key doesn't help while the old one still works. Add a pino redact list (§6.4) and scrub existing PM2 logs.
Compliance risk that isn't in the CVSS table but may matter most: taxpayer data is being sent to free cloud LLM tiers. Mistral says that in Studio free mode it may use your input and output to train its models (Mistral Help). Egypt has now issued the Executive Regulations to the Personal Data Protection Law (Decree 816 of 2025), which bring in concrete compliance duties and an enforcement authority (Baker McKenzie). Also, running multiple free keys to get around rate limits probably breaks the provider's terms. Policy: client documents and identifiers are processed only by the local model. Cloud models get redacted, aggregate prompts only, or none at all (§7). I'm not a lawyer, so have counsel confirm your PDPL obligations.

Smaller items: there's no HTTPS on LAN/VPN, which matters once you add login (AV:A/AC:H/PR:N/UI:R/S:U/C:H/I:L/A:N ≈ 5.4). Real phone numbers appear in internal documents, so redact them. The QR code shown on a team call was a one-off exposure: check the linked devices list now.

3. Targets that matter to the business
Metric	Now	Target	Why
Freshness of high-risk accounts (deadline ≤ 7 days)	up to 52 min	≤ 15 min	Risk-based scheduling (§4.4)
Full cycle, all accounts	52 min	≤ 20 min at 26 accounts, ≤ 60 min at 100	Concurrency 3 plus session reuse
Event → delivery latency (p95)	~10–20 s	≤ 5 s	2 s outbox poll
Lost notifications	unknown	0 (outbox and dead-letter alerting)	
Duplicate notifications	n/a	< 0.5%	Idempotency keys
Time to detect the box being down	∞	≤ 10 min	External heartbeat
Recovery point objective (RPO)	∞	≤ 24 h (≤ 1 h optional)	Automated backups
Unplanned restarts / week	~20+	≤ 2	
4. Top 5 performance optimizations
All the impact figures are estimates. Benchmark before and after with the scan-timing metrics in §8.

Reuse ETA sessions per account (estimated 20–40% off each scan). Persist Playwright storageState per account, encrypted with DPAPI because it contains session cookies, and skip the login when the session is still valid. Logins are usually the slowest and most rate-limit-sensitive step.
Bounded parallelism with a global ETA rate limiter (52 → about 18–20 min). Use one Chromium instance with one BrowserContext per account, concurrency 3 (not 5: you don't know ETA's thresholds, so start low and raise it only after a week of clean metrics), a shared token bucket of about 1 request/s plus jitter, and backoff on 429/5xx. Code in §6.5.
Block heavy resources and remove fixed sleeps (estimated 15–30%). Abort image, font and media requests. Replace every waitForTimeout(…) with waitForSelector or waitForResponse. Find them with rg "waitForTimeout|setTimeout\(r, ?\d{4,}" harness/.
Risk-based and delta scheduling. Score accounts by nearest deadline, recent failures and unread portal messages. High-risk accounts get scanned every 15 min, quiet ones every 2–4 h. Scan documents less often than obligations. Skip parsing when a section's response hash hasn't changed. This makes freshness better where it matters, whatever the account count.
Fix Arabic PDF text before reaching for OCR (about 30 s → under 2 s per text PDF). Most ETA-generated PDFs have a text layer. pdfjs output "looks broken" mostly because it returns Arabic presentation-form glyphs (U+FB50–U+FEFF) in visual order. NFKC normalisation plus RTL reordering fixes most of this (§6.10). Only genuinely scanned pages need OCR. Also update pdfjs-dist, since 3.11.174 is several major versions old.
Bonus: the outbox query hits a partial index and polls every 2 s, so it costs microseconds. Don't add WebSockets or Redis for this.

5. Recommended architecture
5.1 Target topology (still one Windows machine, still SQLite)
Windows host - PM2 started at boot by Task Scheduler

ingest tx

claim/lease

claim/lease

heartbeat ping

probes /health

alerts

harness
scheduler + scan pool
conc=3, token bucket

SQLite WAL
sapauto.db

assistant
rules engine + LLM router

dispatcher
events -> outbox rows

wa-sender
whatsapp-web.js isolated

mail+telegram sender

launcher Next.js
auth + /health

mcp 127.0.0.1
least-privilege tools

llama-server
Gemma 4 E2B
127.0.0.1:7799

backup job nightly

External dead-man switch
optional

Uptime Kuma
2nd LAN machine

Telegram ops chat

Copy
5.2 Service changes
Change	Why
Split channels into dispatcher, wa-sender and mail-tg-sender	Contains the damage from WhatsApp crashes, and each piece can be restarted on its own
Replace the Flask wrapper around llama-cpp-python with llama.cpp's own llama-server	Native and maintained, OpenAI-compatible API, built-in prompt cache, grammar/JSON-constrained output, one less Python layer
Add a rules engine module in the assistant	Deadlines, penalty bands and escalations should be deterministic code with tests. The LLM only summarises and classifies.
Remove the dependency on SAPAuto3	Accounts live in the companies table plus the DPAPI store. Do a one-time import.
5.3 Migration path
Add the shared db.js (pragmas, busy timeout) and switch every service to it. No behaviour change.
Add the schema_migrations ledger and runner (§6.8). Back up first.
Add the outbox table. The dispatcher writes outbox rows alongside the current direct sending (shadow mode) for 3 days, and you compare counts.
Turn off direct sending and start the wa-sender and mail-tg-sender PM2 apps.
Add the harness pool at concurrency 1 (same as today but on the new code path), then go to 2, then 3, with a week of metrics at each step.
Swap Flask for llama-server behind the existing port 7799 so callers don't change.
5.4 Direct answers to the 17 questions in §7 of the brief
#	Answer
1	Six services is about right. Split channels into dispatcher plus per-transport senders and stop there. Splitting further adds operational load for no benefit.
2	Company count isn't what forces PostgreSQL. You'd move when you need more than one host writing, real multi-user concurrent editing, or replication. That's probably never at 100 companies. If it ever happens, a schema built on Kysely or plain SQL ports easily.
3	Keep polling between processes; it's simple and survives crashes. Use SSE only between the launcher and the browser, for live dashboard updates.
4	SQLite is enough. Use a small in-process LRU for dashboard aggregates if profiling shows it's needed. No Redis.
5	Rotating keys to dodge 429s is the wrong design. Use one key (paid with training opt-out if you use cloud at all), a circuit breaker, a queue, and local-first routing (§6.11).
6	Don't go below Q4. E2B is already small, and Q3 loses Arabic quality noticeably. If latency matters, try Q4_K_M versus Q4_0 and use the prompt cache instead.
7	No LangChain or LlamaIndex. Use versioned prompt templates in prompts/*.md, JSON-schema-constrained output, and golden-file evals.
8	Start with SQLite FTS5 with Arabic normalisation. Add sqlite-vec (a pure-C vector extension that loads into better-sqlite3 (sqlite-vec)) only if keyword search turns out to be too weak. No Chroma, Qdrant or Pinecone.
9	Concurrency 3, a global token bucket, jitter, session reuse, backoff on 429/5xx, and an automatic concurrency cut when error rates rise (§6.5).
10	Don't shard. If you ever needed to, it would be one DB file per tenant, not per company.
11	WhatsApp Web can't safely fan out to 1,000 recipients. Use a Telegram bot (free and built for bots), email digests, or the paid official WhatsApp Business Platform. Fan-out happens in the outbox, one row per recipient per channel, and is rate-limited per transport.
12	Don't try to encrypt the session folder itself (the library needs it readable). Use ACLs plus BitLocker plus device review, and on suspicion "log out all devices" and re-pair.
13	Prepared statements are safe for values. Identifiers (columns, ORDER BY, table names) need a whitelist. Audit commands are in §9.2.
14	Make the secret store support two active versions (current and next). Deploy the new one, restart the services one at a time, then revoke the old one. For MCP, accept both tokens during the switch.
15	JSDoc plus // @ts-check plus tsc --noEmit first. Convert to .ts file by file later, starting with db/ and rules/.
16	See §8.
17	Monorepo with npm workspaces.
5.5 Data model additions
Copy-- 027_outbox.sql
CREATE TABLE notification_outbox (
  id               INTEGER PRIMARY KEY,
  event_id         INTEGER NOT NULL REFERENCES events(id),
  channel          TEXT NOT NULL CHECK (channel IN ('whatsapp','email','telegram')),
  recipient        TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,          -- sha256(event_id|channel|recipient)
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sending','sent','failed','dead','uncertain')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  lease_owner      TEXT,
  lease_until      TEXT,
  last_error       TEXT,
  provider_msg_id  TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at          TEXT
);
CREATE INDEX ix_outbox_due ON notification_outbox(channel, next_attempt_at)
  WHERE status IN ('pending','failed');

-- 028_obligation_state.sql
ALTER TABLE obligations ADD COLUMN absent_scan_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE obligations ADD COLUMN review_state TEXT
  CHECK (review_state IN (NULL,'needs_review','confirmed_resolved','confirmed_open'));

-- 029_hot_indexes.sql
CREATE INDEX IF NOT EXISTS ix_obl_company_due ON obligations(company_id, due_date);
CREATE INDEX IF NOT EXISTS ix_obl_status_due  ON obligations(status, due_date);
CREATE INDEX IF NOT EXISTS ix_tasks_status_due ON tasks(status, due_date);
CREATE INDEX IF NOT EXISTS ix_events_created  ON events(created_at);

-- 030_scan_runs.sql  (feeds metrics and the risk scheduler)
CREATE TABLE scan_runs (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
  section TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  ok INTEGER, http_errors INTEGER DEFAULT 0, items INTEGER, content_hash TEXT, error TEXT
);
CREATE INDEX ix_scan_runs_company ON scan_runs(company_id, started_at);
Copy
Adjust the column names to your actual schema. Check for N+1 patterns: dashboard pages that loop over companies and query obligations one company at a time should use a single grouped query (GROUP BY company_id) or a json_group_array aggregate.

Retention: archive events and channel_deliveries older than 180 days to a monthly archive DB using ATTACH and INSERT…SELECT. Never auto-delete documents, obligations or payments. Tax records have statutory retention periods, so confirm the exact period with your accountant.

5.6 SOC 2-aligned controls (realistic version)
Access control (dashboard auth and roles), secrets management (DPAPI, rotation runbook), encryption at rest (BitLocker; optionally DB encryption via better-sqlite3-multiple-ciphers (npm), which is not file-compatible with SQLCipher (discussion)), an audit log table for every settings change and live-mode toggle, tested backups, change management (CI plus tagged releases), and incident runbooks. BitLocker plus ACLs gives you most of the value of DB-level encryption with no native-module risk, so do that first.

6. Code (drop-in modules)
6.1 db/connection.js: one connection policy for all six services
Copy// db/connection.js
import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.SAPAUTO_DB ?? path.resolve('data/sapauto.db');
let db;

export function getDb() {
  if (db) return db;
  db = new Database(DB_PATH, { timeout: 5000 });   // busy wait up to 5s
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');                // safe with WAL
  db.pragma('foreign_keys = ON');                   // per-connection!
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('wal_autocheckpoint = 1000');
  return db;
}

/** Write transaction that grabs the write lock up front (avoids BUSY upgrades). */
export function writeTx(fn) {
  const d = getDb();
  return d.transaction(fn).immediate();
}

export function closeDb() {
  if (!db) return;
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } finally { db.close(); db = undefined; }
}
Before turning foreign keys on, run PRAGMA foreign_key_check; once and fix any orphans, otherwise writes will start failing.

6.2 Outbox: claim, send, retry, dead-letter
Copy// channels/outbox.js
import crypto from 'node:crypto';
import { getDb, writeTx } from '../db/connection.js';
import { log } from '../lib/logger.js';

const BACKOFF_S = [60, 300, 900, 3600, 21600];      // 1m,5m,15m,1h,6h
const MAX_ATTEMPTS = BACKOFF_S.length;
const LEASE_S = 120;
const WORKER = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

export function enqueue({ eventId, channel, recipient, payload }) {
  const key = crypto.createHash('sha256').update(`${eventId}|${channel}|${recipient}`).digest('hex');
  getDb().prepare(`INSERT OR IGNORE INTO notification_outbox
      (event_id, channel, recipient, payload_json, idempotency_key)
      VALUES (?, ?, ?, ?, ?)`).run(eventId, channel, recipient, JSON.stringify(payload), key);
}

function claim(channel, limit) {
  return writeTx(() => {
    // Recover expired leases: rows stuck in 'sending' may or may not have been delivered.
    getDb().prepare(`UPDATE notification_outbox SET status='uncertain', lease_owner=NULL
      WHERE status='sending' AND lease_until < strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run();

    return getDb().prepare(`UPDATE notification_outbox
       SET status='sending', lease_owner=?, attempts=attempts+1,
           lease_until=strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
     WHERE id IN (SELECT id FROM notification_outbox
                   WHERE channel=? AND status IN ('pending','failed')
                     AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
                   ORDER BY next_attempt_at LIMIT ?)
     RETURNING *`).all(WORKER, `+${LEASE_S} seconds`, channel, limit);
  });
}

export async function drain(channel, sendFn, { batch = 5, gapMs = 1500 } = {}) {
  for (const row of claim(channel, batch)) {
    try {
      const providerId = await sendFn(row.recipient, JSON.parse(row.payload_json));
      getDb().prepare(`UPDATE notification_outbox SET status='sent', provider_msg_id=?,
          sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), lease_owner=NULL WHERE id=?`)
        .run(providerId ?? null, row.id);
      log.info({ outboxId: row.id, eventId: row.event_id, channel }, 'delivered');
    } catch (err) {
      const dead = row.attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_S[Math.min(row.attempts - 1, BACKOFF_S.length - 1)];
      getDb().prepare(`UPDATE notification_outbox SET status=?, last_error=?, lease_owner=NULL,
          next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) WHERE id=?`)
        .run(dead ? 'dead' : 'failed', String(err?.message ?? err).slice(0, 500), `+${delay} seconds`, row.id);
      log.warn({ outboxId: row.id, attempts: row.attempts, dead, err: err?.message }, 'delivery failed');
    }
    await new Promise(r => setTimeout(r, gapMs + Math.random() * 1000)); // human-like pacing
  }
}
Copy
uncertain rows are not retried automatically, because WhatsApp has no reliable "did it send?" check. They show up on the dashboard for one-click resend. That gives at-least-once delivery without silent duplicates.

6.3 Isolated WhatsApp sender with supervisor
Copy// channels/wa-sender.js  (its own PM2 app)
import pkg from 'whatsapp-web.js';
import { drain } from './outbox.js';
import { log } from '../lib/logger.js';
import { installShutdown } from '../lib/shutdown.js';
const { Client, LocalAuth } = pkg;

// Known library behaviour: stale Puppeteer tasks reject after disconnect (wwebjs #3904).
process.on('unhandledRejection', (err) => {
  const msg = String(err?.message ?? err);
  if (/Protocol error|Session closed|Target closed|Execution context was destroyed/.test(msg)) {
    log.warn({ err: msg }, 'suppressed puppeteer teardown rejection');
    ready = false; scheduleReconnect();
    return;
  }
  log.fatal({ err: msg }, 'unhandled rejection'); process.exit(1);
});

let client, ready = false, attempt = 0, reconnectTimer;

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(300_000, 5_000 * 2 ** attempt++) + Math.random() * 3000;
  log.info({ delay }, 'wa reconnect scheduled');
  reconnectTimer = setTimeout(async () => { reconnectTimer = null; await start(); }, delay);
}

async function start() {
  try { await client?.destroy(); } catch {}
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: process.env.WA_AUTH_DIR ?? '.wwebjs_auth' }),
    puppeteer: { headless: true, args: ['--disable-gpu'] },
  });
  client.on('ready', () => { ready = true; attempt = 0; log.info('wa ready'); });
  client.on('auth_failure', (m) => { ready = false; log.error({ m }, 'wa auth failure - re-pair required'); });
  client.on('disconnected', (reason) => { ready = false; log.warn({ reason }, 'wa disconnected'); scheduleReconnect(); });
  try { await client.initialize(); } catch (e) { log.error({ err: e.message }, 'wa init failed'); scheduleReconnect(); }
}

async function send(recipient, payload) {
  if (!ready) throw new Error('wa not ready');
  const msg = await client.sendMessage(`${recipient.replace(/\D/g, '')}@c.us`, payload.text);
  return msg?.id?._serialized;
}

const loop = setInterval(() => { if (ready) drain('whatsapp', send).catch(e => log.error(e)); }, 3000);
installShutdown(async () => { clearInterval(loop); try { await client?.destroy(); } catch {} });
start();
Copy
Keep the sending rate low on purpose: 1–3 s between messages with jitter and digest batching. With an unofficial client, the danger is the number getting banned, not slow sends. Write each sender's status to a service_status table so /health can report it.

6.4 Structured logging with redaction (lib/logger.js)
Copyimport pino from 'pino';
const service = process.env.SERVICE_NAME ?? 'unknown';
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service, pid: process.pid },
  redact: { paths: ['*.password', '*.token', '*.apiKey', '*.authorization', 'headers.authorization',
                    '*.MISTRAL_API_KEY', '*.cookie', '*.storageState'], censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.transport({
  targets: [
    { target: 'pino-roll', options: { file: `logs/${service}`, frequency: 'daily', size: '100m',
                                      mkdir: true, extension: '.log', limit: { count: 14 } } },
    { target: 'pino/file', options: { destination: 1 } },  // stdout for pm2 logs
  ],
}));
export const child = (ctx) => log.child(ctx); // e.g. child({ runId, companyId })
pino-roll rotates logs in-process by size and/or frequency (pino-roll). Put a runId on every scan and an eventId on every delivery. Those are your correlation IDs, and you don't need Jaeger for them.

6.5 Harness: bounded pool, global token bucket, adaptive backoff
Copy// harness/pool.js
export class TokenBucket {
  constructor(ratePerSec, burst) { this.rate = ratePerSec; this.cap = burst; this.tokens = burst; this.t = Date.now(); }
  async take() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.cap, this.tokens + (now - this.t) / 1000 * this.rate); this.t = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise(r => setTimeout(r, ((1 - this.tokens) / this.rate) * 1000 + Math.random() * 250));
    }
  }
  slowDown(f = 0.5) { this.rate = Math.max(0.2, this.rate * f); }
  recover(max = 1) { this.rate = Math.min(max, this.rate * 1.1); }
}

export async function mapPool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await fn(items[i], i) }; }
      catch (e) { out[i] = { status: 'rejected', reason: e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
Copy// harness/cycle.js (sketch)
import { chromium } from 'playwright';
import { TokenBucket, mapPool } from './pool.js';
const bucket = new TokenBucket(1, 3);                 // ~1 req/s across ALL accounts
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 3);

export async function runCycle(accounts /* sorted by risk score desc */) {
  const browser = await chromium.launch({ headless: true });
  try {
    return await mapPool(accounts, CONCURRENCY, async (acct) => {
      const context = await browser.newContext({ storageState: await loadState(acct.id) /* DPAPI */, locale: 'ar-EG' });
      await context.route('**/*', r => ['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue());
      context.on('request', () => {}); // hook point for metrics
      try {
        const page = await context.newPage();
        page.on('response', res => { if ([429, 503].includes(res.status())) bucket.slowDown(); });
        const result = await scanAccount(page, acct, { throttle: () => bucket.take() });
        await saveState(acct.id, await context.storageState());   // session reuse next time
        bucket.recover();
        return result;
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
}
Validate every scraped section with a zod schema before ingesting. If validation fails, mark the scan ok=0 and don't count it toward absent_scan_streak. That's how a change to the portal's HTML gets caught instead of quietly "resolving" obligations.

6.6 Dashboard authentication (free, local, no OAuth needed)
For a single-office tool, OAuth adds an internet dependency and a lot of complexity. Use:

A users table with argon2id password hashes (@node-rs/argon2), and roles owner | operator | viewer.
Sessions in an encrypted, HttpOnly, SameSite=Strict cookie (iron-session), with an 8-hour idle timeout.
Next.js middleware.ts that blocks everything except /login and /health.
TOTP 2FA (otplib) required for owner actions: toggling live mode, editing recipients, deleting a company.
Login attempts limited to 5 per 15 minutes per IP, with an audit log row for every privileged action.
TLS for LAN/VPN: Caddy (free, single binary) in front of 127.0.0.1:3000 using its internal CA, with the root certificate installed on office devices. Let's Encrypt can't issue for private IPs, so the brief's plan won't work. Next.js then binds to localhost only, and the firewall allows 443 from specific Radmin peer IPs only.
6.7 Graceful shutdown on Windows
Copy// lib/shutdown.js
import { closeDb } from '../db/connection.js';
import { log } from './logger.js';
export function installShutdown(cleanup, timeoutMs = 25_000) {
  let done = false;
  const run = async (why) => {
    if (done) return; done = true;
    log.info({ why }, 'shutting down');
    const t = setTimeout(() => process.exit(1), timeoutMs).unref();
    try { await cleanup(); } catch (e) { log.error(e); }
    closeDb(); clearTimeout(t); process.exit(0);
  };
  process.on('message', (m) => m === 'shutdown' && run('pm2-message')); // Windows path
  process.on('SIGINT', () => run('SIGINT'));
  process.on('SIGTERM', () => run('SIGTERM'));
}
On Windows, PM2 has no real signals, so you need shutdown_with_message (PM2 docs). There's an open PM2 bug where pm2 restart with shutdown_with_message on Windows can start two replacement processes (PM2 #6142). Protect against it with a single-instance lease in SQLite (a service_locks row with owner PID and an expiry renewed every 10 s). A second copy that can't get the lease exits. The harness also needs this anyway so you never get two scan cycles at once.

Copy// ecosystem.config.cjs (excerpt)
const common = { watch: false, autorestart: true, exp_backoff_restart_delay: 200,
  max_restarts: 50, min_uptime: '30s', kill_timeout: 30000, shutdown_with_message: true,
  max_memory_restart: '600M', env: { NODE_ENV: 'production' } };
module.exports = { apps: [
  { ...common, name: 'sapauto-v8-harness',   script: 'harness/index.js',      env: { ...common.env, SERVICE_NAME: 'harness' } },
  { ...common, name: 'sapauto-v8-dispatcher',script: 'channels/dispatcher.js',env: { ...common.env, SERVICE_NAME: 'dispatcher' } },
  { ...common, name: 'sapauto-v8-wa',        script: 'channels/wa-sender.js', env: { ...common.env, SERVICE_NAME: 'wa' }, max_memory_restart: '900M' },
  { ...common, name: 'sapauto-v8-mailtg',    script: 'channels/mailtg-sender.js', env: { ...common.env, SERVICE_NAME: 'mailtg' } },
  { ...common, name: 'sapauto-v8-assistant', script: 'assistant/manager.js',  env: { ...common.env, SERVICE_NAME: 'assistant' } },
  { ...common, name: 'sapauto-v8-launcher',  script: 'node_modules/next/dist/bin/next', args: 'start -p 3000 -H 127.0.0.1', cwd: 'launcher' },
  { ...common, name: 'sapauto-v8-mcp',       script: 'mcp/server.js' },
  { name: 'sapauto-v8-llm', script: 'bin/llama-server.exe', interpreter: 'none',
    args: '-m models/gemma-4-E2B-it-Q4_0.gguf --host 127.0.0.1 --port 7799 -c 8192 --jinja', autorestart: true },
]};
The 21 launcher restarts: check these first. (a) watch: true in the current ecosystem file. SQLite WAL files and .wwebjs_cache change constantly, which would trigger watch restarts, and this alone could explain both the launcher and channels counts. (b) Running next dev instead of next build && next start. (c) Memory growth. Run pm2 describe sapauto-v8-launcher and look at the restart reason, and check pm2 logs --err --lines 500.

6.8 Migration runner with checksum ledger
Copy// db/migrate.js
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { getDb } from './connection.js';
const DIR = path.resolve('db/migrations');
export function migrate() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL,
           applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const applied = new Map(db.prepare('SELECT name, checksum FROM schema_migrations').all().map(r => [r.name, r.checksum]));
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    const sum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(f)) { if (applied.get(f) !== sum) throw new Error(`Migration ${f} was edited after apply`); continue; }
    db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations(name, checksum) VALUES (?,?)').run(f, sum); }).immediate();
    console.log('applied', f);
  }
}
The first time, backfill the ledger for the 26 existing migrations without executing them, using a --baseline flag. Every service should check at startup that its expected latest migration exists, and refuse to start otherwise.

6.9 Backups (nightly, tested)
Copy// scripts/backup.js  (Task Scheduler, 02:30 daily)
import fs from 'node:fs'; import path from 'node:path';
import { getDb } from '../db/connection.js';
const dir = process.env.BACKUP_DIR ?? 'D:/sapauto-backups';
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `sapauto-${new Date().toISOString().slice(0, 10)}.db`);
await getDb().backup(file);                                  // online, consistent
const chk = new (await import('better-sqlite3')).default(file, { readonly: true });
if (chk.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('backup integrity failed');
chk.close();
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort().slice(0, -14)) fs.rmSync(path.join(dir, f));
Copy backups to a second physical disk or USB drive, plus an optional off-site copy encrypted with rclone crypt or 7-Zip AES. Back up .wwebjs_auth/ and the DPAPI blobs too. DPAPI blobs only decrypt under the same Windows user on the same machine, so also keep an offline export of the secrets (in a password manager), or a hardware failure means re-entering all 26 credentials. Do a restore drill once a month.

6.10 Arabic PDF text repair (before OCR)
Copy// assistant/arabic-text.js
const PRES_FORMS = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC = /[\u0600-\u06FF]/;
export function normalizeArabic(s) {
  let t = s.normalize('NFKC');                          // presentation forms -> base letters
  t = t.replace(/[\u064B-\u0652\u0640]/g, '');          // strip harakat + tatweel for search
  t = t.replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه'); // search-key folding (keep original too!)
  return t;
}
/** pdfjs items from visually-ordered PDFs come out reversed per line. */
export function fixLineOrder(line, knownWords = ['ضريبة', 'الضرائب', 'إقرار', 'مصلحة']) {
  if (!ARABIC.test(line)) return line;
  const rev = [...line].reverse().join('');
  const score = (x) => knownWords.filter(w => x.includes(w)).length;
  return score(rev) > score(line) ? rev : line;
}
export const needsOcr = (text, pages) => text.replace(/\s/g, '').length < 40 * pages; // no text layer
Store both the ocr_text_raw and search_text (folded) columns, and build an FTS5 index on search_text. Send only pages flagged by needsOcr to OCR. Benchmark Tesseract 5 ara (tessdata_best) against Gemma 4's image input on 30 real scanned ETA pages, and pick whichever has the lower character error rate. Be careful with PaddleOCR: there are reports of it recognising Arabic characters correctly but returning them in left-to-right order (PaddleOCR #14971).

6.11 LLM router: local first, circuit breaker, never crashes
Copy// assistant/llm-router.js
import { log } from '../lib/logger.js';
class Breaker {
  constructor(name, { fails = 3, coolMs = 120_000 } = {}) { Object.assign(this, { name, fails, coolMs, n: 0, openUntil: 0 }); }
  get open() { return Date.now() < this.openUntil; }
  ok() { this.n = 0; }
  bad() { if (++this.n >= this.fails) { this.openUntil = Date.now() + this.coolMs; log.warn({ p: this.name }, 'breaker open'); } }
}
const local = new Breaker('local', { fails: 2, coolMs: 30_000 });
const cloud = new Breaker('cloud', { fails: 2, coolMs: 15 * 60_000 });

async function callLocal(messages, schema, timeoutMs = 60_000) {
  const res = await fetch('http://127.0.0.1:7799/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ messages, temperature: 0.1, cache_prompt: true,
      ...(schema && { response_format: { type: 'json_schema', json_schema: { name: 'out', schema } } }) }),
  });
  if (!res.ok) throw new Error(`local ${res.status}`);
  return (await res.json()).choices[0].message.content;
}

/** sensitivity: 'client' = contains taxpayer data -> local only. */
export async function complete({ messages, schema, sensitivity = 'client' }) {
  if (!local.open) {
    try { const out = await callLocal(messages, schema); local.ok(); return { out, provider: 'local' }; }
    catch (e) { local.bad(); log.warn({ err: e.message }, 'local llm failed'); }
  }
  if (sensitivity === 'client' || cloud.open || !process.env.CLOUD_LLM_ENABLED) {
    return { out: null, provider: 'none', deferred: true };   // caller queues & retries; rules engine still alerts
  }
  try { const out = await callCloud(messages, schema); cloud.ok(); return { out, provider: 'cloud' }; }
  catch (e) { cloud.bad(); if (/429/.test(e.message)) log.warn('cloud rate-limited'); return { out: null, deferred: true }; }
}
Copy
The key design rule is that deadline and penalty alerts never depend on an LLM. They come from the rules engine. If every model is down, you lose summaries, not alerts. That also fixes the assistant crashes on 429. Check the response_format shape against your llama-server build. Cache responses by sha256(model|prompt|schema) in a llm_cache table.

6.12 /health endpoint (launcher)
Copy// launcher/app/api/health/route.js
import { getDb } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET() {
  const db = getDb(); const now = Date.now();
  const age = (iso) => iso ? Math.round((now - Date.parse(iso)) / 1000) : null;
  const hb = db.prepare(`SELECT service, last_heartbeat, status FROM service_status`).all();
  const outbox = db.prepare(`SELECT
      SUM(status IN ('pending','failed')) AS backlog, SUM(status='dead') AS dead, SUM(status='uncertain') AS uncertain,
      MIN(CASE WHEN status IN ('pending','failed') THEN created_at END) AS oldest FROM notification_outbox`).get();
  const services = Object.fromEntries(hb.map(s => [s.service, { status: s.status, heartbeatAgeS: age(s.last_heartbeat) }]));
  const unhealthy = hb.some(s => age(s.last_heartbeat) > 180) || outbox.dead > 0 || age(outbox.oldest) > 900;
  return Response.json({ ok: !unhealthy, services, outbox: { ...outbox, oldestAgeS: age(outbox.oldest) } },
                       { status: unhealthy ? 503 : 200 });
}
Point Uptime Kuma at it and add a keyword monitor for "ok":true.

7. AI/ML improvements
Accuracy. Use JSON-schema-constrained outputs for every extraction task (obligation type, due date, amount, form code), validate them with zod, and reject and retry once. Keep a golden set of about 50 real documents with expected JSON and run it in CI with npm run eval. A prompt change that lowers the exact-match score fails the build. Prompts live in prompts/*.md with a version number logged next to every output.

Latency. Moving to llama-server with cache_prompt reuses the system prompt's KV cache, so repeated analyses only process the new tokens. Keep -c 8192, pre-truncate document text to the relevant pages, and use the rules engine to decide whether a call is needed at all. Most 30-second cycles shouldn't call a model.

Cost and privacy. Local by default. If you want a cloud fallback, use a paid tier with training opt-out on non-client data only. At this volume the cost is likely pennies a month, well under budget. Drop key-pool rotation. OpenCode code proposals should run on a sanitised copy of the repo with no .env, data/ or auth folders.

Conversation memory. An assistant_conversations table with a 10-message window per user. RAG is FTS5 over search_text, top-k chunks, with citations back to company_documents.id. The system is offline-capable and needs no new services.

8. Testing strategy
Aiming for 95% coverage across a scraper-heavy codebase produces brittle tests. Aim for ≥ 85% line coverage on domain code (rules/, ingest/, channels/outbox, db/) and verify the edges with contract tests.

Layer	What	Tooling (free)	Count
Unit	Deadline and penalty math, Arabic normalisation, backoff, token bucket	node --test	many
Contract	Saved, anonymised ETA HTML/JSON fixtures → scraper parsers → zod schemas. Refresh fixtures monthly from real scans.	node --test + fixtures	1 per section
Integration	Fixture scan → ingest (in-memory SQLite + all migrations) → task engine → events → outbox (fake transports)	node --test, :memory: DB	~20
Migration	Apply all migrations to an empty DB and to an anonymised copy of production; foreign_key_check clean	script	CI
E2E	Login, dashboard loads, live-mode toggle needs TOTP, review queue	Playwright	~10
LLM eval	Golden extraction set	custom script	50 docs
Canary (production)	Daily synthetic check: scrape one known account section and validate the schema. Alert on drift.	harness job	1
Coverage: node --test --experimental-test-coverage. Also fix the one failing test or quarantine it with a linked issue, so the suite isn't permanently red.

9. Code quality: audit commands in place of line references
9.1 Inventory
Copynpx cloc . --exclude-dir=node_modules,.next,data,.wwebjs_auth,.wwebjs_cache,logs
npm ls --depth=0 ; npm outdated ; npm audit --omit=dev
9.2 Grep audits (rg = ripgrep)
Copyrg -n "prepare\(\s*`[^`]*\$\{" --type js          # dynamic SQL in template literals
rg -n "(ORDER BY|WHERE).*\+\s*\w" --type js         # string-concatenated SQL
rg -n "catch\s*(\(\w+\))?\s*\{\s*(\}|/\*)" --type js # swallowed errors
rg -n "console\.(log|error|warn)" --type js -c      # logging migration progress
rg -n "\b(10000|30000|60000|120000|300000)\b" --type js  # magic timeouts -> config
rg -n "waitForTimeout" harness/                      # fixed sleeps
rg -n "SAPAuto3|accounts\.txt" .                     # legacy coupling
rg -n "process\.env\.\w*(KEY|TOKEN|SECRET)" .        # secret reads -> secure-store
9.3 Rules
Config module (lib/config.js): every interval and timeout comes from one zod-validated object (env, then the DB settings table, then defaults). No magic numbers.
Identifier whitelist for any dynamic column or ORDER BY: const COLS = new Set(['due_date','status']); if (!COLS.has(col)) throw ….
Error policy: no empty catch. Either handle (with a fallback plus a log), rethrow with cause, or let it crash so PM2 restarts the process. Every top-level loop gets a try/catch around one iteration so one bad account never kills the loop.
Types: add jsconfig.json with checkJs: true, strict: true, // @ts-check on new and touched files, tsc --noEmit in CI. Generate row types from the schema with kysely-codegen, used for types only.
Lint/format: ESLint flat config plus Prettier, and eslint-plugin-security for the obvious footguns.
10. Deployment and CI
CI (free): GitHub Actions is free for public repos and self-hosted runners. Private repos get 2,000 minutes a month on the Free plan, and Windows minutes cost more than Linux (GitHub Docs). Run lint and tests on Linux for every push, and a Windows smoke test (native modules: better-sqlite3, Playwright) only on tags. Don't put a self-hosted runner on the production machine, because a compromised workflow would then mean a compromised tax-credentials host.

Copy# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npm run lint && npx tsc --noEmit -p jsconfig.json
      - run: node --test --experimental-test-coverage
      - run: npm audit --omit=dev --audit-level=high
  windows-smoke:
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci && npx playwright install chromium && npm run test:smoke
Add Dependabot (free) for npm and GitHub Actions, with weekly grouped PRs.

Near-zero-downtime release on one Windows machine:

Releases unpack to C:\sapauto\releases\v8.x.y\, and C:\sapauto\current is a directory junction (mklink /J).
scripts/release.ps1: back up the DB, run npm ci --omit=dev, next build inside the new release folder, run migrations (they must be expand-only: add columns and tables, never drop or rename in the same release), switch the junction, then pm2 reload ecosystem.config.cjs, then poll /health for 120 s.
If health fails: switch the junction back and pm2 reload. Because migrations are expand-only, the old code still runs on the new schema. Contraction migrations (drops) ship one release later.
Workers don't need blue/green. Outbox leases and scan leases mean a 5-second restart loses nothing. Only the launcher matters to users, and a few seconds of reload is fine for an internal dashboard.
11. What we're deliberately not doing
Proposal in the brief	Decision	Reason
PostgreSQL migration	Rejected (revisit only for multi-host)	No concurrency problem exists, and it adds an always-on server on Windows
Redis / BullMQ / pub-sub	Rejected	The SQLite outbox gives durability with zero new infrastructure
Kubernetes, Docker for channels	Rejected	Windows plus WhatsApp-in-Chromium plus DPAPI fit containers badly
Event sourcing / CQRS	Rejected	events plus the audit log already give you the history you need
Prometheus + Grafana + Loki + Jaeger	Deferred	/health, scan_runs, pino files and Uptime Kuma cover the need. Add Prometheus (prom-client) later only if dashboards are wanted.
Sharding	Rejected	Not needed at 100 companies or 1,000 users
Q3 quantisation	Rejected	Arabic quality loss for a small gain
LangChain / LlamaIndex / vector DB service	Rejected	FTS5, then sqlite-vec if needed
OAuth via Google/Microsoft	Rejected for now	Internet dependency. Local auth plus TOTP covers it.
Multiple free API keys for rate limits	Stop	Likely against the terms, and taxpayer data may be used for training
12. Monitoring and alerting checklist
Signal	Source	Warn	Critical	Alert channel
Machine/process alive	External heartbeat	1 missed (5 min)	2 missed	Email + Telegram
Harness heartbeat age	service_status	> 3 min	> 10 min	Telegram
WhatsApp sender ready	service_status	not ready 5 min	30 min	Telegram/email (not WA)
Outbox oldest pending	outbox	> 5 min	> 15 min	Telegram
Outbox dead / uncertain	outbox	≥ 1	≥ 5	Telegram + dashboard
Scan failure rate (1 h)	scan_runs	> 10%	> 30% (or 3 in a row for an account)	Telegram
Schema-validation failures	scan_runs.error	≥ 1 section	≥ 3 accounts	Telegram (portal changed)
High-risk account staleness	scan_runs	> 20 min	> 60 min	Telegram
429/503 from ETA	harness logs	> 5/h	> 20/h	Telegram, plus automatic concurrency cut
PM2 restarts per service	pm2 jlist job	> 3/day	> 10/day	Telegram
Disk free (data drive)	job	< 15%	< 5%	Telegram
DB size / WAL size	job	WAL > 200 MB	WAL > 1 GB	Telegram
Backup age / integrity	backup job	> 26 h	failed check	Email
.wwebjs_auth + cache size	job	> 1 GB	> 3 GB	Telegram
Tasks past 60-day band	rules engine	≥ 1 (daily digest)	new one appears	WhatsApp to owner + dashboard
Obligations needing review	review queue	> 0 for 48 h	> 0 for 7 days	Daily digest
Local LLM availability	breaker state	open > 10 min	open > 1 h	Dashboard only
Login failures	audit log	> 10/h	> 50/h	Telegram
13. Roadmap (12 weeks, $0 required)
Phase 0, next 48 hours (emergency):

Revoke the Mistral key that leaked into logs and pause cloud LLM calls that contain client data.
Restrict the TCP 3000 firewall rule to specific peer IPs, or bind to 127.0.0.1 until auth ships.
Run a manual DB backup plus integrity_check, and copy it to a second disk.
Check the ecosystem file for watch: true, and read the restart reasons with pm2 describe.
Set up the Task Scheduler "At startup" PM2 resurrect task and the BIOS power-restore setting.
Lock down .wwebjs_auth/ and accounts.txt with icacls, and review linked WhatsApp devices.
Phase 1, weeks 1–2 (stability): shared db.js with pragmas, migration ledger, nightly backups with restore drill, pino logging with redaction, graceful shutdown plus single-instance leases, outbox in shadow mode then cut over, WhatsApp isolated in its own process, /health, Uptime Kuma, external heartbeat.

Phase 2, weeks 3–4 (security): import ETA credentials into DPAPI and remove the SAPAuto3 dependency, local auth with roles and TOTP, audit log, Caddy TLS, MCP least privilege and token in DPAPI, two-version secret rotation runbook, BitLocker, PDPL review with counsel.

Phase 3, weeks 5–7 (scale and performance): scan_runs metrics, then session reuse, resource blocking and removing fixed sleeps, then the pool at concurrency 2 and then 3, risk-based scheduler, zod scrape validation, obligation state machine plus review queue, penalty escalation, hot indexes, N+1 cleanup, user channel management UI with verification codes, Telegram as the scalable free channel.

Phase 4, weeks 8–10 (AI): llama-server swap, LLM router plus breaker plus cache, rules engine extracted from the assistant, constrained JSON extraction plus golden eval set, Arabic text repair, OCR benchmark (Tesseract against Gemma vision), FTS5 search, conversation memory.

Phase 5, weeks 11–12 and ongoing (DX): CI plus Dependabot, contract and integration tests up to the coverage targets, @ts-check across touched files, config module, junction-based releases with rollback, runbooks (WhatsApp re-pair, restore from backup, ETA portal change, secret rotation), updated README and architecture diagram.

Definition of done for V8.1: zero lost notifications for 30 days, ≤ 2 unplanned restarts a week, high-risk freshness ≤ 15 min, a restore drill completed, no plaintext secrets on disk or in logs, the dashboard behind auth plus TLS, and no client data sent to free-tier cloud models.