'use strict';

// Company folders (v8.2, Owner request): every company in the database gets
// its own folder under data/companies/<اسم الشركة>/ plus its real files copied
// inside (pdfs/, documents/). Additive and idempotent only — nothing is ever
// deleted or renamed by this module. The database stays the authoritative
// record; the folder tree is the human-friendly mirror the Owner asked for.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { localDataRoot } = require('../assistant/paths.cjs');

const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g;

function companyFoldersRoot() {
  if (process.env.V8_COMPANY_FOLDERS_ROOT) return path.resolve(process.env.V8_COMPANY_FOLDERS_ROOT);
  return path.join(localDataRoot(), 'companies');
}

// Windows-safe folder name that preserves Arabic (RTL) letters, digits, and
// spaces: drops the 9 forbidden characters and trailing dots/spaces, capped
// at 64 code points so deep paths stay writable.
function sanitizeFolderName(rawName) {
  const name = String(rawName || '')
    .replace(WINDOWS_FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .slice(0, 64)
    .trim();
  return name || 'شركة-بدون-اسم';
}

function readFolderManifest(folder) {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, 'company.json'), 'utf8'));
  } catch {
    return null;
  }
}

// A folder is reusable only when its manifest declares the same company id.
// Anything else (foreign folder, unreadable manifest) forces a numbered
// alternative so two companies can never share one folder.
function uniqueFolderName(root, base, companyId) {
  let candidate = base;
  let counter = 2;
  for (;;) {
    const manifest = readFolderManifest(path.join(root, candidate));
    if (fs.existsSync(path.join(root, candidate)) && !manifest) {
      candidate = `${base} (${counter})`;
      counter += 1;
      if (counter > 99) return `${base} ${companyId.slice(-8)}`;
      continue;
    }
    if (manifest && manifest.id !== companyId) {
      candidate = `${base} (${counter})`;
      counter += 1;
      if (counter > 99) return `${base} ${companyId.slice(-8)}`;
      continue;
    }
    return candidate;
  }
}

// Creates (idempotently) the folder + subfolders; returns absolute path.
function prepareCompanyFolder(company) {
  if (!company || typeof company.id !== 'string' || !company.id) {
    throw new TypeError('prepareCompanyFolder requires { id, name }');
  }
  const root = companyFoldersRoot();
  fs.mkdirSync(root, { recursive: true });
  const name = uniqueFolderName(root, sanitizeFolderName(company.name), company.id);
  const folder = path.join(root, name);
  fs.mkdirSync(path.join(folder, 'pdfs'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'documents'), { recursive: true });
  return { folder, folderName: name };
}

function writeFolderManifest(folder, company, pdfCount) {
  const manifest = {
    id: company.id,
    name: company.name || '',
    accountKey: company.account_key || company.accountKey || '',
    pdfCount: pdfCount || 0,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(folder, 'company.json'), JSON.stringify(manifest, null, 2) + '\n');
}

// Stable short file name: DOC_<n>.pdf when the task has a portal doc number,
// else a sha1-derived stem. Never trusts the title directly as a filename.
function safeFileStem(task) {
  const doc = String(task.doc_number || '').replace(WINDOWS_FORBIDDEN, '').trim();
  if (doc) return doc;
  return 'مهمة-' + createHash('sha1').update(String(task.id)).digest('hex').slice(0, 16);
}

// The source path is a path this system recorded itself (old or new tree).
// Anything outside a SapAuto workspace is never copied in.
function isOwnDownloadSource(resolvedSource) {
  const lower = resolvedSource.toLowerCase();
  return lower.includes('sapauto');
}

let ownRootLower = null; // captured once per sync run by syncCompanyFolders

// Returns 'copied' | 'exists' | 'missing' | 'refused'
function copyTaskPdfInto(task, folderPath, stats) {
  const source = String(task.pdf_path || '').trim();
  if (!source) return 'missing';
  const src = path.resolve(source);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return 'missing';
  if (ownRootLower !== null && !src.toLowerCase().startsWith(ownRootLower + path.sep) && !isOwnDownloadSource(src)) {
    return 'refused';
  }
  const dest = path.join(folderPath, 'pdfs', `${safeFileStem(task)}.pdf`);
  if (fs.existsSync(dest)) return 'exists';
  fs.copyFileSync(src, dest);
  if (stats) stats.filesCopied += 1;
  return 'copied';
}

/**
 * One folder per company + its real files inside. Idempotent: reruns rewrite
 * manifests and copy only what is missing. Empty/absent pdf_path rows are
 * skipped honestly — nothing is fabricated.
 */
function syncCompanyFolders(db = require('../db/connect').getDatabase()) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('syncCompanyFolders requires a database handle');
  const stats = { companies: 0, filesCopied: 0, filesKept: 0, filesMissing: 0, folders: [] };
  const oldRoot = ownRootLower;
  ownRootLower = path.resolve(localDataRoot()).toLowerCase();
  try {
    const companies = db.prepare('SELECT id, name, account_key FROM companies ORDER BY id').all();
    const taskRows = db.prepare(
      'SELECT id, company_id, doc_number, title, pdf_path FROM tasks ' +
      "WHERE company_id IS NOT NULL AND pdf_path IS NOT NULL AND TRIM(pdf_path) <> ''"
    ).all();;
    const byCompany = new Map();
    for (const row of taskRows) {
      const list = byCompany.get(row.company_id) || [];
      list.push(row);
      byCompany.set(row.company_id, list);
    }
    for (const company of companies) {
      stats.companies += 1;
      const { folder, folderName } = prepareCompanyFolder(company);
      let copied = 0; let kept = 0; let missing = 0;
      for (const row of byCompany.get(company.id) || []) {
        const before = stats.filesCopied;
        const outcome = copyTaskPdfInto(row, folder, stats);
        if (outcome === 'copied') copied += 1;
        else if (outcome === 'exists') kept += 1;
        else if (outcome === 'missing' && String(row.pdf_path || '').trim()) missing += 1;
        else if (outcome === 'refused') missing += 1;
        if (stats.filesCopied !== before) { /* counted inside copyTaskPdfInto */ }
      }
      writeFolderManifest(folder, company, copied + kept);
      stats.folders.push({ company: company.id, folder: folderName, copied, kept, missing });
      stats.filesKept += kept;
      stats.filesMissing += missing;
    }
  } finally {
    ownRootLower = oldRoot;
  }
  return stats;
}

module.exports = {
  companyFoldersRoot,
  sanitizeFolderName,
  uniqueFolderName,
  prepareCompanyFolder,
  writeFolderManifest,
  safeFileStem,
  copyTaskPdfInto,
  syncCompanyFolders
};
