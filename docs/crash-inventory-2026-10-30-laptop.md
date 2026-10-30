# Crash & error inventory — laptop

- Generated at: 2026-10-30T10:28:47.651Z (Cairo 30/10/2026, 12:28:47)
- Logs root: C:\Users\Mega Store\Downloads\SapAuto\v8.1\logs\pm2
- PM2 capture: C:\Users\Mega Store\Downloads\SapAuto\v8.1\data\pm2-list.txt (captured 2026-10-25T17:14:46.910Z)
- Host RAM (running machine): 15.8 GB total / 5.99 GB free
- Read policy: PM2 logs + pm2 capture ONLY. Never read: .env, data/accounts.key*, channels/.wwebjs_auth*, DPAPI vault. Evidence masking: phones/emails/company numbers keep last 3 digits.

---

## 1. Log files scanned

| service | file | MB | mtime | lines | ts range |
|---|---|---|---|---|---|
| assistant | assistant.error.log | 0.00 | 2026-10-23T00:23:17.808Z | 37 | no timestamps in log →  |
| harness | harness.out.log | 0.00 | 2026-10-23T00:23:19.614Z | 30 | no timestamps in log →  |
| launcher | launcher.error.log | 0.00 | 2026-10-22T21:35:03.900Z | 20 | no timestamps in log →  |
| launcher | launcher.out.log | 0.00 | 2026-10-23T00:23:20.306Z | 35 | no timestamps in log →  |
| local-model | local-model.error.log | 0.00 | 2026-10-23T00:23:25.476Z | 2 | no timestamps in log →  |
| local-model | local-model.out.log | 0.00 | 2026-10-23T00:23:25.692Z | 4 | no timestamps in log →  |
| mcp | mcp.out.log | 0.00 | 2026-10-23T00:23:19.544Z | 2 | no timestamps in log →  |
| wa-sender | wa-sender.error.log | 0.01 | 2026-10-23T00:23:32.645Z | 137 | no timestamps in log →  |
| wa-sender | wa-sender.out.log | 0.01 | 2026-10-23T00:23:37.231Z | 136 | no timestamps in log →  |

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
| 1 | `WhatsApp pairing code request failed (<varied error/frames>)` | 133 | wa-sender | no ts / no ts |
| 2 | `Assistant manager cycle failed: database is locked :: no-frames` | 37 | assistant | no ts / no ts |
| 3 | `⨯ Error: Failed to load external module better-sqlite3-90e2652d1716b047: Error: Cannot find module 'better-sqlite3-90e2652d1716b047' :: no-frames` | 1 | launcher | no ts / no ts |

## 4. Unhandled rejections / uncaught exceptions

**None found.**

## 5. SQLite lock / corruption lines

- **37×** Assistant manager cycle failed: database is locked (assistant, no ts … no ts)

## 6. Launcher HTTP 500 lines

**None found.** (No access-log-style 500 lines exist in these files — Next does not log access lines here. The 500-class evidence is the ChunkLoadError module-failure family; it is counted under §3 crash signatures.)

## 7. WhatsApp state lines

- **wa-sender** total state hits: 0
- **wa-sender** total state hits: 134
  - qr: 134 (example: `WhatsApp requires QR pairing; view it in Owner Settings.`)

### wa-sender boot → ready durations

**GAP:** wa-sender `.out.log` lines carry no timestamps (the service logger is raw-text; PM2 adds no time header for legacy configs). Durations are not derivable until timestamped logging ships (upgradeplan Card S9). Recorded as an inventory finding, not a fake number.

## 7b. Patch/pin diagnostics (wa-sender .error.log — not crashes)

None found.

## 7c. Warning-tier summary

- **2×** (harness) `Warning: Cannot polyfill `DOMMatrix`, rendering may be broken: "Error: Cannot find module 'canvas'`
- **2×** (harness) `Warning: Cannot polyfill `Path2D`, rendering may be broken: "Error: Cannot find module 'canvas'`

## 8. Errors left unclassified (overflow)

None — all signatures counted under the cap.

## 9. Findings for Track S (top-5 crash/error signatures)

1. (133×, wa-sender) `WhatsApp pairing code request failed (<varied error/frames>)`
2. (37×, assistant) `Assistant manager cycle failed: database is locked :: no-frames`
3. (1×, launcher) `⨯ Error: Failed to load external module better-sqlite3-90e2652d1716b047: Error: Cannot find module 'better-sqlite3-90e2652d1716b047' :: no-frames`

## 10. Reproducibility

Run this script twice with the same inputs: the body of this report (all count tables) must match exactly. The generatedAt line is the only varying field.

## 11. What was NOT done on purpose (card scope)

- No runtime file or service touched; no restarts; no DB opened; no new migration; no test added.
- Restart counts and RSS come from the existing capture (best effort) because the script never shells into a foreign host’s pm2.
- Raw evidence lines are masked and truncated; no customer data, message bodies, or PDF text reproduced.
