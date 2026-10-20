const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const root = path.resolve(__dirname, '../..');

function findPdfs(dir, list = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', '.next', '.wwebjs_auth', 'v8'].includes(entry.name)) continue;
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

const olderPdfs = findPdfs(root);
console.log('Total older PDFs found:', olderPdfs.length);

async function testOldPdfs() {
  let readableCount = 0;
  let emptyTextCount = 0;
  let errorCount = 0;

  for (let i = 0; i < Math.min(20, olderPdfs.length); i++) {
    const file = olderPdfs[i];
    try {
      const data = new Uint8Array(fs.readFileSync(file));
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
      let text = '';
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(' ');
      }
      const trimmed = text.replace(/\s+/g, ' ').trim();
      if (trimmed.length > 20) {
        readableCount++;
        console.log(`[READABLE ${trimmed.length} chars] ${path.basename(file)}: "${trimmed.slice(0, 70)}..."`);
      } else {
        emptyTextCount++;
        console.log(`[EMPTY/SCANNED] ${path.basename(file)}`);
      }
      await doc.cleanup();
      await doc.destroy();
    } catch (err) {
      errorCount++;
      console.log(`[ERROR] ${path.basename(file)}: ${err.message}`);
    }
  }
  console.log(`Summary of 20 samples: Readable=${readableCount}, Empty/Scanned=${emptyTextCount}, Errors=${errorCount}`);
}

testOldPdfs();
