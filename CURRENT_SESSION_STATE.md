# SAPAuto v8.1 — CURRENT STATE (live handoff)

**Status: live on this laptop (16 GB), ready to move to the server PC.** Written 23 October 2026. This file contains no secrets — no passwords, keys, cookies, or QR data. The old `SapAuto\v8` stays CLOSED and untouched; v8.1 below is the only active version.

## What v8.1 is now
- One folder, self-contained: `C:\Users\Mega Store\Downloads\SapAuto\v8.1` — includes its own `node_modules` (root + launcher) and the built dashboard (`.next`), so **no npm install / no terminal commands are needed on the target machine**.
- The Owner's rule is enforced everywhere: **after the folder is copied and `pm2 start ecosystem.config.cjs` is pressed once, everything is controlled from the dashboard only** — WhatsApp pairing, accounts, LLM upgrades, reviews. No scheduled tasks, no firewall rules, no auto-injections are created by the app itself.

## Dashboard
- Binds LAN: `0.0.0.0:3000` (any PC/phone on the same network + Radmin VPN can open it).
- Key pages: Channel Center (WhatsApp pair/unpair, control number, link codes, accounts CRUD), Model Center (`/model-center`: select/apply/download/bench), payments worklist with review states, archive, tax obligations.
- Role gate: Owner actions same-origin + audited; the launcher runs open-access (`V8_OPEN_ACCESS=1`) per Owner decision. The old v8's S1/S5 dashboard-auth follow-up is still pending — restrict Wi-Fi/network access accordingly.

## WhatsApp (channels)
- **Not paired yet in v8.1** — pair from Dashboard → Channel Center (QR or pairing code), takes under a minute, no restart.
- Control number is already set in settings: `+201126170117`. `message_mode=live`, wake notifications on. Staff numbers join via link codes (Owner generates a 6-digit code, the number texts `link <code>`). Incoming intents (scan request, PDF read) reply via the local model; unknown numbers stay silent.
- Shortcut (optional, from the old v8 handoff): copy `channels/.wwebjs_auth/` from the closed old `SapAuto\v8` tree into v8.1 **while PM2 is stopped** — the session can survive a machine change as long as the phone has not signed out the linked device; otherwise just pair fresh from the dashboard.

## Data & migrations
- SQLite `data/sapauto.db` at migration **036** (integrity ok). Live-scan data (not copied from the old v8): 26 companies, 800 obligations, 942 payments; tasks carry 36 real PDF paths (old-tree paths recorded during 19 Oct scans — the copies now live inside the company folders, see below).
- **Company folders mirror** (Owner request): `data/companies/<اسم الشركة>/` — one folder per company with `pdfs/` (real portal PDFs, DOC_<n>.pdf), `documents/` (empty for now), and a `company.json` manifest. Updated automatically after every successful scan; `node scripts/build-company-folders.js` re-runs it manually anywhere. Nothing is ever deleted by that sync.
- Never commit or lose when copying: `data/`, `channels/.wwebjs_auth/`, `.env`, `data/accounts.key*`.

## Local model + Model Center
- Current selection: `gemma-4-E2B-it-Q4_0.gguf` (settings-first, key `local_model_file`); E4B present; the 26B-A4B slot is reserved for the server PC.
- `/model-center` (Owner): select + apply (audited pm2 restart of `sapauto-v8-local-model`, press-only), background https GGUF downloader (progress bar, cancel, ≥1 GB size gate, no overwrite), bench trigger + results table (`model_benchmarks`).
- `llama-server.exe` is not installed yet — bench shows an honest skip. Installing llama.cpp + downloading the 26B model (~15 GB) are the server-PC session tasks (`scripts/bench-models.js` guides with RAM-guard output).

## Services & ops facts (learned, keep using)
- **8/8 PM2 services online** (ecosystem.config.cjs): harness, channels, wa-sender, mailtg-sender, assistant, local-model, mcp, launcher. Repo-local logs: `logs/pm2/<svc>.{out,error}.log`; files only when `V8_LOG_FILE=1` (stdout is the default — no more 0-byte surprise files).
- PM2 trap: changed `out_file`/`args` in the config require `pm2 delete <app>` + `pm2 start ecosystem.config.cjs --only <app}` (startOrReload/restart do NOT apply them), then `pm2 save`. WhatsApp graceful stop takes ~30 s per app (kill_timeout 30000) — delete is just slow, not stuck.
- Health gate any time: `node scripts/server-health-check.js` — last result **CLEAN** (sqlite ok, migrations 036, 26 companies, 800 obligations, 8/8 online, launcher on 0.0.0.0, `/api/setup` 200, 3.1 GB RAM free; INFO rows show one-time WhatsApp status).

## v8.2 card ledger (done → next)
- ✅ L0.1/S1(start-up), B0/B1, **L0.2** bench harness (RAM guard, Arabic hints), **C.3** absence review states (2-strike `needs_review`, confirm = `confirmed_resolved), **L5** log hygiene, **A10** stale-event archive (TTL 3 days, suggestive exemptions kept live), **MC** Model Center, **CF** company folders.
- ⏭ On the server PC: **L1** llama.cpp install, 26B-A4B download+bench (via Model Center), then remaining plan cards in `tasks-v82.md` (e.g. C5 rules engine).
- Full history: `opus5.5-v8.2-plan.md`, `tasks-v82.md`, `docs/coverage-report.md`; agent discipline in root `AGENTS.md`.

## Moving to the server PC (summary — full text in README-SERVER.md)
1. Stop PM2 (`pm2 stop all`), close WhatsApp cleanly, copy the whole folder.
2. On the server: start PM2 in the folder, allow the Windows firewall prompt for port 3000 if it appears, open the dashboard from any LAN device.
3. Pair WhatsApp from the Channel Center (or copy the old session while stopped, see above).
4. Run `node scripts/build-company-folders.js` once if the DB moved (rebuilds nothing destructive, only copies), run `node scripts/server-health-check.js` → expect CLEAN.
5. From then on: dashboard only.
