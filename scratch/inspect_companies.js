const path = require('path');
const { getDatabase } = require(path.join(__dirname, '../db/connect'));
const db = getDatabase();
console.log('companies columns:', db.prepare("PRAGMA table_info(companies)").all());
console.log('first 5 companies:', db.prepare("SELECT * FROM companies LIMIT 5").all());
