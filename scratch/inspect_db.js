const path = require('path');
const { getDatabase } = require(path.join(__dirname, '../db/connect'));
const db = getDatabase();

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name));

const taskCols = db.prepare("PRAGMA table_info(tasks)").all();
console.log('tasks columns:', taskCols.map(c => c.name));

const docTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE type='document' OR type LIKE '%doc%'").all();
console.log('Document tasks count:', docTasks);

const sampleDoc = db.prepare("SELECT * FROM tasks WHERE type='document' LIMIT 1").get();
console.log('Sample doc task:', sampleDoc);
