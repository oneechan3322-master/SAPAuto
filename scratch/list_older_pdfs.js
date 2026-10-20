const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function findPdfs(dir, list = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', '.next', '.wwebjs_auth', 'v8', 'pet'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findPdfs(full, list);
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        list.push(full);
      }
    }
  } catch (err) {}
  return list;
}

const older = findPdfs(root);
console.log('Count:', older.length);
older.forEach((f, i) => console.log(`${i+1}. ${path.relative(root, f)} (${(fs.statSync(f).size / 1024).toFixed(1)} KB)`));
