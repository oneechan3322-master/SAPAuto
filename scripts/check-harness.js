'use strict';
const Database = require('better-sqlite3');
const db = new Database('data/sapauto.db');

const hs = db.prepare('SELECT * FROM harness_status').get();
console.log(`\n=== Harness Status: state=${hs.state}, account=${hs.current_account} (${hs.account_index}/${hs.account_total}) ===`);

const cycle = db.prepare('SELECT * FROM automation_cycles ORDER BY started_at DESC LIMIT 1').get();
console.log(`Cycle: state=${cycle.state}, processed=${cycle.accounts_processed}, failed=${cycle.accounts_failed}, total=${cycle.accounts_total}`);

const statuses = db.prepare('SELECT account_key, state, last_success_at, last_error FROM account_status ORDER BY updated_at DESC').all();
console.log('\nAccount Statuses:');
for (const s of statuses) {
  console.log(` - ${s.account_key}: state=${s.state}, last_success=${s.last_success_at ? s.last_success_at.slice(11,19) : 'none'}${s.last_error ? ', err=' + s.last_error.slice(0,60) : ''}`);
}

const compCount = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
const oblCount = db.prepare('SELECT COUNT(*) as c FROM obligations').get().c;
const payCount = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
const docCount = db.prepare('SELECT COUNT(*) as c FROM company_documents').get().c;

console.log(`\nDatabase Records: companies=${compCount}, tasks=${taskCount}, obligations=${oblCount}, payments=${payCount}, messages=${msgCount}, archive_docs=${docCount}`);

db.close();
