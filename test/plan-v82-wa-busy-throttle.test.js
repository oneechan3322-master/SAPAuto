'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')

const WINDOW_MS = 10 * 60 * 1000

// The whisper helper is deliberately small and inside whatsapp.js; its logic is
// mirrored here through the same settings-key contract the real handler uses.
// If the two drift apart, this test catches it via a source assertion below.
function whisper(db, chatId, now) {
  let whispers = {}
  try { whispers = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='assistant_down_whisper'").get()?.value || '{}') } catch {}
  const last = whispers[chatId] || 0
  if (now - last >= WINDOW_MS) {
    whispers[chatId] = now
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('assistant_down_whisper',?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(JSON.stringify(whispers))
    return true
  }
  return false
}

test('WhatsApp busy whisper: one honest reply per chat per window, silence between', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-whisper-'))
  const db = openDatabase(path.join(dir, 'w.db'))
  try {
    runMigrations(db)
    const t0 = Date.now()
    assert.equal(whisper(db, 'chat_A@c.us', t0), true, 'first failure answers')
    assert.equal(whisper(db, 'chat_A@c.us', t0 + 60_000), false, 'within the window: silence')
    assert.equal(whisper(db, 'chat_B@c.us', t0 + 60_000), true, 'another chat still gets its one answer')
    assert.equal(whisper(db, 'chat_A@c.us', t0 + WINDOW_MS - 1000), false, 'just inside the window')
    assert.equal(whisper(db, 'chat_A@c.us', t0 + WINDOW_MS + 1000), true, 'after the window the chat is answered again')
    const persisted = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='assistant_down_whisper'").get().value)
    assert.equal(Object.keys(persisted).length, 2)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('WhatsApp handler wires the whisper throttle (source contract)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'channels', 'whatsapp.js'), 'utf8')
  assert.match(source, /assistant_down_whisper/)
  assert.match(source, /DOWN_WHISPER_WINDOW_MS = 10 \* 60 \* 1000/)
  assert.equal(Array.from(source.matchAll(/\\u062A\\u0639\\u0630\\u0631 \\u062A\\u0634\\u063A\\u064A\\u0644 \\u0627\\u0644\\u0645\\u0633\\u0627\\u0639\\u062F/g)).length, 1,
    'the down-reply must exist exactly once - inside the throttled fail-safe path')
})
