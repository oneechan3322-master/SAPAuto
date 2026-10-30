# Crash & error inventory — server

- Generated at: 2026-10-30T10:28:44.741Z (Cairo 30/10/2026, 12:28:44)
- Logs root: X:\Scan\v8.1\logs\pm2
- PM2 capture: X:\Scan\v8.1\data\pm2-list.txt (captured 2026-10-25T17:14:46.910Z)
- Host RAM (running machine): 15.8 GB total / 5.98 GB free
- Read policy: PM2 logs + pm2 capture ONLY. Never read: .env, data/accounts.key*, channels/.wwebjs_auth*, DPAPI vault. Evidence masking: phones/emails/company numbers keep last 3 digits.

---

## 1. Log files scanned

| service | file | MB | mtime | lines | ts range |
|---|---|---|---|---|---|
| assistant | assistant.error.log | 0.03 | 2026-10-29T07:24:01.172Z | 606 | no timestamps in log →  |
| channels | channels.error.log | 0.00 | 2026-10-29T18:09:13.952Z | 3 | no timestamps in log →  |
| harness | harness.error.log | 0.35 | 2026-10-29T18:06:45.676Z | 1162 | 2026-10-23T00:28:44.877Z → 2026-10-29T09:42:56.560Z |
| harness | harness.out.log | 1.24 | 2026-10-30T10:27:46.282Z | 5059 | 2026-10-23T00:27:48.745Z → 2026-10-28T16:59:10.111Z |
| launcher | launcher.error.log | 0.02 | 2026-10-29T18:40:24.652Z | 336 | no timestamps in log →  |
| launcher | launcher.out.log | 0.01 | 2026-10-29T20:24:07.096Z | 190 | no timestamps in log →  |
| local-model | local-model.error.log | 16.70 | 2026-10-30T10:28:03.513Z | 139828 | no timestamps in log →  |
| local-model | local-model.out.log | 0.00 | 2026-10-22T21:34:01.282Z | 2 | no timestamps in log →  |
| mailtg-sender | mailtg-sender.error.log | 0.00 | 2026-10-29T07:12:24.259Z | 15 | no timestamps in log →  |
| mcp | mcp.out.log | 0.00 | 2026-10-25T13:05:32.273Z | 9 | no timestamps in log →  |
| wa-sender | wa-sender.error.log | 0.09 | 2026-10-29T10:53:00.557Z | 1413 | no timestamps in log →  |
| wa-sender | wa-sender.out.log | 0.14 | 2026-10-30T09:49:31.424Z | 1883 | 2026-10-25T14:31:11.243Z → 2026-10-29T08:02:40.432Z |

## 2. PM2 restart counts (best effort from capture)

| service | status | restarts | mem |
|---|---|---|---|
| sapauto-v8-assistant | online | GAP (table format/mojibake) | GAP |
| sapauto-v8-channels | online | GAP (table format/mojibake) | GAP |
| sapauto-v8-harness | online | GAP (table format/mojibake) | GAP |
| sapauto-v8-launcher | online | GAP (table format/mojibake) | GAP |
| sapauto-v8-local-model | online | GAP (table format/mojibake) | GAP |
| sapauto-v8-mailtg-sender | online | GAP (table format/mojibake) | GAP |
| sapauto-v8-mcp | online | GAP (table format/mojibake) | GAP |
| sapauto-v8-wa-sender | online | GAP (table format/mojibake) | GAP |

Note: the capture file is a `pm2 list` pretty table (mojibaked), not `pm2 jlist`, so counts and RSS are best-effort. Re-capture with `pm2 jlist > data\pm2-list.txt` for exact monit values.

## 3. Top error signatures

| # | signature | count | service | first / last |
|---|---|---|---|---|
| 1 | `WhatsApp pairing code request failed (<varied error/frames>)` | 618 | wa-sender | no ts / no ts |
| 2 | `Assistant manager cycle failed: database is locked :: no-frames` | 578 | assistant | no ts / no ts |
| 3 | `Account scan failed (<account>): Failed to initialize browser: browserType.launch: ENOENT: no such file or directory, mkdtemp 'C:\Users\ADMINI~1\AppData\Local\Temp\1\playwright-artifacts-XXXXXX' :: no` | 52 | harness | no ts / no ts |
| 4 | `Assistant manager cycle failed: database disk image is malformed :: no-frames` | 28 | assistant | no ts / no ts |
| 5 | `Account scan failed (<account>): Failed to persist the company registry to <tree>\data\company-registry.json :: no-frames` | 19 | harness | no ts / no ts |
| 6 | `Error: Attempted to use detached Frame '<hex>'. :: at CdpPage.evaluate (<tree>\node_modules\puppeteer-core\src\api\Page.ts:2362:35) | at Client.inject (<tree>\node_modules\whatsapp-web.js\src\Client.j` | 16 | wa-sender | no ts / no ts |
| 7 | `Error: Attempted to use detached Frame '<hex>'. :: at <tree>\node_modules\whatsapp-web.js\src\authStrategies\LocalAuth.js:65:27 | at async LocalAuth.logout (<tree>\node_modules\whatsapp-web.js\src\aut` | 13 | wa-sender | no ts / no ts |
| 8 | `  [cause]: Error: Cannot find module '<tree>\launcher\.next\server\chunks\[root-of-the-server]__<chunk>.js' :: - <tree>\launcher\node_modules\next\dist\cli\next-start.js | at ignore-listed frames { | ` | 12 | launcher | no ts / no ts |
| 9 | `[PDF Scanner Schedule] database disk image is malformed :: no-frames` | 8 | harness | no ts / no ts |
| 10 | `WhatsApp message failed: fetch failed :: no-frames` | 8 | wa-sender | no ts / no ts |
| 11 | `Error: Error: EBUSY: resource busy or locked, unlink '<tree>\channels\.wwebjs_auth\session\CrashpadMetrics-active.pma' :: at <tree>\node_modules\whatsapp-web.js\src\authStrategies\LocalAuth.js:65:27 |` | 8 | wa-sender | no ts / no ts |
| 12 | `WA delivery alert failed: WhatsApp text send to •••*7@c.us returned no confirmation (page zombie or still booting) :: no-frames` | 8 | wa-sender | no ts / no ts |
| 13 | `⨯ Error [ChunkLoadError]: Failed to load chunk server/chunks/[root-of-the-server]__<chunk>.js from runtime for chunk server/app/api/capabilities/route.js :: - <tree>\launcher\node_modules\next\dist\se` | 6 | launcher | no ts / no ts |
| 14 | `⨯ Error [ChunkLoadError]: Failed to load chunk server/chunks/[root-of-the-server]__<chunk>.js from runtime for chunk server/app/api/settings/route.js :: - <tree>\launcher\node_modules\next\dist\server` | 6 | launcher | no ts / no ts |
| 15 | `WA probe send failed: WhatsApp text send to •••*7@c.us returned no confirmation (page zombie or still booting) :: no-frames` | 6 | wa-sender | no ts / no ts |
| 16 | `Account scan failed (<account>): Failed to replace <tree>\data\tasks.json after 8 attempt(s) (EPERM). The previous register was left in place. :: no-frames` | 5 | harness | no ts / no ts |
| 17 | `Error: Error: ENOTEMPTY: directory not empty, rmdir '<tree>\channels\.wwebjs_auth\session' :: at <tree>\node_modules\whatsapp-web.js\src\authStrategies\LocalAuth.js:65:27 | at async LocalAuth.logout (` | 5 | wa-sender | no ts / no ts |
| 18 | `Error: Error: EBUSY: resource busy or locked, unlink '<tree>\channels\.wwebjs_auth\session\CrashpadMetrics-active.pma' :: no-frames` | 4 | wa-sender | no ts / no ts |
| 19 | `Error: Error: EBUSY: resource busy or locked, unlink '<tree>\channels\.wwebjs_auth\session\CrashpadMetrics-active.pma' :: at CdpPage.evaluate (<tree>\node_modules\puppeteer-core\src\api\Page.ts:2362:3` | 4 | wa-sender | no ts / no ts |
| 20 | `Error: Error: EBUSY: resource busy or locked, unlink '<tree>\channels\.wwebjs_auth\session\lockfile' :: at CdpPage.evaluate (<tree>\node_modules\puppeteer-core\src\api\Page.ts:2362:35) | at Client.inj` | 4 | wa-sender | no ts / no ts |
| 21 | `WA overwatch tick failed: WhatsApp client is not connected :: no-frames` | 4 | wa-sender | no ts / no ts |
| 22 | `Error: Error: EBUSY: resource busy or locked, unlink '<tree>\channels\.wwebjs_auth\session\lockfile' :: at <tree>\node_modules\whatsapp-web.js\src\authStrategies\LocalAuth.js:65:27 | at async LocalAut` | 3 | wa-sender | no ts / no ts |
| 23 | `WhatsApp message.reply failed → direct send fallback: window is not defined :: no-frames` | 3 | wa-sender | no ts / no ts |
| 24 | `WhatsApp reply fallback failed: window is not defined :: no-frames` | 3 | wa-sender | no ts / no ts |
| 25 | `Telegram poll failed: fetch failed :: no-frames` | 2 | channels | no ts / no ts |
| 26 | `Error: Error: EBUSY: resource busy or locked, unlink '<tree>\channels\.wwebjs_auth\session\lockfile' :: no-frames` | 2 | wa-sender | no ts / no ts |
| 27 | `WhatsApp message failed: fetch failed :: at CdpPage.evaluate (<tree>\node_modules\puppeteer-core\src\api\Page.ts:2362:35) | at Client.inject (<tree>\node_modules\whatsapp-web.js\src\Client.js:126:38) ` | 2 | wa-sender | no ts / no ts |
| 28 | `WhatsApp message failed: LOCAL_ASSISTANT_UNAVAILABLE: تم إيقاف المساعد المحلي من مركز التحكم؛ أعد تشغيله من هناك :: no-frames` | 2 | wa-sender | no ts / no ts |
| 29 | `Error: Attempted to use detached Frame '<hex>'. :: no-frames` | 2 | wa-sender | no ts / no ts |
| 30 | `Error: Error: ENOTEMPTY: directory not empty, rmdir '<tree>\channels\.wwebjs_auth\session' :: at CdpPage.evaluate (<tree>\node_modules\puppeteer-core\src\api\Page.ts:2362:35) | at Client.inject (<tree` | 2 | wa-sender | no ts / no ts |
| 31 | `WhatsApp transport watchdog: probe failed (strike 1): probe-failed :: no-frames` | 2 | wa-sender | no ts / no ts |
| 32 | `WhatsApp transport watchdog: probe failed (strike 2): probe-failed :: no-frames` | 2 | wa-sender | no ts / no ts |
| 33 | `Event dispatcher failed: database disk image is malformed :: no-frames` | 1 | channels | no ts / no ts |
| 34 | `[Harness Startup] PDF Scanner warning: database disk image is malformed :: no-frames` | 1 | harness | no ts / no ts |
| 35 | `⨯ Error: Failed to load external module better-sqlite3-90e2652d1716b047: Error: Cannot find module 'better-sqlite3-90e2652d1716b047' :: no-frames` | 1 | launcher | no ts / no ts |
| 36 | `⨯ Error: V8_SESSION_SECRET must contain at least 32 characters in production :: at getOrInstantiateModuleFromParent (<tree>\launcher\.next\server\chunks\[turbopack]_runtime.js:911:12) | at Context.com` | 1 | launcher | no ts / no ts |
| 37 | `⨯ Error: V8_SESSION_SECRET must contain at least 32 characters in production :: at Context.commonJsRequire [as r] (<tree>\launcher\.next\server\chunks\[turbopack]_runtime.js:486:12) | at module evalua` | 1 | launcher | no ts / no ts |
| 38 | `⨯ Error [ChunkLoadError]: Failed to load chunk server/chunks/[root-of-the-server]__<chunk>.js from runtime for chunk server/app/api/settings/route.js :: at module evaluation (<tree>\launcher\.next\ser` | 1 | launcher | no ts / no ts |
| 39 | `  [cause]: Error: Cannot find module '<tree>\launcher\.next\server\chunks\[root-of-the-server]__<chunk>.js' :: at module evaluation (lib\auth.js:6:9) | at module evaluation (lib\auth.js:6:9) | at Obje` | 1 | launcher | no ts / no ts |
| 40 | `Could not start local model runtime (ENOENT) :: no-frames` | 1 | local-model | no ts / no ts |

## 4. Unhandled rejections / uncaught exceptions

**None found.**

## 5. SQLite lock / corruption lines

- **578×** Assistant manager cycle failed: database is locked (assistant, no ts … no ts)
- **28×** Assistant manager cycle failed: database disk image is malformed (assistant, no ts … no ts)
- **8×** [PDF Scanner Schedule] database disk image is malformed (harness, no ts … no ts)
- **3×** WhatsApp outbox drain failed: database disk image is malformed (wa-sender, no ts … no ts)
- **1×** Event dispatcher failed: database disk image is malformed (channels, no ts … no ts)
- **1×** [Harness Startup] PDF Scanner warning: database disk image is malformed (harness, no ts … no ts)
- **1×** SqliteError: database disk image is malformed (mailtg-sender, no ts … no ts)
- **1×** code: 'SQLITE_CORRUPT' (mailtg-sender, no ts … no ts)

## 6. Launcher HTTP 500 lines

**None found.** (No access-log-style 500 lines exist in these files — Next does not log access lines here. The 500-class evidence is the ChunkLoadError module-failure family; it is counted under §3 crash signatures.)

## 7. WhatsApp state lines

- **channels** total state hits: 0
- **wa-sender** total state hits: 236
  - wwebjs-pin: 233 (example: `[wwebjs-pin] serving pinned web build 2.3000.•••220-alpha (382848 bytes) via local cache`)
  - disconnected: 3 (example: `Chromium browser disconnected unexpectedly. Marking client unready.`)
- **wa-sender** total state hits: 1097
  - qr: 796 (example: `WhatsApp requires QR pairing; view it in Owner Settings.`)
  - disconnected: 63 (example: `WhatsApp channel disconnected.`)
  - authenticated: 87 (example: `WhatsApp session authenticated and connected.`)
  - connected: 151 (example: `WhatsApp session authenticated and connected.`)

### wa-sender boot → ready durations

**GAP:** wa-sender `.out.log` lines carry no timestamps (the service logger is raw-text; PM2 adds no time header for legacy configs). Durations are not derivable until timestamped logging ships (upgradeplan Card S9). Recorded as an inventory finding, not a fake number.

## 7b. Patch/pin diagnostics (wa-sender .error.log — not crashes)

- **214×** (wa-sender) `[wwebjs-pin] serving pinned web build 2.3000.•••893-alpha (634601 bytes) via local cache`
- **86×** (wa-sender) `[wwebjs-patch] sendMessage: Msg.get returned undefined, returning synthetic ack`
- **10×** (wa-sender) `[wwebjs-pin] page navigating to non-root document: https://webtp.whatsapp.net/pdf-thumbnail/?locale=en_US`
- **4×** (wa-sender) `[wwebjs-pin] page navigating to non-root document: https://webtp.whatsapp.net/pdf-viewer/?locale=en_US`
- **3×** (wa-sender) `[wwebjs-pin] wa_web_version='live' — running the library's live-flow build resolution`
- **2×** (wa-sender) `[wwebjs-patch] attachEventListeners error: Failed to add page binding with name onAddMessageEvent: window['onAddMessageEvent'] already exists!`
- **1×** (wa-sender) `[wwebjs-pin] serving pinned web build 2.3000.•••220-alpha (382848 bytes) via local cache`
- **1×** (wa-sender) `[wwebjs-pin] MISS for 2.3000.•••665 - the LIVE web build will be served instead`
- **1×** (wa-sender) `[wwebjs-patch] attachEventListeners error: Protocol error (Page.addScriptToEvaluateOnNewDocument): Target closed`
- **1×** (wa-sender) `[wwebjs-patch] attachEventListeners error: Protocol error (Runtime.addBinding): Target closed`

## 7c. Warning-tier summary

- **152×** (harness) `Ignoring 1 partial temp file(s) beside <tree>\data\obligations.json; the existing register was not replaced. | {"filePath":"E:\\Drive\\Scan\\v8.1\\dat`
- **80×** (harness) `[LiveAiAnalyst] Could not connect to local AI server: connect ECONNREFUSED 127.0.0.1:7799`
- **76×** (harness) `Ignoring 1 partial temp file(s) beside <tree>\data\messages.json; the existing register was not replaced. | {"filePath":"E:\\Drive\\Scan\\v8.1\\data\\`
- **76×** (harness) `[LiveAiAnalyst] Query to local model timed out.`
- **76×** (harness) `[LiveAiAnalyst] Could not connect to local AI server: socket hang up`
- **52×** (harness) `Chrome channel unavailable (browserType.launch: ENOENT: no such file or directory, mkdtemp 'C:\Users\ADMINI~1\AppData\Local\Temp\1\playwright-artifact`
- **52×** (harness) `Edge channel unavailable (browserType.launch: ENOENT: no such file or directory, mkdtemp 'C:\Users\ADMINI~1\AppData\Local\Temp\1\playwright-artifacts-`
- **43×** (wa-sender) `WWebJS patch state changed`
- **31×** (harness) `Ignoring 1 partial temp file(s) beside <tree>\data\payments.json; the existing register was not replaced. | {"filePath":"E:\\Drive\\Scan\\v8.1\\data\\`
- **25×** (wa-sender) `delivery deferred: transport not ready`
- **24×** (harness) `[MessagesScraper] •••997: no message detail fields found (missing: subject, body).`
- **16×** (harness) `Warning: Cannot polyfill `DOMMatrix`, rendering may be broken: "Error: Cannot find module 'canvas'`

## 8. Errors left unclassified (overflow)

None — all signatures counted under the cap.

## 9. Findings for Track S (top-5 crash/error signatures)

1. (618×, wa-sender) `WhatsApp pairing code request failed (<varied error/frames>)`
2. (578×, assistant) `Assistant manager cycle failed: database is locked :: no-frames`
3. (52×, harness) `Account scan failed (<account>): Failed to initialize browser: browserType.launch: ENOENT: no such file or directory, mkdtemp 'C:\Users\ADMINI~1\AppData\Local\Temp\1\playwright-art`
4. (28×, assistant) `Assistant manager cycle failed: database disk image is malformed :: no-frames`
5. (19×, harness) `Account scan failed (<account>): Failed to persist the company registry to <tree>\data\company-registry.json :: no-frames`

## 10. Reproducibility

Run this script twice with the same inputs: the body of this report (all count tables) must match exactly. The generatedAt line is the only varying field.

## 11. What was NOT done on purpose (card scope)

- No runtime file or service touched; no restarts; no DB opened; no new migration; no test added.
- Restart counts and RSS come from the existing capture (best effort) because the script never shells into a foreign host’s pm2.
- Raw evidence lines are masked and truncated; no customer data, message bodies, or PDF text reproduced.
