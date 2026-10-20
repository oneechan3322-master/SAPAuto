const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../db/connect');
const { extractPdfText } = require('../assistant/pdf-reader.cjs');
const { normalizeDigits } = require('../assistant/document-title-resolver.cjs');

const db = getDatabase();
const v8PdfDir = path.resolve(__dirname, '../data/pdfs');

const files = fs.readdirSync(v8PdfDir).filter(f => /\.pdf$/i.test(f));
console.log(`Checking ${files.length} PDFs...`);

let matchedByTaskDocNum = 0;
let matchedByCompanyKeyword = 0;
let unMatched = 0;

for (const f of files) {
  const ascii = normalizeDigits(f);
  const numMatch = ascii.match(/(?:1800\d{8}|2000\d{8}|2300\d{8}|2400\d{8}|7300\d{8}|7550\d{8}|9330\d{8}|\d{12})/);
  let matched = false;

  if (numMatch) {
    const docNum = numMatch[0];
    const task = db.prepare('SELECT account_key, company_id, title FROM tasks WHERE doc_number = ?').get(docNum);
    if (task) {
      matchedByTaskDocNum++;
      matched = true;
    }
  }

  if (!matched) {
    // try reading text
    try {
      const pdf = fs.readFileSync(path.join(v8PdfDir, f));
      // quick check for keywords or tax ID
      matchedByCompanyKeyword++;
    } catch (_) {
      unMatched++;
    }
  }
}

console.log(`Matched by task doc number: ${matchedByTaskDocNum}`);
