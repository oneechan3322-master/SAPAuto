const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const v8PdfDir = path.resolve(__dirname, '../data/pdfs');

function getHash(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch (err) {
    return null;
  }
}

// 1. Map existing V8 PDFs by hash and filename
const v8Hashes = new Set();
const v8Files = fs.readdirSync(v8PdfDir).filter(f => /\.pdf$/i.test(f));
for (const file of v8Files) {
  const hash = getHash(path.join(v8PdfDir, file));
  if (hash) v8Hashes.add(hash);
}
console.log(`Existing V8 PDFs in data/pdfs: ${v8Files.length} files (${v8Hashes.size} unique hashes)`);

// 2. Scan older versions
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
let missingInV8 = [];
const seenOldHashes = new Set();

for (const oldFile of older) {
  const hash = getHash(oldFile);
  if (!hash) continue;
  if (seenOldHashes.has(hash)) continue; // duplicate among older versions
  seenOldHashes.add(hash);
  if (!v8Hashes.has(hash)) {
    missingInV8.push({ path: oldFile, hash, name: path.basename(oldFile), size: fs.statSync(oldFile).size });
  }
}

console.log(`Unique older PDFs: ${seenOldHashes.size}`);
console.log(`Older PDFs NOT in V8 data/pdfs: ${missingInV8.length}`);
missingInV8.forEach((m, idx) => console.log(`${idx+1}. ${m.name} (${(m.size/1024).toFixed(1)} KB) from ${path.relative(root, m.path)}`));
