'use strict'

/**
 * V8-native scanner CLI (plan 4.1 §4). Replaces the legacy orchestrator
 * bridge: same scan, V8's own code, single account per call.
 *
 *   node harness/scraper/cli.js --account <key> --json-out <path>
 *
 * Credentials are resolved from the encrypted accounts store, never from the
 * command line. The JSON written to --json-out honors the contract
 * harness/run-account.js validates.
 */

const fs = require('node:fs')
const path = require('node:path')

function parseCliArguments(argv) {
  const args = [...argv]
  let accountKey = ''
  let jsonOutFile = ''
  while (args.length > 0) {
    const flag = args.shift()
    if (flag === '--account' || flag === '--json-out') {
      const value = args.shift()
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
      if (flag === '--account') {
        if (accountKey) throw new Error('--account may only be given once')
        accountKey = value
      } else {
        if (jsonOutFile) throw new Error('--json-out may only be given once')
        jsonOutFile = value
      }
      continue
    }
    throw new Error(`Unknown argument: ${flag}`)
  }
  if (!accountKey) throw new Error('--account is required')
  if (!jsonOutFile) throw new Error('--json-out is required')
  return { accountKey, jsonOutFile }
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const { accountKey, jsonOutFile } = parseCliArguments(argv)
  // Resolved at call time (and injectable) so tests never need to monkey-patch
  // a module export captured at load.
  const scanner = deps.scanAccount || require('./index').scanAccount
  const result = await scanner(accountKey)
  const outputPath = path.resolve(jsonOutFile)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(result), { encoding: 'utf8', flag: 'wx' })
  fs.renameSync(temporaryPath, outputPath)
  return result
}

if (require.main === module) {
  main().then((result) => {
    process.stdout.write(`Scan of ${result.account.key} completed: login=${result.login.success}\n`)
  }).catch((error) => {
    console.error(`Scan failed: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { main, parseCliArguments }
