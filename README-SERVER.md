# Moving to the server PC — short version

Nothing here runs by itself: nothing installs on boot, no scheduled tasks, no
injected files, no auto-updates. You copy a folder and start it with one
command. Everything else is done from the dashboard, live.

## 1. Copy
Copy the whole `SapAuto\v8.1` folder to the server PC (USB / network share),
keeping `..\SapAuto\pet` beside it (the model files live there). The folder
carries the database, node_modules, secrets and the prebuilt dashboard —
**no npm install is needed** on the target machine.

Best time: after `pm2 stop all` on the old machine (clean database), but the
database copies as three files (`sapauto.db`, `-wal`, `-shm`) so an intact
stop avoids any risk.

## 2. Start (one command, typed only when you want it running)
```bat
cd SapAuto\v8.1
pm2 start ecosystem.config.cjs --update-env
pm2 save
```
Check everything live with:
```bat
node scripts\server-health-check.js
```
Want it back after a restart of the server PC? Type the same `pm2 start` again,
or (only when YOU decide): create one scheduled task that runs
`pm2 resurrect` at logon. Nothing in this project creates it by itself.

## 3. Dashboard on the network
The launcher binds all interfaces (`0.0.0.0:3000`): any PC or phone on the
network opens `http://<server-pc-ip>:3000`. Windows Firewall asks once on
first start — allow private networks, or add an inbound rule for TCP 3000.

## 4. WhatsApp — all live, all from the dashboard (no restarts, no files)
- **Pair the office number:** Dashboard → Channel Center → connect WhatsApp.
  It asks WhatsApp for a pairing code to the configured control number (or
  shows a QR) and connects within seconds of you entering it.
- **Change the control number:** Channel Center → save control number. The
  dispatcher and the sender pick it up on their next cycle.
- **Add a staff/family number:** Owner page → generate a link code (valid 10
  minutes) → that number sends `link 123456` in WhatsApp. From that moment it
  receives deliveries and its messages to the AI get answered.
- **Remove:** the link row is a single `user_channels` delete — or disconnect
  the session from Channel Center for a full unpair.
- **Accounts (tax portal):** Dashboard → accounts: add, edit password, enable/
  disable or delete — takes effect at the next scan, no restart.

## 5. The AI reads and answers
Every allowed number (control number + linked numbers + self-chat) can:
- send a scan command and get the summary + fresh PDFs back,
- send any question — the assistant answers from the live workspace data,
- send a PDF and ask for a summary.
Unknown numbers stay silent on purpose.

## 6. If anything looks wrong
`node scripts\server-health-check.js` prints PASS/FAIL rows: database
integrity, migration level, 8 services online, dashboard HTTP 200, RAM.
