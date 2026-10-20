'use strict';

/**
 * PDF Reader for the Tax Visor - opens a stored PDF and extracts page text.
 *
 * Privacy orbit: reads only files inside the allowed root (default: the
 * harness data directory). Fail-safe: bounded pages, bounded characters,
 * explicit PdfReadError taxonomy; never throws on absent/foreign files,
 * it degrades loudly so callers can record a real study failure.
 */

const fs = require('fs');
const path = require('path');

const { localDataRoot } = require('./paths.cjs');

const PDF_MAGIC = Buffer.from('%PDF-');
const MAX_PAGES = 30;
const MAX_TEXT_CHARS = 40000;
const PROMPT_SLICE_CHARS = 12000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

class PdfReadError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PdfReadError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function resolveInsideRoot(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new PdfReadError('invalid-path', 'PDF مسار غير صالح.');
  }
  const resolved = path.resolve(filePath);
  const root = path.resolve(localDataRoot());
  const isWin = process.platform === 'win32';
  const cmpResolved = isWin ? resolved.toLowerCase() : resolved;
  const cmpRoot = isWin ? root.toLowerCase() : root;
  const cmpPrefix = cmpRoot.endsWith(path.sep) ? cmpRoot : cmpRoot + path.sep;
  if (!cmpResolved.startsWith(cmpPrefix) && cmpResolved !== cmpRoot) {
    throw new PdfReadError('outside-allowed-root', 'PDF خارج نطاق الملفات المسموح قراءتها.');
  }
  return resolved;
}

function validatePdfFile(resolved) {
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    throw new PdfReadError('missing-file', 'ملف PDF غير موجود على الجهاز.', err);
  }
  if (!stat.isFile()) throw new PdfReadError('not-a-file', 'المسار ليس ملفًا.');
  if (stat.size === 0) throw new PdfReadError('empty-file', 'ملف PDF فارغ.');
  if (stat.size > MAX_FILE_BYTES) {
    throw new PdfReadError('oversized-file', `ملف PDF يتجاوز الحد المسموح (${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB).`);
  }
  const fd = fs.openSync(resolved, 'r');
  try {
    const header = Buffer.alloc(5);
    fs.readSync(fd, header, 0, 5, 0);
    if (!header.equals(PDF_MAGIC)) {
      throw new PdfReadError('not-a-pdf', 'الملف ليس بصيغة PDF.');
    }
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeArabicText(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a\u202b\u202c\u2066-\u2069\u061c]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sliceForPrompt(text, limit = PROMPT_SLICE_CHARS) {
  const clean = String(text || '');
  if (clean.length <= limit) return { text: clean, truncated: false };
  const cut = clean.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('، '), cut.lastIndexOf('. '), cut.lastIndexOf('؟'));
  const boundary = lastStop > limit * 0.7 ? lastStop : limit;
  return { text: clean.slice(0, boundary), truncated: true };
}

async function extractPdfText(filePath) {
  const resolved = resolveInsideRoot(filePath);
  validatePdfFile(resolved);

  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(resolved)),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0
    }).promise;
  } catch (err) {
    throw new PdfReadError('unreadable-pdf', 'تعذر فتح ملف PDF للقراءة.', err);
  }

  try {
    const pageCount = doc.numPages || 0;
    if (pageCount > MAX_PAGES) {
      throw new PdfReadError('too-many-pages', `ملف PDF يحتوي ${pageCount} صفحة وهو أكبر من الحد المسموح ${MAX_PAGES}.`);
    }
    const parts = [];
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = normalizeArabicText(content.items.map((item) => item.str).join(' '));
      if (pageText) parts.push(pageText);
      if (parts.join('\n\n').length >= MAX_TEXT_CHARS) {
        truncated = true;
        break;
      }
    }
    const text = normalizeArabicText(parts.join('\n\n'));
    if (text.length > MAX_TEXT_CHARS) {
      truncated = true;
    }
    return {
      path: resolved,
      pages: pageCount,
      text,
      truncated,
      slice: sliceForPrompt(text)
    };
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }
}

module.exports = {
  PdfReadError,
  extractPdfText,
  sliceForPrompt,
  normalizeArabicText,
  MAX_PAGES,
  MAX_TEXT_CHARS,
  PROMPT_SLICE_CHARS
};
