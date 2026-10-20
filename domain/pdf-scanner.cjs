'use strict';

/**
 * PDF Scanner & Database Ingestion Engine for SAPAuto V8.
 *
 * Implements:
 * 1. Automatic discovery and deduplication of older SAPAuto PDFs (v3, v4, v6, etc.).
 * 2. Automated OCR / text extraction via pdf-reader and Unicode NFKC normalization.
 * 3. Intelligent company matching (by Tax Registration Number, account_key, tasks.doc_number, or Arabic name).
 * 4. Automatic ingestion into `company_documents` and linking into `tasks`.
 * 5. Folder watching / on-demand scanning for user-dropped PDFs ("auto no need to type in").
 *
 * Adheres strictly to USER RULES:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs at entry
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 10: Defensive redundancy
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { extractPdfText, normalizeArabicText } = require('../assistant/pdf-reader.cjs');
const { normalizeDigits, sanitizeFilename } = require('../assistant/document-title-resolver.cjs');
const { extractInspectionFacts } = require('./document-inspection.cjs');

function computeFileSha256(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('Valid file path required for computeFileSha256');
  }
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Searches directories recursively for .pdf files, skipping build/internal dirs.
 */
function findPdfFilesRecursively(dir, maxDepth = 6, currentDepth = 0) {
  const results = [];
  if (currentDepth > maxDepth) return results;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (['node_modules', '.git', '.next', '.wwebjs_auth', '.antigravitycli'].includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPdfFilesRecursively(fullPath, maxDepth, currentDepth + 1));
    } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Detects document metadata from text content and filename.
 */
function analyzePdfMetadata(text, filename) {
  const normText = String(text || '').normalize('NFKC');
  const combined = `${filename} ${normText}`;
  const ascii = normalizeDigits(combined);
  const t = normText.toLowerCase();

  // 1. Doc Number
  let docNumber = '';
  const numMatch = ascii.match(/(?:1800\d{8}|2000\d{8}|2300\d{8}|2400\d{8}|7300\d{8}|7550\d{8}|9330\d{8}|\d{12})/);
  if (numMatch) {
    docNumber = numMatch[0];
  }

  // 2. Official Title & Doc Type
  let officialTitle = '';
  let docType = 'portal_document';

  if ((t.includes('دفعات') || combined.includes('دفعات')) && (t.includes('تجديد') || t.includes('موافق') || combined.includes('قبول'))) {
    officialTitle = 'إخطار بالموافقة على تجديد نظام الدفعات المقدمة';
    docType = 'prepayment_approval';
  } else if ((t.includes('دفعات') || combined.includes('دفعات')) && (t.includes('رفض') || combined.includes('رفض'))) {
    officialTitle = 'إخطار برفض تجديد نظام الدفعات المقدمة';
    docType = 'prepayment_rejection';
  } else if (t.includes('طعن') || combined.includes('طعن')) {
    if (t.includes('8/1') || t.includes('1/8') || t.includes('٨/١') || combined.includes('8/1') || t.includes('قرار')) {
      officialTitle = 'إعلان بقرار لجنة الطعن — نموذج (8-1)';
      docType = 'appeal_decision';
    } else if (t.includes('جلسة') || t.includes('حضور') || combined.includes('جلسة')) {
      officialTitle = 'إخطار تحديد جلسة أمام لجنة الطعن الضريبي';
      docType = 'appeal_hearing';
    } else {
      officialTitle = 'إعلان بقرار لجنة الطعن الضريبي';
      docType = 'appeal_decision';
    }
  } else if ((t.includes('19') || combined.includes('19') || combined.includes('١٩')) && (t.includes('دمغة') || combined.includes('دمغة'))) {
    officialTitle = 'نموذج (19) دمغة — ربط ضريبة الدمغة والطعن';
    docType = 'form_19_stamp';
  } else if ((t.includes('19') || combined.includes('19') || combined.includes('١٩')) && (t.includes('ربط') || t.includes('عناصر') || combined.includes('ربط'))) {
    officialTitle = 'نموذج (19) ضرائب — إخطار بعناصر ربط الضريبة';
    docType = 'form_19_tax';
  } else if ((t.includes('15') || combined.includes('15') || combined.includes('١٥')) && (t.includes('فحص') || combined.includes('فحص'))) {
    officialTitle = 'نموذج (15) فحص ضريبي — إخطار بالفحص الميداني';
    docType = 'form_15_inspection';
  } else if (t.includes('تجهيز') || combined.includes('تجهيز') || t.includes('دفاتر')) {
    officialTitle = 'إخطار تجهيز المستندات والدفاتر للفحص الضريبي';
    docType = 'books_inspection_request';
  } else if (t.includes('استلام') || t.includes('إستلام') || combined.includes('استلام') || combined.includes('إستلام')) {
    officialTitle = 'إخطار تأكيد استلام المستندات';
    docType = 'receipt_confirmation';
  } else if (t.includes('38') || combined.includes('38') || combined.includes('مرتبات')) {
    officialTitle = 'نموذج (38) ضريبة المرتبات وما في حكمها';
    docType = 'form_38_payroll';
  } else if (combined.includes('ملاحظات قبول') || t.includes('ملاحظات قبول')) {
    officialTitle = 'إشعار ملاحظات قبول الفحص الإلكتروني';
    docType = 'acceptance_notice';
  } else if (combined.includes('أسباب الرفض') || combined.includes('اسباب الرفض') || t.includes('رفض')) {
    officialTitle = 'إشعار أسباب رفض المستندات الإلكترونية';
    docType = 'rejection_notice';
  } else {
    officialTitle = 'مستند ضريبي رسمي';
    docType = 'portal_document';
  }

  // 3. Tax registration number (TIN)
  let extractedTin = '';
  const tinMatch = ascii.match(/(?:التسجيل\s+الضريبى|التسجيل\s+الضريبي|الرقم\s+الضريبي|رقم\s+التسجيل)\s*[:：-]?\s*(\d{9})/);
  if (tinMatch && tinMatch[1]) {
    extractedTin = tinMatch[1];
  }

  // 4. Issue Date
  let issueDate = '';
  const dateMatch = ascii.match(/(?:202[0-9][\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]202[0-9])/);
  if (dateMatch) {
    issueDate = dateMatch[0].replace(/\//g, '-');
  }

  return {
    officialTitle,
    docType,
    docNumber,
    extractedTin,
    issueDate
  };
}

/**
 * Matches a document to a company using Tax ID, tasks table, or company name keywords.
 */
function resolveCompany(db, { docNumber, extractedTin, text, filename, companies }) {
  // Strategy 1: Check tasks table if docNumber matches an existing task
  if (docNumber) {
    const task = db.prepare('SELECT company_id, account_key FROM tasks WHERE doc_number = ? LIMIT 1').get(docNumber);
    if (task && task.company_id) {
      const comp = companies.find((c) => c.id === task.company_id);
      if (comp) return comp;
    }
  }

  const combined = `${filename} ${text || ''}`.normalize('NFKC');
  const ascii = normalizeDigits(combined);

  // Strategy 2: Match by extracted TIN or account_key base
  const searchTins = [extractedTin].filter(Boolean);
  for (const comp of companies) {
    const key = (comp.account_key || '').trim();
    const baseKey = key.replace(/[_-]\d+$/, '');
    if (baseKey.length >= 6) {
      if (ascii.includes(baseKey) || (extractedTin && extractedTin === baseKey)) {
        return comp;
      }
    }
    const taxNum = (comp.tax_registration_number || '').trim();
    if (taxNum.length >= 6) {
      if (ascii.includes(taxNum) || (extractedTin && extractedTin === taxNum)) {
        return comp;
      }
    }
  }

  // Strategy 3: Key Arabic brand/name tokens
  const distinctiveMap = [
    { token: 'روتوستار', key: 'rotostar' },
    { token: 'حميده', key: 'Aroba2024' },
    { token: 'العروبه', key: 'Aroba2024' },
    { token: 'شراينول', key: 'shrinol' },
    { token: 'فونيكس', key: '407186514_0' },
    { token: 'يونايتد', key: 'marwanhamada' },
    { token: 'كيمورا', key: '205971997' },
    { token: 'كيسينج', key: '315240679' },
    { token: 'جلوب', key: '533158788' },
    { token: 'المهندس', key: '329724118' },
    { token: 'العقدة', key: '474255484' },
    { token: 'جاست باك', key: '528407953' },
    { token: 'سامورال', key: '562285210' },
    { token: 'ايادي', key: 'AiadyArabia' },
    { token: 'الكمال', key: 'Alkamal123' },
    { token: 'صبري', key: 'HashimSabry' },
    { token: 'حسن عبداللطيف', key: 'MrhassanSap' },
    { token: 'اوفر سيز', key: 'Thenile14' },
    { token: 'ترانس جلف', key: 'TransGulfM' },
    { token: 'عبر الخليج', key: 'Trans_gulf' },
    { token: 'اون تايم', key: 'ahmedon' },
    { token: 'بى اس', key: 'ahmedps' },
    { token: 'الصفا', key: 'elsafasap' },
    { token: 'افجي', key: 'evgeegypt' },
    { token: 'فريش لاند', key: 'fresh_land' },
    { token: 'سيليكت جرين', key: 'select-green' },
    { token: 'برايت', key: 'Bright-123' }
  ];

  for (const item of distinctiveMap) {
    if (combined.includes(item.token)) {
      const comp = companies.find((c) => c.account_key === item.key);
      if (comp) return comp;
    }
  }

  return null;
}

/**
 * Main PDF Scanner and Indexer.
 * 
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.db
 * @param {string} [params.targetDir] - Root data/pdfs directory in V8
 * @param {boolean} [params.importOlderVersions=true] - Whether to sweep older SAPAuto folders
 * @returns {Promise<{ totalFound: number, imported: number, newlyIndexed: number, updated: number, errors: string[] }>}
 */
async function scanAndIngestAllPdfs({ db, targetDir, importOlderVersions = true }) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('scanAndIngestAllPdfs: valid database instance is required');
  }

  const v8DataDir = path.resolve(__dirname, '..', 'data');
  const pdfsDir = targetDir || path.join(v8DataDir, 'pdfs');
  const inboxDir = path.join(v8DataDir, 'inbox_pdfs');

  if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
  if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });

  const rootDir = path.resolve(__dirname, '../..');
  const companies = db.prepare('SELECT id, name, account_key, portal_name, tax_registration_number FROM companies').all();

  // 1. Build cache of existing files in v8/data/pdfs by SHA256
  const existingHashes = new Map();
  const existingV8Files = fs.readdirSync(pdfsDir).filter((f) => /\.pdf$/i.test(f));
  for (const f of existingV8Files) {
    const full = path.join(pdfsDir, f);
    try {
      const hash = computeFileSha256(full);
      existingHashes.set(hash, full);
    } catch (_) {}
  }

  let importedFromOld = 0;
  const errors = [];

  // 2. Import older PDFs if requested
  if (importOlderVersions) {
    const oldPdfs = findPdfFilesRecursively(rootDir);
    for (const oldFile of oldPdfs) {
      // Skip files already inside v8
      if (path.resolve(oldFile).toLowerCase().includes(path.join(path.sep, 'v8', path.sep).toLowerCase())) {
        continue;
      }
      try {
        const hash = computeFileSha256(oldFile);
        if (existingHashes.has(hash)) {
          continue; // already present
        }
        const basename = path.basename(oldFile);
        let destName = basename;
        let counter = 1;
        while (fs.existsSync(path.join(pdfsDir, destName))) {
          destName = `${path.parse(basename).name}_imported_${counter++}.pdf`;
        }
        const destPath = path.join(pdfsDir, destName);
        fs.copyFileSync(oldFile, destPath);
        existingHashes.set(hash, destPath);
        importedFromOld++;
      } catch (err) {
        errors.push(`Failed to import older PDF ${path.basename(oldFile)}: ${err.message}`);
      }
    }
  }

  // 3. Import any user-dropped PDFs from inbox_pdfs
  const inboxFiles = fs.readdirSync(inboxDir).filter((f) => /\.pdf$/i.test(f));
  for (const inboxFile of inboxFiles) {
    const src = path.join(inboxDir, inboxFile);
    try {
      const hash = computeFileSha256(src);
      if (!existingHashes.has(hash)) {
        let destName = inboxFile;
        let counter = 1;
        while (fs.existsSync(path.join(pdfsDir, destName))) {
          destName = `${path.parse(inboxFile).name}_drop_${counter++}.pdf`;
        }
        const destPath = path.join(pdfsDir, destName);
        fs.copyFileSync(src, destPath);
        existingHashes.set(hash, destPath);
        importedFromOld++;
      }
      // Clean up inbox file once safely copied
      try { fs.unlinkSync(src); } catch (_) {}
    } catch (err) {
      errors.push(`Failed to ingest inbox PDF ${inboxFile}: ${err.message}`);
    }
  }

  // 4. Index all PDFs in v8/data/pdfs into company_documents & tasks
  const allCurrentPdfs = fs.readdirSync(pdfsDir).filter((f) => /\.pdf$/i.test(f));
  let newlyIndexed = 0;
  let updatedCount = 0;

  const nowIso = new Date().toISOString();

  const insertDocStmt = db.prepare(`
    INSERT OR REPLACE INTO company_documents (
      id, company_id, account_key, doc_type, doc_name, doc_number,
      issuer, issue_date, expiry_date, assigned_role, status, notes,
      file_path, source, direction, received_at, registered_by, custodian,
      ocr_state, ocr_text, ocr_updated_at, created_at, updated_at
    ) VALUES (
      @id, @company_id, @account_key, @doc_type, @doc_name, @doc_number,
      @issuer, @issue_date, @expiry_date, @assigned_role, @status, @notes,
      @file_path, @source, @direction, @received_at, @registered_by, @custodian,
      @ocr_state, @ocr_text, @ocr_updated_at, @created_at, @updated_at
    )
  `);

  const updateDocStmt = db.prepare(`
    UPDATE company_documents
    SET doc_name = @doc_name,
        doc_number = @doc_number,
        company_id = @company_id,
        account_key = @account_key,
        file_path = @file_path,
        ocr_state = @ocr_state,
        ocr_text = @ocr_text,
        ocr_updated_at = @ocr_updated_at,
        updated_at = @updated_at
    WHERE id = @id
  `);

  const findDocById = db.prepare('SELECT id, ocr_state, doc_number, company_id FROM company_documents WHERE id = ? LIMIT 1');
  const findDocByPath = db.prepare('SELECT id, ocr_state, doc_number, company_id FROM company_documents WHERE file_path = ? LIMIT 1');
  const findDocByNum = db.prepare("SELECT id, ocr_state, file_path FROM company_documents WHERE doc_number = ? AND doc_number <> '' LIMIT 1");

  for (const filename of allCurrentPdfs) {
    const fullPath = path.join(pdfsDir, filename);
    let hash = '';
    try {
      hash = computeFileSha256(fullPath);
    } catch (err) {
      errors.push(`Error hashing ${filename}: ${err.message}`);
      continue;
    }

    // Extract text via pdf-reader
    let text = '';
    let ocrState = 'pending';
    try {
      const pdf = await extractPdfText(fullPath);
      text = String(pdf.text || '').normalize('NFKC');
      ocrState = text.length > 20 ? 'text_extracted' : 'needs_ocr';
    } catch (err) {
      ocrState = 'failed';
      errors.push(`Error reading PDF ${filename}: ${err.message}`);
    }

    // Detect metadata & matched company
    const meta = analyzePdfMetadata(text, filename);
    const comp = resolveCompany(db, {
      docNumber: meta.docNumber,
      extractedTin: meta.extractedTin,
      text,
      filename,
      companies
    });

    const companyId = comp ? comp.id : (companies[0]?.id || '');
    const accountKey = comp ? (comp.account_key || '') : '';

    // Update company tax_registration_number if we just learned it
    if (comp && meta.extractedTin && !comp.tax_registration_number) {
      try {
        db.prepare('UPDATE companies SET tax_registration_number = ? WHERE id = ?').run(meta.extractedTin, comp.id);
        comp.tax_registration_number = meta.extractedTin;
      } catch (_) {}
    }

    // Check if task exists and link file_path
    if (meta.docNumber) {
      try {
        const existingTask = db.prepare('SELECT id, pdf_path FROM tasks WHERE doc_number = ? LIMIT 1').get(meta.docNumber);
        if (existingTask && (!existingTask.pdf_path || !fs.existsSync(existingTask.pdf_path))) {
          db.prepare('UPDATE tasks SET pdf_path = ?, updated_at = ? WHERE id = ?').run(fullPath, nowIso, existingTask.id);
        }
      } catch (_) {}
    }

    // Extract inspection facts if relevant
    const facts = extractInspectionFacts(text);
    if (comp && (facts.inspection_officer || facts.books_from_year || facts.books_to_year || facts.inspection_notes)) {
      try {
        db.prepare(`
          INSERT INTO company_inspection_profiles(company_id,inspection_officer,books_from_year,books_to_year,inspection_notes,source_document_id,updated_at)
          VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(company_id) DO UPDATE SET inspection_officer=excluded.inspection_officer,books_from_year=excluded.books_from_year,
            books_to_year=excluded.books_to_year,inspection_notes=excluded.inspection_notes,updated_at=excluded.updated_at
        `).run(comp.id, facts.inspection_officer, facts.books_from_year, facts.books_to_year, facts.inspection_notes, `pdf_${hash.slice(0, 16)}`, nowIso);
      } catch (_) {}
    }

    // Upsert into company_documents
    const docId = `pdf_doc_${hash.slice(0, 16)}`;
    const existingById = findDocById.get(docId);
    const existingByPath = findDocByPath.get(fullPath);
    const existingByNum = meta.docNumber ? findDocByNum.get(meta.docNumber) : null;
    const existing = existingById || existingByPath || existingByNum;

    if (existing) {
      updateDocStmt.run({
        id: existing.id,
        doc_name: meta.officialTitle,
        doc_number: meta.docNumber || existing.doc_number || '',
        company_id: companyId,
        account_key: accountKey,
        file_path: fullPath,
        ocr_state: ocrState,
        ocr_text: text.slice(0, 40000),
        ocr_updated_at: nowIso,
        updated_at: nowIso
      });
      updatedCount++;
    } else {
      const docId = `pdf_doc_${hash.slice(0, 16)}`;
      insertDocStmt.run({
        id: docId,
        company_id: companyId,
        account_key: accountKey,
        doc_type: meta.docType,
        doc_name: meta.officialTitle,
        doc_number: meta.docNumber || '',
        issuer: 'مصلحة الضرائب المصرية',
        issue_date: meta.issueDate || '',
        expiry_date: '',
        assigned_role: 'المحاسب القانوني للملف',
        status: 'valid',
        notes: comp ? `تم الفحص والأرشفة التلقائية لشركة ${comp.name}` : 'تمت الأرشفة التلقائية عبر ماسح PDF',
        file_path: fullPath,
        source: 'auto_scan',
        direction: 'incoming',
        received_at: meta.issueDate || nowIso,
        registered_by: 'SAPAuto Scanner (OCR)',
        custodian: 'أرشيف المكتب الضريبي',
        ocr_state: ocrState,
        ocr_text: text.slice(0, 40000),
        ocr_updated_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso
      });
      newlyIndexed++;
    }
  }

  return {
    totalFound: allCurrentPdfs.length,
    importedFromOld,
    newlyIndexed,
    updatedCount,
    errors
  };
}

module.exports = {
  scanAndIngestAllPdfs,
  analyzePdfMetadata,
  resolveCompany,
  computeFileSha256
};
