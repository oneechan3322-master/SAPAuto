const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDatabase } = require('../db/connect');
const { extractPdfText, normalizeArabicText } = require('../assistant/pdf-reader.cjs');
const { normalizeDigits, sanitizeFilename } = require('../assistant/document-title-resolver.cjs');

const db = getDatabase();
const root = path.resolve(__dirname, '../..');
const v8PdfDir = path.resolve(__dirname, '../data/pdfs');

if (!fs.existsSync(v8PdfDir)) {
  fs.mkdirSync(v8PdfDir, { recursive: true });
}

function getSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Pre-load all companies
const allCompanies = db.prepare('SELECT id, name, account_key, portal_name, tax_registration_number FROM companies').all();
console.log(`Loaded ${allCompanies.length} companies.`);

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

function matchCompany(text, filename) {
  const combined = `${filename} ${text}`;
  const ascii = normalizeDigits(combined);

  for (const comp of allCompanies) {
    if (comp.account_key && comp.account_key.length >= 6) {
      if (ascii.includes(comp.account_key)) {
        return comp;
      }
    }
  }

  for (const comp of allCompanies) {
    const name = comp.name || comp.portal_name || '';
    if (!name) continue;
    const words = name.split(/\s+/).filter(w => w.length >= 4 && !['شركة', 'مجموعة', 'المتحدة', 'شراكة', 'وشركاه', 'المصرية', 'احمد', 'محمد'].includes(w));
    if (words.length > 0) {
      let matchedWords = 0;
      for (const w of words) {
        if (combined.includes(w)) matchedWords++;
      }
      if (matchedWords >= 2 || (words.length === 1 && matchedWords === 1)) {
        return comp;
      }
    }
  }

  return null;
}

function detectDocumentDetails(text, filename) {
  const combined = `${filename} ${text}`;
  const ascii = normalizeDigits(combined);
  const t = text.toLowerCase();

  let docNumber = '';
  const numMatch = ascii.match(/(?:1800\d{8}|2000\d{8}|2300\d{8}|2400\d{8}|7300\d{8}|7550\d{8}|9330\d{8}|\d{12})/);
  if (numMatch) {
    docNumber = numMatch[0];
  }

  let officialTitle = '';
  let docType = 'portal_document';

  if ((t.includes('دفعات') || combined.includes('دفعات')) && (t.includes('تجديد') || t.includes('موافق') || combined.includes('قبول'))) {
    officialTitle = 'إخطار بالموافقة على تجديد نظام الدفعات المقدمة';
  } else if ((t.includes('دفعات') || combined.includes('دفعات')) && (t.includes('رفض') || combined.includes('رفض'))) {
    officialTitle = 'إخطار برفض تجديد نظام الدفعات المقدمة';
  } else if (t.includes('طعن') || combined.includes('طعن')) {
    if (t.includes('8/1') || t.includes('1/8') || t.includes('٨/١') || combined.includes('8/1') || t.includes('قرار')) {
      officialTitle = 'إعلان بقرار لجنة الطعن — نموذج (8-1)';
    } else if (t.includes('جلسة') || t.includes('حضور') || combined.includes('جلسة')) {
      officialTitle = 'إخطار تحديد جلسة أمام لجنة الطعن الضريبي';
    } else {
      officialTitle = 'إعلان بقرار لجنة الطعن الضريبي';
    }
  } else if ((t.includes('19') || combined.includes('19') || combined.includes('١٩')) && (t.includes('دمغة') || combined.includes('دمغة'))) {
    officialTitle = 'نموذج (19) دمغة — ربط ضريبة الدمغة والطعن';
  } else if ((t.includes('19') || combined.includes('19') || combined.includes('١٩')) && (t.includes('ربط') || t.includes('عناصر') || combined.includes('ربط'))) {
    officialTitle = 'نموذج (19) ضرائب — إخطار بعناصر ربط الضريبة';
  } else if ((t.includes('15') || combined.includes('15') || combined.includes('١٥')) && (t.includes('فحص') || combined.includes('فحص'))) {
    officialTitle = 'نموذج (15) فحص ضريبي — إخطار بالفحص الميداني';
  } else if (t.includes('تجهيز') || combined.includes('تجهيز') || t.includes('دفاتر')) {
    officialTitle = 'إخطار تجهيز المستندات والدفاتر للفحص الضريبي';
  } else if (t.includes('استلام') || t.includes('إستلام') || combined.includes('استلام') || combined.includes('إستلام')) {
    officialTitle = 'إخطار تأكيد استلام المستندات';
  } else if (t.includes('38') || combined.includes('38') || combined.includes('مرتبات')) {
    officialTitle = 'نموذج (38) ضريبة المرتبات وما في حكمها';
  } else if (combined.includes('ملاحظات قبول') || t.includes('ملاحظات قبول')) {
    officialTitle = 'إشعار ملاحظات قبول الفحص الإلكتروني';
  } else if (combined.includes('أسباب الرفض') || combined.includes('اسباب الرفض') || t.includes('رفض')) {
    officialTitle = 'إشعار أسباب رفض المستندات الإلكترونية';
  } else {
    officialTitle = 'مستند رسمي من مصلحة الضرائب المصرية';
  }

  let issueDate = '';
  const dateMatch = ascii.match(/(?:202[0-9][\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]202[0-9])/);
  if (dateMatch) {
    issueDate = dateMatch[0].replace(/\//g, '-');
  }

  return { officialTitle, docType, docNumber, issueDate };
}

async function run() {
  const olderPdfs = findPdfs(root);
  console.log(`Scanning ${olderPdfs.length} older PDFs...`);

  // Build existing hash map
  const existingHashes = new Set();
  const v8Files = fs.readdirSync(v8PdfDir).filter(f => /\.pdf$/i.test(f));
  for (const f of v8Files) {
    try {
      existingHashes.add(getSha256(fs.readFileSync(path.join(v8PdfDir, f))));
    } catch (_) {}
  }
  console.log(`Existing V8 unique hashes: ${existingHashes.size}`);

  let copied = 0;
  let alreadyPresent = 0;

  for (const file of olderPdfs) {
    try {
      const buf = fs.readFileSync(file);
      const hash = getSha256(buf);
      if (existingHashes.has(hash)) {
        alreadyPresent++;
        continue;
      }
      // Copy to v8/data/pdfs
      const basename = path.basename(file);
      let targetName = basename;
      let counter = 1;
      while (fs.existsSync(path.join(v8PdfDir, targetName))) {
        targetName = `${path.parse(basename).name}_imported_${counter++}.pdf`;
      }
      fs.writeFileSync(path.join(v8PdfDir, targetName), buf);
      existingHashes.add(hash);
      copied++;
      console.log(`[COPIED] ${targetName} (${(buf.length/1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`Failed to copy ${file}:`, err.message);
    }
  }

  console.log(`Copy summary: Copied=${copied}, Already Present=${alreadyPresent}`);

  // Now test reading first 10 copied/present PDFs inside v8/data/pdfs
  const allV8Pdfs = fs.readdirSync(v8PdfDir).filter(f => /\.pdf$/i.test(f));
  console.log(`Total V8 PDFs now: ${allV8Pdfs.length}`);

  let matched = 0;
  for (let i = 0; i < Math.min(10, allV8Pdfs.length); i++) {
    const fPath = path.join(v8PdfDir, allV8Pdfs[i]);
    const pdf = await extractPdfText(fPath);
    const details = detectDocumentDetails(pdf.text, allV8Pdfs[i]);
    const comp = matchCompany(pdf.text, allV8Pdfs[i]);
    if (comp) matched++;
    console.log(`* ${allV8Pdfs[i]} -> Title: "${details.officialTitle}", Doc#: ${details.docNumber || 'none'}, Company: ${comp ? comp.name.slice(0, 30) : 'none'}`);
  }
  console.log(`Matched companies in 10 samples: ${matched}`);
}

run();
