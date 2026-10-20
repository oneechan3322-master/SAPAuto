'use strict'

/**
 * V8-native scan configuration (plan 4.1 §4).
 *
 * Reads the same environment knobs the legacy SAPAuto3 scanner honored, with
 * the same defaults and validation ranges, minus the email/AI settings that the
 * legacy orchestrator needed and V8 replaces with its own channels and
 * assistant. The .env file next to the V8 root is parsed so existing operator
 * setups keep working unchanged.
 */

const fs = require('node:fs')
const path = require('node:path')
const { assertNumberInRange } = require('./common/assertions')

function v8Root() {
  return process.env.V8_ROOT || path.resolve(__dirname, '..', '..')
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function loadScanConfig(options = {}) {
  if (options.envFile !== false) parseEnvFile(options.envFile || path.join(v8Root(), '.env'))

  const root = v8Root()
  return {
    headedMode: process.env.HEADED_MODE === 'true',
    slowMoMs: assertNumberInRange(
      Number.parseInt(process.env.SLOW_MO_MS || '100', 10), 'SLOW_MO_MS', 0, 5000, 'loadScanConfig'),
    keycloakTimeoutMs: assertNumberInRange(
      Number.parseInt(process.env.KEYCLOAK_TIMEOUT_MS || '60000', 10), 'KEYCLOAK_TIMEOUT_MS', 5000, 300000, 'loadScanConfig'),
    sapTimeoutMs: assertNumberInRange(
      Number.parseInt(process.env.SAP_TIMEOUT_MS || '60000', 10), 'SAP_TIMEOUT_MS', 5000, 300000, 'loadScanConfig'),
    maxDocsPerAccount: assertNumberInRange(
      Number.parseInt(process.env.MAX_DOCS_PER_ACCOUNT || '50', 10), 'MAX_DOCS_PER_ACCOUNT', 1, 500, 'loadScanConfig'),
    // PDFs land in the directory V8's .gitignore already reserves for them.
    downloadsDir: path.join(root, 'data', 'pdfs'),
    // Every scraper register stays inside V8's data directory; nothing is
    // written to the process working directory.
    dataDir: path.join(root, 'data')
  }
}

module.exports = { loadScanConfig, parseEnvFile, v8Root }
