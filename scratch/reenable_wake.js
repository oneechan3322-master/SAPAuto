'use strict'
const { getDatabase } = require('../db/connect')
const db = getDatabase()

// Re-enable wake notifications now that the infinite-retry bug is fixed
const r1 = db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_wake_notifications','true',datetime('now')) ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at").run()
console.log('wake_notifications re-enabled:', r1.changes)

// Clear all unannounced events except truly new ones from the last 30 seconds
// (the spam events are from yesterday; we don't want them to fire again)
const cutoff = new Date(Date.now() - 30 * 1000).toISOString()
const r2 = db.prepare("UPDATE events SET announced=1 WHERE announced=0 AND created_at < ?").run(cutoff)
console.log('Old pending events cleared:', r2.changes)

// Verify state
console.log('Wake settings:', db.prepare("SELECT key, value FROM settings WHERE key LIKE '%wake%' OR key='whatsapp_wake_notifications'").all())
console.log('Pending events:', db.prepare('SELECT id, kind, created_at FROM events WHERE announced=0').all())
