const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../db/connect');
const { extractPdfText } = require('../assistant/pdf-reader.cjs');
const { normalizeDigits } = require('../assistant/document-title-resolver.cjs');

const db = getDatabase();
const v8PdfDir = path.resolve(__dirname, '../data/pdfs');

const allCompanies = db.prepare('SELECT id, name, account_key, portal_name, tax_registration_number FROM companies').all();

function matchCompany(text, filename) {
  const combined = `${filename} ${text}`;
  const ascii = normalizeDigits(combined);

  // 1. Exact match on tax registration number or account_key base (e.g. 407186514 vs 407186514_0)
  for (const comp of allCompanies) {
    const key = (comp.account_key || '').trim();
    const baseKey = key.replace(/[_-]\d+$/, '');
    if (baseKey.length >= 6 && ascii.includes(baseKey)) {
      return comp;
    }
    const taxNum = (comp.tax_registration_number || '').trim();
    if (taxNum.length >= 6 && ascii.includes(taxNum)) {
      return comp;
    }
  }

  // 2. Keyword match in Arabic names
  for (const comp of allCompanies) {
    const name = comp.name || comp.portal_name || '';
    if (!name) continue;
    // Common unique keywords
    const keywords = ['روتوستار', 'حميده', 'العروبه', 'شراينول', 'فونيكس', 'يونايتد', 'كيمورا', 'كيسينج', 'جلوب', 'المهندس', 'الفرسان', 'البركة', 'النيل', 'برايت', 'جرين', 'ترانس'];
    for (const kw of keywords) {
      if (name.includes(kw) && combined.includes(kw)) {
        return comp;
      }
    }
  }

  // 3. Fallback: match 2+ distinctive words
  for (const comp of allCompanies) {
    const name = comp.name || comp.portal_name || '';
    if (!name) continue;
    const words = name.split(/\s+/).filter(w => w.length >= 4 && !['شركة', 'مجموعة', 'المتحدة', 'شراكة', 'وشركاه', 'المصرية', 'احمد', 'محمد'].includes(w));
    if (words.length > 0) {
      let matched = 0;
      for (const w of words) {
        if (combined.includes(w)) matched++;
      }
      if (matched >= 2 || (words.length === 1 && matched === 1)) {
        return comp;
      }
    }
  }

  return null;
}

async function testAll() {
  const files = fs.readdirSync(v8PdfDir).filter(f => /\.pdf$/i.test(f));
  console.log(`Testing all ${files.length} PDFs in v8/data/pdfs...`);

  let matchedCount = 0;
  let unMatchedFiles = [];

  for (const f of files) {
    const p = path.join(v8PdfDir, f);
    try {
      const pdf = await extractPdfText(p);
      const comp = matchCompany(pdf.text, f);
      if (comp) {
        matchedCount++;
      } else {
        unMatchedFiles.push(f);
      }
    } catch (e) {
      unMatchedFiles.push(`${f} (error: ${e.message})`);
    }
  }

  console.log(`Matched: ${matchedCount} / ${files.length} (${((matchedCount/files.length)*100).toFixed(1)}%)`);
  if (unMatchedFiles.length > 0) {
    console.log('Unmatched samples:', unMatchedFiles.slice(0, 15));
  }
}

testAll();
