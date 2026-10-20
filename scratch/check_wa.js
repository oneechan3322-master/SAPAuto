const path = require('path');
const { getDatabase } = require(path.join(__dirname, '../db/connect'));
const db = getDatabase();
console.log(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'whatsapp%'").all());
