'use strict'

const { heartbeat, updateStatus } = require('../db/queries/harness')

function startHeartbeat(db, intervalMs = 30000) {
  heartbeat(db)
  const timer = setInterval(() => {
    try {
      heartbeat(db)
    } catch (error) {
      console.error(`Harness heartbeat failed: ${error.message}`)
    }
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

function setHarnessState(state, fields = {}, db) {
  updateStatus({ ...fields, state }, db)
}

module.exports = { startHeartbeat, setHarnessState }
