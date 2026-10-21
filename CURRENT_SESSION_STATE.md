# SAPAuto V8.1 — Current Session State

Last updated: 20 October 2026, ~05:05 Africa/Cairo

This is the living handoff document. No passwords, API keys, cookies, or QR data live here.

## Current status at a glance

| Item | State |
|---|---|
| Active project | `C:\Users\Mega Store\Downloads\SapAuto\v8.1` — created 2026-10-20, awaiting first work session |
| V8 (`..\v8`) | **CLOSED** — commit `ccbb5b4` "Close V8: production-verified final state"; fully locked down (see Lockdown audit below) |
| All versions (v4–v9) | No version can auto-start anything: PM2 daemon dead + empty dump, Startup hooks disabled, no tasks/services/registry hooks anywhere |
| PM2 services | **0 running** (was 6 in v8). Nothing is delivering WhatsApp/email/monitoring right now |
| Dashboard (port 3000) | **Offline** by design until v8.1 goes live with auth |
| WhatsApp | Session preserved on disk in `..\v8\channels\.wwebjs_auth\` (no re-pair needed later); connected state will expire live delivery until v8.1 brings the channel up |
| v8.1 dependencies | `npm ci` done: root (375 pkgs) + launcher (282 pkgs), Node 24.13.1 |
| v8.1 tests | 6/6 pass (db migrations 001–026 apply fresh; channel-unlinked-silence) |
| Upgrade plan | `PLAN.md` (= `Opus5.5.txt`, 744 lines) — the full V8→V8.1 engineering plan |

## What was done in the seeding session (2026-10-20)

1. v8 committed final state (`ccbb5b4`, 236 files) after redacting leaked Mistral/Resend keys from `MISTRAL-ERROR-FIX.md`, `scratch/test_mistral_ocr.js`, and the session-state doc.
2. `.gitignore` hardened: WhatsApp session dirs + backups, `__pycache__`, client data (payroll CSV/JSON, atomic contracts, diag screenshots) never enter git.
3. All 6 PM2 services stopped → deleted from list → daemon killed. Startup auto-resurrect bat disabled (renamed `SAPAutoV8.bat.CLOSED-2026-10-20.disabled`).
4. **Lockdown audit** (details in `..\v8\CURRENT_SESSION_STATE.md`): killed a live stray `cmd.exe` running v8's `start-server.bat`, renamed `~/.pm2/dump.pm2`(bak) so `pm2 resurrect` restores nothing, verified clean: startup folders, Run/RunOnce keys (HKCU/HKLM/Wow6432), Winlogon defaults, all scheduled tasks by action path, Windows services, port listeners (3000/7799 off), stray node/python/chrome processes.
5. v8.1 created via robocopy from v8 @ `ccbb5b4` (1354 files / 155 MB, `.git` included for lineage). Excluded: `node_modules/`, `data/` (production DB + PDFs), `channels/.wwebjs_auth/`(+backups), `launcher/.next/`, caches.
6. Seeded `PLAN.md` + this file. `npm ci` root & launcher. Migration smoke test passed.

## Re-enabling v8 (only if ever needed again — NOT recommended)

1. Delete `data/` inquiries: start from v8 folder.
2. Rename Startup bat back: `SAPAutoV8.bat.CLOSED-2026-10-20.disabled` → `SAPAutoV8.bat`.
3. Restore dumper if wanted: `~/.pm2/dump.pm2.CLOSED-2026-10-20.bak` → `dump.pm2`, or just run `pm2 start ecosystem.config.cjs` (via `START.bat`).
4. WhatsApp re-pair NOT needed (session intact on disk) unless the phone signed out the linked device.

---

## TASKS — v8.1 plan (start whenever you have free time)

> Recommended rhythm: Phase 0 = 1 focused session (~1–2 h, do it before going live again). Phases 1–5 are week-scale slices; each phase's first task can ship alone.

### Phase 0 — Emergency fixes (FIRST session, ~1–2 h, do NOT skip)
- [ ] **Revoke + rotate the 2 Mistral keys** (they sat in plaintext docs/logs; leaked full keys were redacted in commit `ccbb5b4`). Enter new keys only in `.env` / DPAPI never in docs.
- [ ] **Revoke + rotate the Resend key** (`re_…` leaked in the old session-state doc; redacted now).
- [ ] **Restrict the `SapAuto V8 Launcher (TCP 3000)` firewall rule** to known Radmin peer IPs — or bind launcher to `127.0.0.1` — until dashboard auth ships (plan S1, CVSS 8.8).
- [ ] **Backup v8's production DB** (`..\v8\data\sapauto.db`) with `integrity_check` and copy to a second disk. This backup is the migration source for v8.1 data later (plan C4, §6.9).
- [ ] **Review WhatsApp linked devices from the phone**; "log out all devices" if anything unfamiliar (plan S3, QR was shown on a call).
- [ ] **Lock file ACLs**: `icacls` on `..\v8\channels\.wwebjs_auth\` and `..\SAPAuto3\accounts.txt` so only your user can read them (plan S2/S3).
- [ ] **Diagnose the ~20/week restarts**: `pm2 describe sapauto-v8-launcher`… (from the backup dump if needed) — check `watch: true` in `ecosystem.config.cjs`, `next dev` vs `build+start`, and memory growth (plan §6.7 note).

### Phase 1 — Stability (weeks 1–2, plan §6)
- [ ] Shared `db/connection.js` with pragmas (WAL, busy_timeout 5000, FK ON **after** `PRAGMA foreign_key_check` passes) — switch all services to it (§6.1).
- [ ] Migration runner + `schema_migrations` checksum ledger; `--baseline` backfill for migrations 001–026; every service refuses to start on unknown schema state (§6.8).
- [ ] Nightly backup job (`scripts/backup.js`, Task Scheduler 02:30) with integrity check + monthly restore drill; copy `data/` + `.wwebjs_auth/` + DPAPI blobs offline (§6.9).
- [ ] pino + pino-roll structured logging with `redact` list; scrub old PM2 logs; migrate all `console.*` (§6.4).
- [ ] Graceful shutdown (`lib/shutdown.js`) with `shutdown_with_message` + single-instance SQLite lease to defeat PM2 #6142 double-spawn (§6.7).
- [ ] **Transactional outbox** `notification_outbox` (migration 027) with claim/lease/idempotency/backoff/dead-letter; run in shadow mode 3 days, compare counts, then cut over (§5.5, §6.2).
- [ ] **Isolated WhatsApp sender** — own PM2 app `sapauto-v8-wa` draining outbox rows only; unhandledRejection guard for Puppeteer teardown; exponential reconnect (§6.3). Email/Telegram must survive a WhatsApp crash (plan C2).
- [ ] `/health` endpoint reporting service heartbeats + outbox backlog; point Uptime Kuma (2nd LAN machine) or a healthchecks.io dead-man switch at it; alerts alternate channel ≠ WhatsApp (§6.12, plan C1).
- [ ] Task Scheduler boot task `pm2 resurrect` + BIOS "Restore on AC = On" + UPS (§13 Phase 0).

### Phase 2 — Security (weeks 3–4, plan §5.6, §6.6)
- [ ] Import 26 ETA credentials into DPAPI secure store; delete/rotate any that were exposed; cut the `SAPAuto3/accounts.txt` dependency (plan S2).
- [ ] Dashboard local auth: users table (argon2id), roles owner/operator/viewer, iron-session cookie, Next middleware guard, TOTP 2FA for owner actions, login rate-limit 5/15min, audit log table (§6.6).
- [ ] Caddy TLS for LAN/VPN with internal CA (bind Next to 127.0.0.1; firewall 443 → specific Radmin peer IPs).
- [ ] MCP: least-privilege tools (read-only default), bearer token in DPAPI, two-version rotation acceptance (plan S4, Q14).
- [ ] BitLocker on the data drive; rotate any still-live keys; PDPL compliance review with counsel (Decree 816/2025).

### Phase 3 — Scale & performance (weeks 5–7, plan §4, §6.5, §6.10)
- [ ] `scan_runs` metrics table (migration 030) + per-section content-hash checks feeding risk scheduler (§5.5).
- [ ] Harness pool: `mapPool` + global TokenBucket ~1 req/s + jitter; concurrency 1 → 2 → 3 with a week of metrics in between; automatic `slowDown` on 429/5xx (§6.5).
- [ ] ETA session reuse per account (Playwright storageState encrypted via DPAPI) — biggest per-scan win (§4).
- [ ] Block image/font/media requests; replace every `waitForTimeout` with selector/response waits (§4, grep audit §9.2).
- [ ] Risk-based scheduling: high-risk accounts ≤ 15 min, quiet ones 2–4 h; response-hash skip; delta scans (§4).
- [ ] Obligation state machine: `absent_scan_streak` + `review_state` (migration 028); manual review queue on dashboard; daily escalation with penalty estimate for past-60-day-band tasks (plan C5, migration 028).
- [ ] Hot indexes (migration 029); N+1 cleanup on dashboard aggregates; events/deliveries 180-day archive via ATTACH (§5.5).
- [ ] User channel management UI + verification codes; Telegram as the scalable free channel (§11 Q11).

### Phase 4 — AI (weeks 8–10, plan §6.11, §6.10, §7)
- [ ] Swap Flask llama-cpp-python wrapper for `llama-server` behind the same 127.0.0.1:7799 (§5.2); prompt cache on.
- [ ] LLM router: local-first with circuit breakers, `sensitivity='client'` → local only; deadline/penalty alerts NEVER depend on an LLM (rules engine) (§6.11).
- [ ] Extract rules engine from assistant into deterministic, tested code (`rules/`); LLM only summarises/classifies (§5.2).
- [ ] JSON-schema-constrained extraction + zod validation; golden eval set (50 real docs) wired to `npm run eval` (§7).
- [ ] Arabic PDF text repair pre-OCR: NFKC + harakat strip + line reordering with known-words scoring; store `ocr_text_raw` + folded `search_text`; OCR only `needsOcr` pages (§6.10).
- [ ] FTS5 index on `search_text`; sqlite-vec only if keyword search proves insufficient (§11 Q8); conversation memory table (§7).
- [ ] Drop multi-key cloud rotation; single key w/ training opt-out or none; provider policy enforcement (plan C-note).

### Phase 5 — Developer experience (weeks 11–12+, plan §8–10)
- [ ] `lib/config.js`: single zod-validated config (env → DB settings → defaults); kill magic timeouts (§9.3).
- [ ] ESLint flat + Prettier + `eslint-plugin-security`; `// @ts-check` + `tsc --noEmit` on touched files (§9.3).
- [ ] Test layers: unit (deadline/penalty/backoff/arabic), contract (ETA fixtures → zod), integration (:memory: SQLite → outbox, fake transports), migration checks (FK clean); ≥ 85% on domain code; fix or quarantine the 1 known-red test (§8).
- [ ] CI: GitHub Actions (lint+tests on Linux; Windows smoke on tags) + Dependabot weekly grouped PRs (§10).
- [ ] Junction-based releases (`C:\sapauto\releases\…` + `scripts/release.ps1` with /health poll & auto-rollback; expand-only migrations) (§10).
- [ ] Runbooks: WhatsApp re-pair, restore-from-backup, ETA portal change, secret rotation; refresh README + architecture diagram (§13).

## Definition of done for V8.1 (from PLAN.md)

Zero lost notifications for 30 days • ≤ 2 unplanned restarts/week • high-risk freshness ≤ 15 min • completed restore drill • no plaintext secrets on disk/logs • dashboard behind auth + TLS • no client data to free-tier cloud models.

## Bring v8.1 live (later, one-time checklist)

1. Phase 0 + Phase 1 items marked above must be done first (especially: auth or 127.0.0.1 binding before anything listens on the network again).
2. Stop v8 (already stopped), then copy `..\v8\data\` (DB + PDFs) and `..\v8\channels\.wwebjs_auth\` into v8.1 — then run migrations against the migrated DB (expand-only; verify via `PRAGMA foreign_key_check`).
3. `npm ci` (done), new `ecosystem.config.cjs` from plan §6.7, `pm2 start` + restore the Startup boot hook pointing at v8.1.
