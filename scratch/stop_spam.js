'use strict'
const { getDatabase } = require('../db/connect')
const db = getDatabase()

const r1 = db.prepare("UPDATE settings SET value='false' WHERE key='whatsapp_wake_notifications'").run()
const r2 = db.prepare("UPDATE events SET announced=1 WHERE announced=0").run()
console.log('Disabled wake notifications:', r1.changes)
console.log('Marked pending events announced:', r2.changes)
