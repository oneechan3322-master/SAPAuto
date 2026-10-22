# SAPAuto V8.1 — Codebase Study (for local-LLM upgrade proposals)

**Purpose:** Give a local LLM (Gemma 4 E2B / Mistral) everything it needs to propose concrete, code-level upgrades to SAPAuto V8.1.  
**Scope:** The `v8.1/` tree as it exists on 2026-10-22 (Phase 0–1 complete, Phase 2 in flight, sender split live, outbox in shadow by default).  
**Read order for an LLM:** §1 system map → §2 module map → §3 data model → §4 invariants → §5 known gaps → §6 upgrade candidates → §7 constraints.

---

## 1. What the system does

SAPAuto V8.1 is an **Egyptian tax-authority (ETA) operations monitor** for ~26 taxpayer companies. It scrapes the ETA portal read-only, tracks 800+ obligations, 196 tasks, ~140 payments, ~300 messages, 187 PDFs, and pushes WhatsApp/Telegram/email notifications to a control number and verified user channels. It runs 8 PM2 processes on one Windows machine, stores everything in one SQLite WAL file, and uses a local Gemma 4 E2B model (llama.cpp on `127.0.0.1:7799`) plus an optional Mistral cloud lane.

**Non-negotiables:** Windows-only, offline-capable, Arabic/RTL, read-only portal access, no client data to free cloud tiers, no plaintext secrets.

---

## 2. Service topology (PM2, 8 apps)

| # | PM2 name | Script | Role |
|---|---|---|---|
| 0 | `sapauto-v8-harness` | `harness/index.js` | Portal scanning (sequential accounts), ingest, schedules, heartbeats |
| 1 | `sapauto-v8-channels` | `channels/index.js` | Event dispatcher (10s), command polling, credential sync, digest |
| 2 | `sapauto-v8-wa-sender` | `channels/wa-sender.js` | Sole WhatsApp client owner; drains `channel='whatsapp'` outbox rows |
| 3 | `sapauto-v8-mailtg-sender` | `channels/mailtg-sender.js` | Drains `telegram`+`email` outbox rows; 30s cred resync |
| 4 | `sapauto-v8-assistant` | `assistant/manager.js` | 30s attention cycle, visor sweep, OpenCode probe |
| 5 | `sapauto-v8-local-model` | `assistant/local-model-server.py` | Gemma 4 E2B on port 7799 (autorestart off) |
| 6 | `sapauto-v8-mcp` | `mcp/server.js` | MCP streamable HTTP on 127.0.0.1:3101, bearer-protected |
| 7 | `sapauto-v8-launcher` | `launcher/.../next start` | Next.js 16 dashboard on 127.0.0.1:3000 |

All share `data/sapauto.db`. Each writes its own `service_status` heartbeat row (`lib/heartbeat.js`) every 30s. `/api/health` (launcher) returns 503 if any heartbeat >180s, dead outbox >0, or oldest backlog >900s.

---

## 3. Module map

### 3.1 `db/`
- `connect.js` — `openDatabase()` applies WAL, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`, `temp_store=MEMORY`. `writeTx(fn, db)` = `.transaction(fn).immediate()`. Singleton `getDatabase()`.
- `migrate.js` — checksum-ledger runner (`schema_migrations(name,checksum,applied_at)`); baseline-backfills rows without checksum; refuses edited-after-apply migrations. 33 migrations (`001_core.sql` … `033_outbox_reindex.sql`).
- `queries/shared.js` — `audit(db,{actorId,action,entityType,entityId,details})`, `now()`, `id(prefix)`.
- `queries/{commands,companies,harness,messages,obligations,payments,tasks}.js`

### 3.2 `lib/` (infra)
- `heartbeat.js` — `service_status` writer.
- `lease.js` — `service_locks` single-instance lease with renewal + `onLost`. Used by harness.
- `logger.js` — pino + redaction list (all secrets). File logs only when `SERVICE_NAME` set.
- `shutdown.js` — `installShutdown(cleanup,{timeoutMs})` handles PM2 `shutdown` message + SIGINT/SIGTERM.

### 3.3 `harness/`
- `index.js` — main: migrate → lease → heartbeat → PDF scan+ingest → commands worker → schedules → `runLoop`.
- `loop.js` — `runCycle` (sequential accounts, pause-aware, quiet hours, command queue), `reconcileInterruptedCycles` (marks `running` → `interrupted`).
- `source.js` — `listAccounts(db)` reads the native `accounts` table (no SAPAuto3 dependency).
- `accounts.js` — AES-256-GCM credential store keyed by `data/accounts.key` (or `V8_ACCOUNTS_KEY`).
- `heartbeat.js` (harness-level), `commands.js`, `schedules.js`, `ingest.js`, `run-account.js`, `verifier.js`, `manifest.js`, `quiet-hours.js`, `reconcile.js`, `deadlines.js`, `backup.js`.
- `scraper/` — Playwright portal automation (documents, obligations, forms, payments, messages, payroll), storage, tasks. ~60 files.
- `scraper/automation/portal/*` — UI5 helpers, scrapers per section.

### 3.4 `channels/`
- `index.js` — dispatcher host: syncs telegram/gmail creds (15s), runs event dispatcher with `{}` providers, processes command queue (channel_test, wake_doc, wake_doc_email), daily digest (60s), heartbeat with outbox stats.
- `events.js` — `messageMode`, `outboxMode`, `deliverEvent`, `startEventDispatcher`, `checkHarnessOffline`, `enqueueDueReminders`, `flushWakeBacklog`. Outbox shadow/live/off. Wake batching (5+ batchable → grouped digest). Hourly wake grouping key `wake-group-YYYY-MM-DDTHH`.
- `outbox.js` — transactional outbox: `enqueue` (idempotency key `sha256(event|channel|recipient)` + `:shadow` suffix), `claim` (lease), `markSent/markFailed`, `defer` (transport outage, no attempt penalty), `resetForResend`, `drain`, `outboxStats`. Backoff `[60,300,900,3600,21600]s`, max 5 attempts, 120s lease.
- `wa-sender.js` — sole WhatsApp client owner; lease `wa-sender`; drains `channel='whatsapp'`; pairing/registry lifecycle; batch 3, gapMs 2500.
- `mailtg-sender.js` — lease `mailtg-sender`; drains `telegram`+`email`; 30s cred resync.
- `whatsapp.js` — whatsapp-web.js wrapper (QR, ready, send).
- `telegram.js` — `createTelegram(token)` → `{api}` where `api.sendMessage` returns `{result:{message_id}}`.
- `gmail.js` — `sendGmail(to,text,subject)`, `sendGmailDocument`.
- `secure-store.js` — DPAPI credential store (telegram, gmail).
- `daily-digest.js`, `email-templates.js`, `link-codes.js`, `send-report.js`, `whatsapp-intents.js`.

### 3.5 `assistant/`
- `manager.js` — `startAssistantManager({db,intervalMs,signal})` 30s cycle (configurable 5s–300s).
- `monitor.js` — `attentionItems` (due tasks/obligations/payments within 7d, harness offline, failures), `runAttentionCycle`, `synchronizeAttention` (dedup by `manager:` key, fires `assistant_attention` event on new/open).
- `model.js` — `localNovaUrl` (loopback-only validation), `chatGemma`, `chatMistral` (key pool from `MISTRAL_API_KEYS`), `chat` dispatcher.
- `live-analyst.js` — real-time analysis.
- `capabilities.js` — AI capability state (local/cloud/system_adviser), probes, pause/resume, audit.
- `code-proposals.js` — OpenCode CLI integration: source snapshot (excludes data/test/docs/scratch/scraper), credential redaction, sensitive-request validation, isolated temp dir, 180s timeout.
- `confirmations.js`, `pdf-reader.cjs`, `pdf-visor.cjs`, `document-title-resolver.cjs`, `prompt.js`, `run.js`, `paths.cjs`.
- `tools/` — `add-reminder`, `add-task`, `list-documents`, `list-failures`, `mark-obligation-done`, `request-code-upgrade`, `save-note`, `scan-now`, `send-pdf`, `send-pdf-email`, `send-report`, `status`, `summarize`, `index`.

### 3.6 `launcher/` (Next.js 16, React 19)
- `lib/db.js` — creates DB singleton, runs migrations (V8_ROOT = cwd/..).
- `lib/auth.js` — better-auth (email/password, min 12 chars, roles via additionalFields input:false, 12h session, modelNames users/sessions/user_accounts/verification, secure cookies only on https).
- `lib/guard.js` — `requireRole(request,minimum)` (Viewer/Operator/Owner levels), `requireSameOrigin`, `pageSession`, `pageSetupRequired`.
- `lib/open-access.js` — `V8_OPEN_ACCESS=1` bypass → first enabled Owner.
- `app/api/*` — accounts, accounts/verify, admin/users, archive, assistant/confirmations, auth/[...all], capabilities, channels, code-proposals, commands, companies/[id], export, health, kiosk, link-codes, messages, notes, obligations, payments, records/company-link, reminders, settings (+keys), setup, status, tasks.
- `app/(protected)/*` — archive, assistant, payroll, settings, [section]/[key], board, kamal.
- `components/*` — 30+ JSX components (navigation, settings-form, mission-board, etc.).
- `app/api/health/route.js` — /health (public, no business data).

### 3.7 `domain/` (shared CJS)
`ai-capabilities.cjs`, `bounded-text.cjs`, `channel-broker.cjs`, `company-identity.cjs`, `display-text.cjs`, `document-inspection.cjs`, `documents-archive.cjs`, `legal-deadlines.cjs`, `pdf-scanner.cjs`, `record-counts.cjs`, `record-status.cjs`, `secretary-rules.cjs`, `tax-classifier.cjs`.

### 3.8 `mcp/`
- `server.js` — MCP streamable HTTP, 127.0.0.1:3101, bearer token.

### 3.9 `assistant/local-model-server.py`
- Flask wrapper around llama-cpp-python for Gemma 4 E2B (port 7799). Plan wants swap to native `llama-server`.

---

## 4. Data model (key tables)

Core: `companies`, `obligations`, `tasks`, `payments`, `messages`, `events`, `channel_deliveries`, `users`, `user_channels`, `company_documents`, `accounts`, `settings`, `harness_status`, `assistant_manager_status`, `assistant_attention`, `failures`, `automation_cycles`, `account_status`, `reminders`, `reports`, `audit_log`, `scan_runs`, `service_status`, `service_locks`, `schema_migrations`, `notification_outbox`, `commands`, `ai_provider_state`, `ai_policy_event`, `code_upgrade_proposals`.

Key columns added by v8.1 migrations: `obligations.absent_scan_streak`, `review_state`; `notification_outbox.shadow`, `lease_*`, `attempts`, `next_attempt_at`, `provider_msg_id`; `scan_runs` table; `service_status` table; `service_locks` table.

Settings keys (string values): `message_mode` (`dry-run`|`live`), `outbox_mode` (`shadow`|`live`|`off`), `automation_enabled`, `assistant_manager_enabled`, `assistant_manager_interval_ms`, `quiet_hours`, `cycle_interval_min`, `ai_provider`, `ai_allow_cloud`, `opencode_proposals_enabled`, `whatsapp_wake_notifications`, `whatsapp_control_number`, `whatsapp_connected`, `whatsapp_pair_requested`.

---

## 5. Invariants & safety rules

1. **Portal is read-only.** No submission/payment/acceptance ever. `readOnlyGuarantees` in settings API.
2. **Live delivery requires** `message_mode='live'` + `confirm_live_delivery=true` + `liveDeliveryReady` (linked channels + configured provider).
3. **Outbox shadow rows never claimed** (`shadow=0` filter in `claim`).
4. **Idempotency key** `sha256(eventId|channel|recipient)` (+`:shadow`), `INSERT OR IGNORE`.
5. **Single-instance leases** prevent PM2 #6142 double-start.
6. **Foreign keys ON** per connection (db/connect.js).
7. **Local model loopback-only** (validated in `localNovaUrl`).
8. **OpenCode proposals** run in isolated temp dir, no tools, no .env/data/test/docs.
9. **Credential redaction** in logger; secrets never in logs.
10. **No client data to cloud LLM** without explicit consent; local-first.
11. **Graceful shutdown** via PM2 `shutdown` message (Windows has no signals).

---

## 6. Known gaps (from live run + code inspection)

1. **Dispatcher starvation** — FIXED: priority ordering for urgent kinds. But legacy backlog (~70 events) still churns every tick; could be archived.
2. **No file logger transport working** — `logs/` dir created but files stay 0 bytes (pino-roll config maybe needs `V8_LOG_FILE=1` or transport issue). Services log to PM2 files only.
3. **WhatsApp not paired** — no `.wwebjs_auth` in seed; Owner must re-pair via dashboard.
4. **No auth enforcement yet** — `V8_OPEN_ACCESS=1` in ecosystem; `requireRole('Admin')` is a no-op bug (4 sites). Phase 2 pending.
5. **No TOTP** — planned for settings PUT + accounts POST/DELETE.
6. **No login rate limiting** — planned in `auth/[...all]/route.js`.
7. **No companies DELETE route** — TOTP trio adapted to settings/accounts.
8. **Sequential account scanning** — 26 accounts × ~2min = 52min cycle. No parallelism, no session reuse.
9. **No Arabic text repair** for PDFs — pdfjs output may be reversed presentation forms.
10. **No OCR benchmark** — Tesseract vs Gemma vision not compared.
11. **No FTS5** search index yet.
12. **No conversation memory** for assistant.
13. **No scan_runs-driven risk scheduler** — scan_runs table exists but not used for risk-based scheduling.
14. **Account credentials use AES-256-GCM with file key** — not Windows DPAPI yet (plan S2).
15. **WhatsApp session unprotected** — ACLs done, but no BitLocker/encryption.
16. **No external dead-man switch** — heartbeat only internal.
17. **Migration count hardcoded** in some tests (fixed during Phase 1).
18. **`console.*` still used** in many modules — pino migration incomplete.
19. **No TypeScript** — pure JS, JSDoc sparse.
20. **No CI/CD** — manual deployment.
21. **`assistant/model.js` has Mistral key pool** but no circuit breaker / local-first router.
22. **No LLM response cache** — `llm_cache` table not yet created.
23. **No rules engine** — deadline/penalty logic embedded in monitor.js.
24. **Obligation state machine** (absent_scan_streak, review_state) columns exist but not wired into ingest.
25. **No retention policy** — events/deliveries accumulate.
26. **No backup automation** — manual only.
27. **No restore drill** ever performed.
28. **Dashboard has no HTTPS** — Caddy not deployed.
29. **No audit log viewer** in UI.
30. **MCP tools not least-privilege** — all tools available if token present.

---

## 7. Upgrade candidates (prioritized, code-level)

### P0 — Security (Phase 2, in flight)
- **Fix `requireRole('Admin')` → `'Owner'`** in `accounts/route.js:64,107,156` and `accounts/verify/route.js:8`. 'Admin' is not in ROLE_LEVEL → no-op.
- **Remove `V8_OPEN_ACCESS`** from ecosystem launcher env; flip to strict auth.
- **Login rate limiting** in `auth/[...all]/route.js` (5/15min per IP, audit row).
- **TOTP 2FA** for Owner actions: migration `034_user_totp.sql`, `launcher/lib/totp.js` (RFC 6238 + base32), `requireTotpConfirmation` on settings PUT + accounts POST/DELETE, endpoints under `settings/totp`.
- **Audit rows** for every privileged action (already partially there).

### P1 — Stability
- **Migrate `console.*` → `lib/logger.js`** across all modules; redact list already comprehensive.
- **External dead-man switch** — harness pings healthchecks.io or Uptime Kuma every 5min.
- **Backup automation** — `scripts/backup.js` with `db.backup()`, integrity check, 14-day retention, second disk copy.
- **Restore drill** — monthly, documented.
- **Fix pino-roll transport** — debug why `logs/` files stay empty.

### P2 — Performance
- **Parallel account scanning** — `mapPool` with concurrency 3, token bucket 1 req/s, session reuse via Playwright `storageState` (DPAPI-encrypted), resource blocking (images/fonts/media), replace `waitForTimeout` with `waitForSelector`.
- **Risk-based scheduling** — score accounts by nearest deadline + recent failures + unread messages; high-risk every 15min, quiet every 2-4h.
- **Delta scanning** — skip parsing when section response hash unchanged (scan_runs.content_hash).
- **Arabic PDF text repair** — NFKC normalization + RTL reordering before OCR; only scanned pages → OCR.
- **OCR benchmark** — Tesseract 5 ara vs Gemma vision on 30 real pages; pick lower CER.

### P3 — AI/ML
- **Swap Flask → llama-server** native binary behind port 7799 (prompt cache, JSON schema constrained output).
- **LLM router** — local-first, circuit breaker, never crashes; sensitivity-based routing (`client` = local only).
- **Rules engine** — extract deadline/penalty logic from monitor.js into `assistant/rules/` with tests; LLM only summarizes.
- **Constrained JSON extraction** — zod validation, golden eval set (50 docs), CI gate.
- **FTS5 search** with Arabic normalization; sqlite-vec only if keyword search too weak.
- **Conversation memory** — `assistant_conversations` table, 10-message window, RAG via FTS5 top-k.
- **LLM response cache** — `llm_cache` table keyed by `sha256(model|prompt|schema)`.

### P4 — Developer Experience
- **JSDoc + `// @ts-check`** on touched files; `tsc --noEmit` in CI.
- **ESLint flat config** + Prettier + eslint-plugin-security.
- **Integration tests** — in-memory SQLite, fixture scans, fake transports.
- **Contract tests** — saved ETA HTML/JSON fixtures → parsers → zod schemas.
- **CI** — GitHub Actions (lint + test on Linux, Windows smoke on tags).
- **Dependabot** — weekly grouped PRs.

### P5 — Scalability (only if needed)
- **Junction-based releases** — `C:\sapauto\current` → `releases\vX.Y.Z`, rollback via junction switch.
- **Retention** — archive events/channel_deliveries >180d to monthly archive DB; never auto-delete documents/obligations/payments.
- **scan_runs metrics** — feed risk scheduler and monitoring.

---

## 8. Constraints for any proposal

1. **Windows-only.** No Linux-only tools. PM2, Task Scheduler, NSSM, Caddy (single binary) are OK.
2. **Offline-first.** No mandatory cloud. Mistral is opt-in with explicit consent.
3. **Arabic/RTL.** All UI text, PDF text, search must handle Arabic presentation forms, RTL reordering, Arabic-Indic digits.
4. **Read-only portal.** Never submit/pay/accept/edit portal records.
5. **No client data to free cloud.** Local model for taxpayer data; cloud only for redacted/aggregate or with paid tier + training opt-out.
6. **Budget ~$500/month max** for cloud (optional).
7. **SQLite is enough.** No PostgreSQL/Redis/K8s unless multi-host needed.
8. **No LangChain/LlamaIndex.** Versioned prompt templates in `prompts/*.md`.
9. **No vector DB service.** FTS5 first, sqlite-vec second.
10. **No sharding.** One DB file per tenant if ever needed, not per company.
11. **No Q3 quantization.** Arabic quality loss too high.
12. **Expand-only migrations.** Add columns/tables; never drop/rename in same release.
13. **Code proposals exclude** .env, tests, data, models, deps, build dirs.

---

## 9. File/line anchors for common tasks

| Task | File |
|---|---|
| DB connection policy | `db/connect.js` |
| Migration runner | `db/migrate.js` |
| Outbox (enqueue/claim/drain) | `channels/outbox.js` |
| Event dispatcher | `channels/events.js` (startEventDispatcher, deliverEvent, flushWakeBacklog) |
| WhatsApp sender | `channels/wa-sender.js` |
| Mail/Telegram sender | `channels/mailtg-sender.js` |
| Channels host | `channels/index.js` |
| Harness loop | `harness/loop.js` |
| Account source | `harness/source.js`, `harness/accounts.js` |
| AI model routing | `assistant/model.js` |
| Assistant monitoring | `assistant/monitor.js` |
| AI capabilities | `assistant/capabilities.js` |
| Code proposals | `assistant/code-proposals.js` |
| Auth (better-auth) | `launcher/lib/auth.js` |
| Guard (roles) | `launcher/lib/guard.js` |
| Open access | `launcher/lib/open-access.js` |
| Settings API | `launcher/app/api/settings/route.js` |
| Accounts API | `launcher/app/api/accounts/route.js` |
| Health endpoint | `launcher/app/api/health/route.js` |
| DB (launcher) | `launcher/lib/db.js` |
| Logging | `lib/logger.js` |
| Leases | `lib/lease.js` |
| Shutdown | `lib/shutdown.js` |
| Heartbeat | `lib/heartbeat.js` |
| Ecosystem (PM2) | `ecosystem.config.cjs` |
| Plan (full) | `PLAN.md` (Opus5.5) |
| v8 original analysis | `v8.md` |
| Current session state | `CURRENT_SESSION_STATE.md` |

---

## 10. How to propose an upgrade

When proposing a change, include:

1. **Problem** — what's broken/slow/insecure, with file:line reference.
2. **Proposed fix** — minimal code change, diff-style.
3. **Affected files** — list.
4. **Migration needed** — SQL or none.
5. **Test plan** — which tests to add/modify.
6. **Risk** — what could break, rollback strategy.
7. **Dependencies** — new npm packages or none.
8. **Effort** — hours/days estimate.
9. **Priority** — P0/P1/P2/P3/P4/P5 per §7.

Do NOT propose: PostgreSQL, Redis, K8s, Docker, LangChain, LlamaIndex, vector DB services, Q3 quantization, sharding, OAuth (unless user asks), event sourcing, Prometheus+Grafana+Loki+Jaeger (deferred), or any change that sends client data to free cloud tiers.

---

## 11. Quick stats

- **JS files (excl. node_modules/.next):** ~125 in core dirs
- **Tests:** 40 test files, ~207 tests, 202 pass / 0 fail / 5 skip
- **Migrations:** 33
- **PM2 apps:** 8
- **DB tables:** ~40
- **Companies:** 26, Obligations: 800+, Tasks: 196, Payments: ~140, Messages: ~300, Events: 1717, PDFs: 187
- **Node:** 24.13.1 (>=24 required)
- **Next.js:** 16.4.0
- **React:** 19.2.0
- **better-sqlite3:** 12.11.1
- **whatsapp-web.js:** 1.34.7 (latest available)
- **Playwright:** 1.63.0
- **pino:** 10.4.0
- **better-auth:** 1.7.7
