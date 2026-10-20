const { getDatabase } = require('../db/connect');
const db = getDatabase();

const accounts = db.prepare('SELECT account_key, username FROM accounts').all();
const companies = db.prepare('SELECT id, name, account_key, tax_registration_number FROM companies').all();

console.log('Accounts total:', accounts.length);
console.log('Companies total:', companies.length);
companies.forEach(c => {
  console.log(`- ${c.account_key}: "${c.name.slice(0, 45)}" (tax_id: "${c.tax_registration_number}")`);
});
