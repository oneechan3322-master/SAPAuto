'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

test('channel credentials are Windows-protected at rest and merge by provider', {
  skip: process.platform !== 'win32'
}, (t) => {
  const previousLocalAppData = process.env.LOCALAPPDATA
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-vault-test-'))
  process.env.LOCALAPPDATA = directory
  const modulePath = require.resolve('../channels/secure-store')
  delete require.cache[modulePath]
  const vault = require('../channels/secure-store')

  t.after(() => {
    delete require.cache[modulePath]
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previousLocalAppData
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const gmailPassword = 'vault-test-gmail-password-1234'
  const telegramToken = '123456:abcdefghijklmnopqrstuvwxyzABCDEFGHIJK'
  vault.writeAll({ gmail: { email: 'test@example.invalid', password: gmailPassword } })
  const gmail = vault.readAll()
  assert.equal(gmail.gmail.password, gmailPassword)

  vault.writeAll({ ...gmail, telegram: { token: telegramToken } })
  const merged = vault.readAll()
  assert.equal(merged.gmail.email, 'test@example.invalid')
  assert.equal(merged.telegram.token, telegramToken)
  assert.equal(vault.hasStoredCredentials('gmail'), true)
  assert.equal(vault.hasStoredCredentials('telegram'), true)

  const encryptedFile = fs.readFileSync(path.join(directory, 'SAPAuto', 'V8', 'channels.dpapi'), 'utf8')
  assert.equal(encryptedFile.includes(gmailPassword), false)
  assert.equal(encryptedFile.includes(telegramToken), false)
})
