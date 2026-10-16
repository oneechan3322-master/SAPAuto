'use strict'

const path = require('node:path')
const root = __dirname

module.exports = {
  apps: [
    {
      name: 'sapauto-v8-harness',
      script: path.join(root, 'harness', 'index.js'),
      cwd: root,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100
    },
    {
      name: 'sapauto-v8-channels',
      script: path.join(root, 'channels', 'index.js'),
      cwd: root,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100
    },
    {
      name: 'sapauto-v8-assistant',
      script: path.join(root, 'assistant', 'manager.js'),
      cwd: root,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100
    },
    {
      name: 'sapauto-v8-local-model',
      script: path.join(root, 'assistant', 'local-model-server.js'),
      cwd: root,
      autorestart: false,
      restart_delay: 10000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100
    },
    {
      name: 'sapauto-v8-mcp',
      script: path.join(root, 'mcp', 'server.js'),
      cwd: root,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100
    },
    {
      name: 'sapauto-v8-launcher',
      script: path.join(root, 'launcher', 'node_modules', 'next', 'dist', 'bin', 'next'),
      args: 'start --hostname 127.0.0.1 --port 3000',
      cwd: path.join(root, 'launcher'),
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100
    }
  ]
}
