'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const CHANNELS = path.resolve(__dirname, '..', 'channels')
const read = (name) => fs.readFileSync(path.join(CHANNELS, name), 'utf8')

test('unlinked contacts never receive automatic pairing replies', () => {
  for (const file of ['whatsapp.js', 'telegram.js', 'gmail.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /allowUnlinkedReply/,
      `${file} must stay silent for unknown contacts`)
  }

  assert.doesNotMatch(read('whatsapp.js'), /message\.reply\('اطلب من المالك رمز ربط/,
    'WhatsApp must not message unknown chats')
  assert.doesNotMatch(read('telegram.js'), /sendMessage'.*اطلب من مالك النظام رمز ربط/s,
    'Telegram must not message unknown chats')
  assert.doesNotMatch(read('gmail.js'), /sendGmail\(sender, 'اطلب من مالك SAPAuto رمز ربط/,
    'Gmail must not message unknown senders')
})

test('a paired WhatsApp session is restored after the channel worker restarts', () => {
  // Opus5.5 §6.2: the WhatsApp client and its session restore moved from the
  // channels worker to the dedicated wa-sender process; the guard moves with
  // the behaviour.
  const sender = read('wa-sender.js')
  assert.match(sender, /pairingRequested \|\| whatsappConnected/,
    'a persisted connected session must start the WhatsApp sender again')
})

test('WhatsApp refuses delivery before its browser session reports ready', () => {
  const whatsapp = read('whatsapp.js')
  assert.match(whatsapp, /if \(!client \|\| !clientReady\)/,
    'a stale database flag must not permit a premature send')
  assert.match(whatsapp, /if \(!result\) throw new Error\('WhatsApp did not confirm the test delivery'\)/,
    'an unconfirmed provider result must not be reported as delivered')
})

test('WhatsApp clears a stale connected flag before restoring a session', () => {
  const whatsapp = read('whatsapp.js')
  assert.match(whatsapp, /VALUES\('whatsapp_connected','false',\?\)/,
    'startup must not inherit a previous process connection claim')
})
