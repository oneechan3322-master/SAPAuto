'use strict'

const path = require('node:path')
const root = __dirname

// Shared PM2 policy (Opus5.5 §6.7): no file watching (WAL/cache churn would
// restart-loop the services), graceful stop via PM2's Windows message channel,
// and a memory ceiling per process. The implicit log/error files stay in PM2.
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

module.exports = {
  apps: [
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
        SERVICE_NAME: 'channels',
        WHATSAPP_ENABLED: 'true'
      },
      // WhatsApp runs Chromium in-process today; its ceiling is higher until
      // the sender is split into its own app.
      max_memory_restart: '900M'
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
}
