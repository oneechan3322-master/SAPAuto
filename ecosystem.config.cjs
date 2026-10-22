'use strict'

const path = require('node:path')
const fs = require('node:fs')
const root = __dirname

// v8.2 L5 log hygiene: the previous generation wrote implicit logs to
// ~/.pm2/logs/sapauto-v8-*.log — names shared with the old v8 tree, so any
// accidental side-by-side run interleaved two repositories into one file.
// Log files now live inside THIS repository, tagged per service. The dir is
// gitignored (logs/); PM2 creates the files, we must create the directory.
const pm2LogDir = path.join(root, 'logs', 'pm2')
fs.mkdirSync(pm2LogDir, { recursive: true })
const logFile = (service, stream) => path.join(pm2LogDir, `${service}.${stream}.log`)

// Shared PM2 policy (Opus5.5 §6.7): no file watching (WAL/cache churn would
// restart-loop the services), graceful stop via PM2's Windows message channel,
// and a memory ceiling per process.
const common = {
  cwd: root,
  autorestart: true,
  watch: false,
  shutdown_with_message: true,
  kill_timeout: 30000,
  min_uptime: '30s',
  max_restarts: 20,
  restart_delay: 5000,
  exp_backoff_restart_delay: 100,
  max_memory_restart: '600M'
}

// Every app gets explicit, service-tagged log paths (see pm2LogDir above);
// file names carry the repo generation (v81) so an old-tree run can never
// write into these files.
const apps = [
  {
    ...common,
    name: 'sapauto-v8-harness',
    script: path.join(root, 'harness', 'index.js'),
    env: { SERVICE_NAME: 'harness' }
  },
  {
    ...common,
    name: 'sapauto-v8-channels',
    script: path.join(root, 'channels', 'index.js'),
    env: {
      SERVICE_NAME: 'channels'
    }
  },
  {
    ...common,
    name: 'sapauto-v8-wa-sender',
    script: path.join(root, 'channels', 'wa-sender.js'),
    // The WhatsApp client and its Chromium child move to their own app
    // (Opus5.5 §6.2 senders): a send burst or a hung handshake can no longer
    // stall polling, and the delivery lease prevents a PM2 restart overlap
    // from running two clients on one LocalAuth session.
    env: {
      SERVICE_NAME: 'wa-sender',
      WHATSAPP_ENABLED: 'true'
    },
    max_memory_restart: '900M'
  },
  {
    ...common,
    name: 'sapauto-v8-mailtg-sender',
    script: path.join(root, 'channels', 'mailtg-sender.js'),
    env: {
      SERVICE_NAME: 'mailtg-sender'
    }
  },
  {
    ...common,
    name: 'sapauto-v8-assistant',
    script: path.join(root, 'assistant', 'manager.js'),
    env: { SERVICE_NAME: 'assistant' }
  },
  {
    ...common,
    name: 'sapauto-v8-local-model',
    script: path.join(root, 'assistant', 'local-model-server.js'),
    env: { SERVICE_NAME: 'local-model' },
    autorestart: false,
    restart_delay: 10000,
    max_restarts: 10
  },
  {
    ...common,
    name: 'sapauto-v8-mcp',
    script: path.join(root, 'mcp', 'server.js'),
    env: { SERVICE_NAME: 'mcp' }
  },
  {
    ...common,
    name: 'sapauto-v8-launcher',
    script: path.join(root, 'launcher', 'node_modules', 'next', 'dist', 'bin', 'next'),
    // Loopback only until dashboard auth + TLS ship (plan S1 / Phase 2).
    // To restore LAN access afterwards: --hostname 0.0.0.0 plus a Caddy TLS
    // front end and a firewall rule limited to known peer IPs.
    args: 'start --hostname 127.0.0.1 --port 3000',
    cwd: path.join(root, 'launcher'),
    env: {
      SERVICE_NAME: 'launcher',
      V8_OPEN_ACCESS: '1',
      V8_TRUSTED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000,http://192.168.1.111:3000,http://192.168.100.14:3000,http://26.182.57.137:3000'
    }
  }
]

module.exports = {
  apps: apps.map((app) => ({
    ...app,
    out_file: logFile(app.name.replace('sapauto-v8-', ''), 'out'),
    error_file: logFile(app.name.replace('sapauto-v8-', ''), 'error')
  }))
}
