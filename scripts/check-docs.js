'use strict';
const Database = require('better-sqlite3');
const db = new Database('data/sapauto.db');

const rows = db.prepare(`
  SELECT id, title, obligation_code, deadline, status 
  FROM obligations 
  WHERE title LIKE '%بطاقة%' OR title LIKE '%سجل%' OR title LIKE '%قيمة مضافة%'
`).all();

console.log('Matches:', rows);
db.close();
