'use strict'

const path = require('node:path')

// Structured logging with a redaction list (Opus5.5 §6.4). The redact list is
// the mechanical half of "no secret reaches a log line"; the other half is
// never passing raw credentials into a log call. Existing console.* call sites
// migrate incrementally; new modules log through this interface only.
const SERVICE = process.env.SERVICE_NAME || 'sapauto'
const ROOT = process.env.V8_ROOT || path.resolve(__dirname, '..')

const REDACT_PATHS = [
  'password', '*.password',
  'token', '*.token',
  'apiKey', '*.apiKey',
  'authorization', '*.authorization', 'headers.authorization',
  'cookie', '*.cookie',
  'storageState', '*.storageState',
  'MISTRAL_API_KEY', '*.MISTRAL_API_KEY', 'MISTRAL_API_KEYS', '*.MISTRAL_API_KEYS',
  'RESEND_API_KEY', '*.RESEND_API_KEY', 'RESEND_API_KEYS', '*.RESEND_API_KEYS',
  'TELEGRAM_BOT_TOKEN', '*.TELEGRAM_BOT_TOKEN',
  'GMAIL_APP_PASSWORD', '*.GMAIL_APP_PASSWORD',
  'V8_MCP_BEARER_TOKEN', '*.V8_MCP_BEARER_TOKEN',
  'V8_SESSION_SECRET', '*.V8_SESSION_SECRET',
  'V8_LOCAL_AI_TOKEN', '*.V8_LOCAL_AI_TOKEN'
]

function createLogger() {
  const pino = require('pino')
  const options = {
    level: process.env.LOG_LEVEL || 'info',
    base: { service: SERVICE, pid: process.pid },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime
  }
  // File logging is for long-running services: PM2 sets SERVICE_NAME for every
  // app in ecosystem.config.cjs. Test processes and one-off scripts therefore
  // stay stdout-only instead of creating logs/ inside the repo.
  const fileLogging = process.env.V8_LOG_FILE === '1' ||
    (process.env.V8_LOG_FILE !== '0' && Boolean(process.env.SERVICE_NAME))
  if (!fileLogging) return pino(options)
  const targets = [{ target: 'pino/file', options: { destination: 1 } }]
  try {
    require.resolve('pino-roll')
    targets.unshift({
      target: 'pino-roll',
      options: {
        file: path.join(ROOT, 'logs', SERVICE),
        frequency: 'daily',
        size: '100m',
        mkdir: true,
        extension: '.log',
        limit: { count: 14 }
      }
    })
  } catch { /* pino-roll unavailable: stdout only */ }
  return pino(options, pino.transport({ targets }))
}

const log = createLogger()

/** Correlation context, e.g. child({ runId, companyId, eventId }). */
const child = (context) => log.child(context)

module.exports = { log, child }
