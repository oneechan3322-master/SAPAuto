# SAPAuto V8 — Standalone Mission Control

V8 is being developed as a complete, independent SAP/ETA operations assistant,
not as a companion to or replacement wrapper for SAPAuto3, V4, or V5. V8 owns
its launcher, database, settings, assistant, and background services.

**Standalone migration status:** this working build still delegates portal
scanning and account discovery to SAPAuto3, and its default local model path
can point outside `v8/`. It is not yet independent at runtime. The standalone
release is not complete until V8 has its own account setup and protected
credential storage, read-only scanner, browser dependencies, and V8-managed
model installation. The migration plan is in
[`../.zcode/plans/v8-product-redesign.md`](../.zcode/plans/v8-product-redesign.md).
V8 installation does not copy legacy credentials or change legacy source
trees; existing V8 database records are preserved.

## Local setup

1. Install Node.js 24 or later.
2. Run `INSTALL.bat` on the office PC. It installs dependencies, builds the
   launcher, installs Chromium for SAPAuto3, migrates the V8 database, starts
   the six PM2 processes, and saves them for the current Windows account.
   For manual installation, copy `.env.example` to `.env`, configure
   `V8_BASE_DIR`, run `npm ci` in `v8/` and `v8/launcher/`, then run
   `npm run db:migrate`.
   The default V8 model reuses the already-downloaded Gemma 4 E2B GGUF at
   `../pet/models/gemma-4-E2B-it-Q4_0.gguf` through V8's isolated local service. The
   pinned `llama-cpp-python` runtime is resolved by `uv` on first launch; model
   weights are not downloaded or duplicated by V8.
3. Do not add portal credentials or start scans during setup. V8 does not
   create users or add companies. Existing local records are preserved. Never
   copy the legacy `.env` into V8 or commit either file.
4. Open `http://localhost:3000` on this PC. The launcher is a local control
   center; automatic scans and external message delivery remain disabled until
   explicitly enabled. Portal access stays read-only.

The launcher is a separate Next.js project in `launcher/`. It uses the same
SQLite file through the V8 database module; never put the database on a network
share. The launcher binds to loopback and is only available on this PC. The
installer removes the previous inbound firewall rule for TCP 3000 and adds the
current user's Startup entry to restore saved PM2 processes at logon.
The installer does not alter credentials, download any AI model, or enable scans.
`START.bat`, `STOP.bat`, and `STATUS.bat` control the PM2 services.

## Assistant manager and MCP

The assistant manager runs as a supervised PM2 process, checking deadlines,
unresolved scan failures, and stale harness heartbeat every 30 seconds by
default. It records deduplicated attention items. The local Settings control
center can enable or pause its monitoring and change its cadence. Settings,
audit events, and explicitly requested read-only scans can be written locally;
the launcher does not create users or execute portal write actions.
Outbound channel delivery defaults to local dry-run: messages are recorded
locally and are not passed to Telegram, WhatsApp, or email providers. Real
delivery can only be enabled in Settings after a warning and confirmation,
and requires both a configured provider and a verified linked recipient.
Environment variables alone cannot turn on live delivery.
Gmail and Telegram credentials can be connected from Settings; V8 verifies
them before storing them with Windows user-scoped DPAPI protection. The
channels worker refreshes protected credentials without exposing them in the
dashboard. WhatsApp uses the local QR-pairing flow when its optional client
dependency is installed. Connecting a provider does not enable live delivery.

The separate MCP Streamable HTTP server is bound to
`127.0.0.1:3101` by default and is bearer-token protected. Set a unique
`V8_MCP_BEARER_TOKEN` and an active `V8_MCP_USER_ID` before enabling MCP
clients; MCP remains unavailable until then. Do not expose the MCP port to the
LAN or internet without a separately reviewed secure proxy.
Assistant inference defaults to the existing Gemma 4 E2B GGUF on loopback.
V8 runs its own restricted llama.cpp endpoint against the already-downloaded
model at `../pet/models/gemma-4-E2B-it-Q4_0.gguf`; no old Nova supervisor,
memory, portal bridge, or cloud fallback is started. The model is Apache-2.0
licensed per its GGUF model card, and V8 references the file rather than
storing another multi-gigabyte copy. V8 uses the compatible pinned
`llama-cpp-python==0.3.36` runtime; it does not reuse the old V4 wheel
`0.3.19`, which cannot load Gemma 4. `uv` downloads the runtime package on
first startup if it is not cached locally. V8 passes its fixed tool registry
to llama.cpp and accepts only registered function calls.
Gemma 4 is the local default. Mistral can be selected in Settings only when
`MISTRAL_API_KEY` is configured, after an explicit cloud-data warning and
confirmation. In that mode, user prompts and selected SAPAuto context are
sent to Mistral. There is no automatic fallback between providers. Local
inference remains selected by default. Installing local model weights may
require a one-time download.
OpenCode CLI is not an assistant or payroll inference provider. An Owner may
optionally enable code-upgrade proposals in Settings after configuring
`OPENCODE_BIN`, `V8_OPENCODE_MODEL`, and signing in to the OpenCode CLI (or
setting `V8_OPENCODE_AUTH_FILE`). Set `V8_OPENCODE_MODEL` to the provider/model
identifier configured in OpenCode. A proposal contains only the owner's
code-upgrade request and a bounded snapshot of V8 source files; `.env`, tests,
data, model, dependency, and build directories are excluded. OpenCode is
started in an isolated temporary directory with file and shell tools denied,
telemetry disabled, and a sanitized process environment. Never include account,
payroll, document, payment, or credential data in a code-upgrade request.
The configured OpenCode model provider receives the request and source
snapshot; OpenCode may also contact its service endpoints. Proposals are
stored for Owner review; approval does not automatically edit files or apply
a patch. Use Gemma 4 for local assistant inference; use Mistral only with the
explicit cloud-consent settings above.

The Settings screen can request a supervised read-only scan of the configured
SAPAuto3 account source; it shows the account count and requires final scope
confirmation, and opening Settings does not start a scan. Scheduled scanning
is off by default and must be deliberately enabled there. Assistant-mediated
write and report actions remain unavailable in the userless launcher.

Portal access is read-only after authentication: the scanner may navigate
between accounts, pages, and read-only filters, and may read documents,
obligations, forms, and payment status. It must never submit payroll or tax
forms, initiate or confirm a payment, accept portal terms, or edit portal
records. The payment scraper deliberately excludes the portal's action column.
Scanning therefore observes and reports payroll/payment state only; any actual
filing or payment must be completed manually by an authorized person in the
portal.

## Local access

The launcher binds to `127.0.0.1:3000` and is available only on this PC.
Do not change it to a LAN-facing address while the dashboard is in read-only,
unauthenticated mode. The status API rejects non-loopback Host headers. The
PWA does not cache dashboard pages or API data.

## Source integration

The checked-in source has no `v3/` directory. The plan's "V3" engine is the
legacy SAPAuto3 project at `../SAPAuto3`. V8 keeps this configurable and does
not copy `.env`, `accounts.txt`, or taxpayer records. A live portal cycle is not
part of automated tests. The 72-hour soak, reboot-on-site check, real office-LAN
and device test, live authorized portal scan, and Telegram/Gmail/WhatsApp
delivery tests still need to be performed at the office. WhatsApp is optional
and requires the operator to add its package separately; it is not installed
by default.
