#!/usr/bin/env node
'use strict';
const Database = require('better-sqlite3');
const db = new Database('data/sapauto.db');

// Check columns in each key table
for (const t of ['companies', 'accounts', 'obligations', 'messages', 'tasks']) {
  try {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
    console.log(`${t} columns:`, cols);
  } catch(e) { console.log(`${t}: error`, e.message); }
}

// Companies
try {
  const companies = db.prepare('SELECT * FROM companies LIMIT 5').all();
  console.log('\nCompanies sample:', companies);
} catch(e) { console.log('companies error:', e.message); }

// Accounts
try {
  const accts = db.prepare('SELECT * FROM accounts LIMIT 5').all();
  console.log('\nAccounts sample:', accts);
} catch(e) { console.log('accounts error:', e.message); }

db.close();
