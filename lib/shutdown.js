'use strict'

const { closeDatabase } = require('../db/connect')
const { log } = require('./logger')

// Windows PM2 has no real signals, so graceful shutdown arrives as a
// 'shutdown' message (PM2 shutdown_with_message). Without this, PM2 kills the
// process hard while it is mid-write. Every new service installs this; the
// legacy monolith keeps its own handler until it is split.
function installShutdown(cleanup, { timeoutMs = 25000, closeDb = true } = {}) {
  let started = false
  const run = async (why) => {
    if (started) return
    started = true
    log.info({ why }, 'shutting down')
    const force = setTimeout(() => {
      log.error('shutdown timed out; forcing exit')
      process.exit(1)
    }, timeoutMs)
    force.unref()
    try {
      await cleanup()
    } catch (error) {
      log.error({ err: error.message }, 'shutdown cleanup failed')
    }
    try {
      if (closeDb) closeDatabase()
    } catch (error) {
      log.error({ err: error.message }, 'database close failed')
    }
    clearTimeout(force)
    process.exit(0)
  }
  process.on('message', (message) => { if (message === 'shutdown') run('pm2-message') })
  process.once('SIGINT', () => run('SIGINT'))
  process.once('SIGTERM', () => run('SIGTERM'))
  return run
}

module.exports = { installShutdown }
