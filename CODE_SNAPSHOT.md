# CODE_SNAPSHOT.md — SAPAuto v8.1 pre-upgrade baseline

Written: Fri 2026-10-30, ~15:00 Cairo, by session on laptop DESKTOP-A4LVONV.
Purpose: freeze the state of the whole codebase before major upgrades (planv8.3 / TRUTH_ENGINE_PLAN_V9 / USER_PROMPT_PLAN).
Rule of this doc: no fabrication. Anything not verified this session is marked GAP/PENDING.

## 1. Machines and topology

| Machine | Role | Paths |
|---|---|---|
| Laptop `DESKTOP-A4LVONV` (laptop-16gb profile) | dev + live services | `C:\Users\Mega Store\Downloads\SapAuto\v8.1` |
| Server PC (server-32gb profile) | production host, Owner-operated via RDP | `E:\Drive\Scan\v8.1` |
| SMB share | sync + parity bridge | laptop `X:\Scan\v8.1` = server `E:\Drive\Scan\v8.1` |

- Radmin VPN target: `26.179.214.71`; dashboard port 3000 external — currently unreachable from outside (suspected server firewall; recommended fix for Owner: `netsh advfirewall firewall add rule name="SAPAuto 3000" dir=in action=allow protocol=TCP localport=3000 profile=any`). ICMP blocked; SMB 445 works.
- Node >= 22; package `sapauto-v8` v8.1.0 (reconstructed 2026-10-24). Native modules (better-sqlite3) must be rebuilt per host — never copy `node_modules` laptop→server.

## 2. Git state (laptop repo, v8.1)

HEAD chain (newest first):
- `f91249b` WhatsApp scan fix: wa-sender watchdog + lease exit(1), whatsapp.js page-closed probes, harness per-account scan notifications (P1+P2 card), tests
- `a7f2150` CURRENT_SESSION_STATE.md handoff
- `ec82dee` company folders card · `82a749c` company folders card files
- `7220d54` Model Center card · `b04be43` Model Center card files
- `1eabf79` AGENTS.md · `b7155be` LAN dashboard card files
- `fcd9b93` A10 card · `d7c0f71` A10 card files
- `5a80d4a` L5 card · `c0cf5f9` L5 log hygiene card files
- `1625d11` L0.2+C.3 card · `f0d36d6` C.3 review wiring + migration 035

Dirty at snapshot time (uncommitted, by me):
- `lib/model-center.js` — machine-gate re-applied to `rebootPc`/`abortReboot` today (see §9 incident), gate refusal message uses `\uXXXX` escapes, `spawnFn = run` shadow bug fixed in both functions.

Recovery note (same day): an agent-rollback left `master` at `a7f2150` while the WhatsApp card commit `f91249b` was orphaned (no reset entry in reflog — concurrent-agent footprint). Card files survived in the working tree and on the server share (hash-parity). Recovered as branch `whatsapp-scan-fix` → `f91249b`, then pushed. Commit of the same day includes P0.1 inventory (`scripts/phase0-crash-inventory.cjs`, `docs/crash-inventory-2026-10-30-{server,laptop}.md`), `CODE_SNAPSHOT.md`, and the gated `lib/model-center.js`; origin/master = `17321e9` initial import, updated on push 2026-10-30.
- Test verification of that fix is PENDING (Owner ordered "stop running anything"; do not run tests without asking).

Known other-agent churn (do not stage, never commit): `launcher/*.css`, `launcher/components/*.jsx`, UI theme files; unstaged rewrites of files I also touched.

## 3. Process topology (PM2, ecosystem.config.cjs)

All 8 services, one config file, repo-local logs `logs/pm2/<name>.out.log` / `.error.log` (L5 card):

| Service | Role |
|---|---|
| `sapauto-v8-launcher` | Next.js dashboard+API, port 3000 |
| `sapauto-v8-harness` | scan loop (`harness/loop.js`) |
| `sapauto-v8-channels` | channel orchestration |
| `sapauto-v8-wa-sender` | WhatsApp sender/web client (Playwright-lane wwebjs) |
| `sapauto-v8-mailtg-sender` | mail + Telegram delivery |
| `sapauto-v8-assistant` | assistant service |
| `sapauto-v8-local-model` | local model server (llama.cpp launch) |
| `sapauto-v8-mcp` | MCP integration |

Common policy: watch false, `shutdown_with_message` + `lib/shutdown.js` graceful exit, kill_timeout 30000, max_restarts 20, restart_delay 5000 (exp_backoff 100), max_memory_restart 600M.

Owner rules in force: PM2 auto-start on server kept manual (after reboot → `pm2 start ecosystem.config.cjs` in `E:\Drive\Scan\v8.1`); I never restart services as a side effect; failsafe for a wedged state = ONE machine reboot by Owner press only.

## 4. Launcher (dashboard)

Pages (13): `model-center`; (protected) `dashboard`, `kamal/task`, `kamal/companies`, `assistant`, `[section]/[key]`, `[section]`, `archive`, `settings`, `payroll`, `board`; (auth) `setup`, `login`.
Auth: Owner role + same-origin guards on mutating API routes (`requireRole(request,'Owner')`, `requireSameOrigin`).
Model API routes accept: `stop-service`, `start-service`, `reboot-pc`, `abort-reboot`, `cancel-bench` (contract asserted by `test/plan-v82-models.test.js`).
Server-side mystery resolved this session: dashboard showed `modelHome E:\pet\models, present:false` while llama served fine — real roots are `V8_LOCAL_MODEL_HOME=../pet` → `E:\Drive\Scan\pet\models` on the server.

## 5. Data layer

- SQLite `data/sapauto.db` (+ `data/accounts.key*` secrets — never in git, never at rest in logs).
- Migrations `db/migrations/` 001…038 (`001_core.sql`, …, 035 review wiring, …, `038_document_registry.sql`), append-only, `node db/migrate.js`, verified identical on both hosts this session.
- Notable settings keys (outbox/settings table): `bench_state` (heartbeats, stale after `BENCH_MAX_MS` = 15 min), `bench_cancel` (`BENCH_STEP_MS` = 4 min), `model_runtime` (45 s freshness), `assistant_down_whisper` (10-min window `DOWN_WHISPER_WINDOW_MS`), `whatsapp_control_number`, `wa_web_version`, `local_model_file`, `outbox_mode`, progress/cancel keys for model download.
- Tables exercised on both hosts: `notification_outbox` (per-account scan notes), `events` (kinds incl. `new_doc`, `scan_account_completed`), audit/query tables under `db/queries/commands.js`.

## 6. WhatsApp subsystem (production)

- Bot `+201205147906`; primary control line `+201126170117` (respects `whatsapp_control_number`).
- `channels/wa-sender.js`: lease-keeper and watchdog; lease rejection now `process.exit(1)`; `WATCHDOG_INTERVAL_MS` 20000 with `WATCHDOG_STRIKES_TO_REBUILD` 2; instant strike when `probe.reason === 'page-closed'`.
- `channels/whatsapp.js`: wwebjs client; pinned reduced Chromium tracks revision + Webpack workaround for WA version drift; handlers `pupBrowser.on('disconnected')`, `pupPage.on('close')`, `pupPage.on('error')` reset `clientReady`/`readyAtMs` and publish `setChannelRuntimeState(db,'unhealthy')`; `probeTransport` gate `if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return {ok:false, reason:'page-closed'}`; assistant-down whisper throttled to one Arabic note per 10 min; fail-safe report block rebuilt with escaped Arabic.
- `channels/whatsapp-intents.js`: Owner-side intents incl. fail-safe report with root-cause bullets (econnrefused / fetch / timeout / memory / busy), downPhraseCount === 1 contract.
- Scan logic (`harness/loop.js`): `scanOne` returns `{ok, newDocs, error}`; `notifyScanAccount` enqueues Arabic per-account notes into `notification_outbox` (recipient `${digits}@c.us`) and writes an `events` row `kind='scan_account_completed'` with payload `{companyName, scanSuccess, newDocsCount, error}`; `runCycle(..., gapMs)` waits 10 s between accounts; inbound `فحص` command triggers the run.
- Arabic strings in source are all `\uXXXX`/`\u{...}` escapes (Edit/Write tooling mangles raw UTF-8 on this host — hard constraint, patch scripts in `%TEMP%\opencode\`).

## 7. Harness pipeline

`harness/loop.js` is the cycle engine; per-account flow = lock/lease (`lib/lease.js`, two-copy guard bound to `shutdown_with_message` semantics) → scraper reads ETA portal (read-only, hard rule) → ingestAccount (delta events) → per-account notification → mail/Telegram lane via `s-mailtg` channel. Ghost-company fallback and control-number suppression are covered in `test/plan-v82-scan-notifications.test.js`.

## 8. Model stack

- `assistant/local-model-server.js` — REWRITTEN BY ANOTHER AGENT since my Stage B work: now settings-first (`local_model_file`) + llama spawn with `--load-mode mlock` etc.; my `model_runtime` heartbeat contract is REMOVED → `test/plan-v82-models.test.js` currently FAILS there. Decision pending: restore contract vs drop the heartbeat half of the test.
- `lib/model-center.js`: catalog + validation, download (`scripts/download-model.js`), bench (`scripts/bench-models.js`; guards: `MIN_FREE_BYTES` 20 GB), applyModel with applyGuards (only Owner press restarts a service from the dashboard), stop/start/stopAll/restartAll helpers, plus the machine failsafe (`rebootPc`, `abortReboot`) — NOW GATED (§9).
- `lib/model-center.js` consumes `model_runtime` heartbeats for llm health rows in Tasks.
- Server model: llama-server loading `E:\Drive\Scan\pet\models\gemma-4-26B-A4B-it-Q4_0.gguf`, listening `127.0.0.1:7799` (verified live in launch logs).

## 9. Incident log — 2026-10-30 laptop restart (owned)

Timeline (UTC):
- 11:43:27 — Event 1074: `shutdown.exe` initiates restart, comment `SAPAuto: Owner-triggered restart`, reason Maintenance (Planned) 0x80040001. Origin: my full-suite test run; `test/plan-v82-models.test.js` reboot test called `rebootPc` while the file on disk had (a) my `V8_REBOOT_ALLOWED` gate REMOVED by a concurrent agent overwrite, (b) the runner shadow bug (`const { spawn }` re-declared, injected fake ignored) → REAL system shutdown scheduled with /t 90.
- 11:44:57 — grace expired; Windows signout screen shown (the photo Owner sent).
- 11:46:16 — Event 6005: laptop booted again. PM2 daemon respawned EMPTY — all 8 services DOWN since (not restored yet; Owner has not yet approved).
- 11:45:55 — `shutdown /a` returned 1116 (nothing pending; too late).

Remediation applied (file edits only, saved, NOT test-verified per Owner stop order):
- `rebootPc` refuses first when `process.env.V8_REBOOT_ALLOWED !== '1'` (gate before token check), refusal message contains `V8_REBOOT_ALLOWED=1`, Arabic as `\uXXXX` escapes.
- `spawnFn = run` honored in `rebootPc` and `abortReboot` (the test's must-not-spawn fake is now actually used).
- Pending: run `node --test test/plan-v82-models.test.js` under Owner approval; parity-sync the gated file to `X:\Scan\v8.1\lib\model-center.js` + hash check (server `.env` has NO `V8_REBOOT_ALLOWED` → gate closed there by env too).

Process lessons recorded:
1. Multi-agent dirty tree: before ANY test run, grep `V8_REBOOT_ALLOWED` in `lib/model-center.js` and confirm the test's fake-runner wiring — gates can be silently deleted by other agents.
2. Never launch the full suite without first verifying OS-effectful code paths (machine-level actions) are gated.
3. A failing heartbeat contract in `local-model-server.js` must NEVER be "fixed" by re-running via the real reboot path.

## 10. Test baseline (honest, as of snapshot)

- Run form: `node --test test/<file>.test.js` explicit file paths only (NOT `npx` — Node 26 shim breaks better-sqlite3; NOT directory form on Node 24). Full suite ≈ 11 min, 200+ tests.
- This session verified: `test/plan-v82-scan-notifications.test.js` (7, DB-backed) + neighbours + throttle contract = 18/18 pass.
- Known failing (pre-other-agent state and still):
  1. `test/plan-v82-models.test.js` — ≥2 failures: "the service must publish its runtime heartbeat" (+ neighbour) because `assistant/local-model-server.js` was rewritten by another agent without the `model_runtime` heartbeat.
  2. `test/whatsapp-intents.test.js` — `Aroba2024` vs `aroba2024` case drift (other agent's).
- Full-suite rerun interrupted today at the incident; NO complete fresh baseline since.

## 11. Environment switches (both hosts)

Server `.env` verified this session (keys only, values never committed): `V8_SESSION_SECRET` (64 chars), `V8_LOCAL_MODEL_HOME=../pet`, `PLAYWRIGHT_ARTIFACTS_PATH`, `TEMP`, `TMP`, `RESEND_API_KEYS`, `RESEND_API_KEY`, `RECIPIENT_EMAIL`, `SENDER_EMAIL`, `MISTRAL_API_KEYS`, `MISTRAL_API_KEY`, `MISTRAL_MODEL`.
Machine gate: `V8_REBOOT_ALLOWED` — absent on both hosts by default (reboot failsafe refuses). The UNIQUE purpose of that key: enable machine reboot on the designated host, set manually by Owner with token `RESTART-SERVER-PC`, `REBOOT_DELAY_SECONDS` 90.

## 12. Ops runbook (Owner)

- Restore services after a reboot: `cd E:\Drive\Scan\v8.1; pm2 start ecosystem.config.cjs` (laptop equivalent in its repo dir).
- Restart a service with env/args change: `pm2 delete <name>` then `pm2 start ecosystem.config.cjs --only <name>`; plain `pm2 restart` re-reads `.env` on fresh spawn.
- WhatsApp auth lives in `channels/.wwebjs_auth/` — survive reboots; pairing persists.
- Do not disconnect the RDP session; services rely on the interactive session for the browser lane.
- Today's target commands (pending Owner action): laptop services restore (approval queried), server `shutdown /a` if banner ever seen on server too (event log showed it on laptop only; server copy of `rebootPc` had no gate earlier today — closing via parity sync of the now-gated file).

## 13. Known gaps / pre-upgrade checklist

1. `assistant/local-model-server.js` heartbeat contract: restore or amend test (decide before planv8.3 confetti touches this area).
2. `whatsapp-intents` case drift (`Aroba2024`) — server/laptop parity question once WhatsApp list is back sweet.
3. Parity sync of gated `lib/model-center.js` to server share + hash — pending.
4. Full-suite fresh baseline — pending (needs Owner go).
5. Port 3000 firewall rule on server — pending Owner action.
6. Scratch/experimental files (e.g., `check-*.cjs`, `test-*.js`, `docs-*.cjs`) untracked at root — sweep before the upgrade branch.
7. Unread plan docs (flags for upgrade session): `docs/TRUTH_ENGINE_PLAN_V9.md`, `planv8.3.md`, `docs/USER_PROMPT_PLAN.md`.

## 14. Pointers for the upgrade session

- Machine profiles live in `opus5.5-v8.2-plan.md` §0; card tracker `tasks-v82.md` (statuses row-by-row); column usage audit in `docs/coverage-report.md`.
- Server-side heavyweight work (bench of the 26B, per-machine model roles) must run ON the server host with its real numbers.
- Source of truth for live state handoff: `CURRENT_SESSION_STATE.md` (server-side agents keep it too; cross-check WA sections there for the training hotline numbers).
