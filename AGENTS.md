# SAPAuto v8.1 — agent rules (any session, any machine)

This tree runs live services via PM2 (`sapauto-v8-*`) and holds real data.
Read this before doing anything. The Owner rules that were decided:

## Hard rules
- **Never commit secrets or data**: `.env`, `data/accounts.key*`, `data/sapauto.db*`, `channels/.wwebjs_auth/`, `logs/` are not version control material. They are config, not code.
- **No fabrication**: never invent portal data, scans, dates or benchmark numbers. "Truth over polish" — an honest empty beats a pretty fake.
- **The scraper only reads** the ETA portal: it may never press, submit, or change anything there.
- **No machine changes without asking the Owner first**: no scheduled tasks, no firewall rules, no power-plan changes, no services started "to test". State what you want to run; let the Owner approve.
- **Free tools only**: never sign up for paid services on the Owner's behalf. If a task needs credentials that don't exist in the vault, stop and tell the Owner.

## Workflow discipline
- Tests: plain `node --test test/<file>.test.js` with explicit file paths. **Not** `npx node` (pulls a Node 26 shim → better-sqlite3 `ERR_DLOPEN_FAILED`), **not** directory form on Node 24. Run only the card's targeted tests, plus the direct neighbours when their surface changed.
- The full suite takes ~11 min (200+ tests) — targeted first, full run optional at card end.
- A second agent (ZCode) works in this tree too. Before every commit: `git status`, see whose files changed; commit only your own files; never stage its churn (`launcher/*.css`, `launcher/components/*.jsx`, UI theme files).
- Never restart PM2 services as a side effect of file edits. Services pick up changes on their next cycle. If a restart is genuinely required, say so, why, and what it interrupts.
- `powershell` (5.1) quirks: no `grep`/`sed` (use `Select-String`), no `||` chaining, assignments need `$`, `node -e` with template literals/backticks breaks — write a small temp `.cjs` instead. Await closing the DB before temp scripts exit (background analysts may warn otherwise).
- Migrations are append-only (`db/migrations/0NN_*.sql`, auto-discovered, next number = latest+1). Live DB is migrated with `node db/migrate.js` only when a card's migration lands.
- Don't chase the same probe twice: if a command returned its answer, move on.

## Where the work plan lives
- `opus5.5-v8.2-plan.md` — the v8.2 plan (tracks A/B/C/L/S, §0 machine profiles: this laptop is laptop-16gb; the server-32gb profile is for the Xeon machine).
- `tasks-v82.md` + table statuses — pick a card, expand only its files, update the row when done.
- `docs/coverage-report.md` — which table columns are actually used (dead-column hunting).
- Server-specific work (llama.cpp install, model bench, 26B model, per-machine model roles) is deliberately left for a session running on the server PC with its real numbers.

## Model/runtime facts
- Local model stack: `assistant/local-model-server.js` (+ the python `local-model-server.py` stack) with GGUFs in `../SapAuto/pet/models` (E2B 2.65 GB, E4B 4.8 GB). `llama-server.exe` is not installed yet — `scripts/bench-models.js` skips gracefully and its RAM guard refuses model loads that would swap the machine.
