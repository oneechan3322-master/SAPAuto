const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
console.log('Root:', root);

function findPdfs(dir, list = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === '.wwebjs_auth') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findPdfs(full, list);
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        list.push({ path: full, size: fs.statSync(full).size, name: entry.name });
      }
    }
  } catch (err) {
    // skip
  }
  return list;
}

const all = findPdfs(root);
console.log('Total PDFs found:', all.length);

const byFolder = {};
for (const item of all) {
  const rel = path.relative(root, item.path);
  const top = rel.split(path.sep)[0];
  byFolder[top] = (byFolder[top] || 0) + 1;
}
console.log('By folder:', byFolder);
