'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { runLegacy } = require('./source')

async function runAccount(accountKey) {
  if (typeof accountKey !== 'string' || !accountKey.trim()) throw new Error('Account key is required')
  const outputPath = path.join(os.tmpdir(), `sapauto-v8-${randomUUID()}.json`)
  try {
    await runLegacy(['--account', accountKey, '--json-out', outputPath, '--no-email'])
    const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    for (const key of ['login', 'tasks', 'obligations', 'payments', 'messages', 'diffs']) {
      if (!Object.hasOwn(result, key)) throw new Error(`SAPAuto3 result is missing ${key}`)
    }
    for (const key of ['tasks', 'obligations', 'payments', 'messages', 'diffs']) {
      if (!Array.isArray(result[key])) throw new Error(`SAPAuto3 result ${key} must be an array`)
    }
    return result
  } finally {
    if (fs.existsSync(outputPath)) fs.rmSync(outputPath)
  }
}

module.exports = { runAccount }
