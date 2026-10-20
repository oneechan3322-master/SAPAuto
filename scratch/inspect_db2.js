const path = require('path');
const { getDatabase } = require(path.join(__dirname, '../db/connect'));
const db = getDatabase();

console.log('company_documents columns:', db.prepare("PRAGMA table_info(company_documents)").all().map(c => c.name));
console.log('company_documents count:', db.prepare("SELECT COUNT(*) as n FROM company_documents").get());
console.log('tasks count:', db.prepare("SELECT COUNT(*) as n FROM tasks").get());
console.log('sample task:', db.prepare("SELECT * FROM tasks WHERE pdf_path IS NOT NULL LIMIT 1").get());
console.log('sample company_document:', db.prepare("SELECT * FROM company_documents LIMIT 1").get());
