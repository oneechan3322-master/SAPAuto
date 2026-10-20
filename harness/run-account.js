'use strict'

const { scanAccount } = require('./scraper')

/* The legacy bridge spawned an external subprocess with a hard kill timeout:
   ['--account', accountKey, '--json-out', outputPath, '--no-email']
   The native scanner runs in-process, but the cycle must stay bounded (RULE 6):
   a scan that exceeds this limit is abandoned with an honest error and the
   harness records the account failure like any other. */
const DEFAULT_SCAN_TIMEOUT_MS = 15 * 60 * 1000

async function runAccount(accountKey, options = {}) {
  if (typeof accountKey !== 'string' || !accountKey.trim()) throw new Error('Account key is required')
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_SCAN_TIMEOUT_MS
  const scanner = options.scanAccount || scanAccount
  let timer
  try {
    const result = await Promise.race([
      scanner(accountKey),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Account scan exceeded ${Math.round(timeoutMs / 1000)} seconds`))
        }, timeoutMs)
      })
    ])
    for (const key of ['login', 'tasks', 'obligations', 'payments', 'messages', 'diffs']) {
      if (!Object.hasOwn(result, key)) throw new Error(`Scan result is missing ${key}`)
    }
    for (const key of ['tasks', 'obligations', 'payments', 'messages', 'diffs']) {
      if (!Array.isArray(result[key])) throw new Error(`Scan result ${key} must be an array`)
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { DEFAULT_SCAN_TIMEOUT_MS, runAccount }
