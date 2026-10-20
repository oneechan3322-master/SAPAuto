'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../db/migrate.js');
const {
  STANDARD_DOCUMENT_TYPES,
  evaluateDocumentStatus,
  syncPortalDocumentsToArchive
} = require('../domain/documents-archive.cjs');

test('documents-archive: standard document types definition', () => {
  assert.ok(STANDARD_DOCUMENT_TYPES.tax_card);
  assert.equal(STANDARD_DOCUMENT_TYPES.tax_card.arabicName, 'البطاقة الضريبية');
  assert.equal(STANDARD_DOCUMENT_TYPES.tax_card.defaultRole, 'المحاسب القانوني للملف');

  assert.ok(STANDARD_DOCUMENT_TYPES.commercial_registry);
  assert.equal(STANDARD_DOCUMENT_TYPES.commercial_registry.arabicName, 'السجل التجاري');

  assert.ok(STANDARD_DOCUMENT_TYPES.vat_certificate);
  assert.equal(STANDARD_DOCUMENT_TYPES.vat_certificate.arabicName, 'شهادة تسجيل الضريبة على القيمة المضافة');

  assert.ok(STANDARD_DOCUMENT_TYPES.national_id);
  assert.ok(STANDARD_DOCUMENT_TYPES.e_signature);
});

test('documents-archive: evaluateDocumentStatus date handling', () => {
  const fixedNow = new Date('2026-10-17T12:00:00Z');

  // No date
  const noDate = evaluateDocumentStatus('', fixedNow);
  assert.equal(noDate.status, 'no_date');
  assert.equal(noDate.tone, 'neutral');

  // Expired
  const expired = evaluateDocumentStatus('2026-10-01', fixedNow);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.tone, 'urgent');
  assert.ok(expired.daysLeft < 0);

  // Expiring soon (< 60 days)
  const expiringSoon = evaluateDocumentStatus('2026-11-15', fixedNow);
  assert.equal(expiringSoon.status, 'expiring_soon');
  assert.equal(expiringSoon.tone, 'attention');
  assert.ok(expiringSoon.daysLeft > 0 && expiringSoon.daysLeft <= 60);

  // Valid (> 60 days)
  const valid = evaluateDocumentStatus('2028-01-02', fixedNow);
  assert.equal(valid.status, 'valid');
  assert.equal(valid.tone, 'calm');
  assert.ok(valid.daysLeft > 60);
});

test('documents-archive: syncPortalDocumentsToArchive populates from DB', () => {
  const testDb = new Database(':memory:');
  runMigrations(testDb, path.join(__dirname, '..', 'db', 'migrations'));

  const nowIso = new Date().toISOString();

  // Insert test company
  testDb.prepare(`
    INSERT INTO companies (id, account_key, name, status, created_at, updated_at)
    VALUES ('comp_1', 'acct_1', 'شركة الاختبار للتجارة', 'ready', ?, ?)
  `).run(nowIso, nowIso);

  // Insert portal obligation with tax card validity
  testDb.prepare(`
    INSERT INTO obligations (id, company_id, account_key, title, obligation_code, deadline, status, created_at, updated_at)
    VALUES ('obl_1', 'comp_1', 'acct_1', 'البطاقة الضريبية سارية حتى تاريخ', 'code_1', '2028-01-02', 'open', ?, ?)
  `).run(nowIso, nowIso);

  const syncRes = syncPortalDocumentsToArchive(testDb);
  assert.equal(syncRes.synced, 1);
  assert.ok(syncRes.created >= 1);

  const docs = testDb.prepare('SELECT * FROM company_documents WHERE company_id = ?').all('comp_1');
  assert.equal(docs.length, 5); // 5 standard types

  const taxCard = docs.find((d) => d.doc_type === 'tax_card');
  assert.ok(taxCard);
  assert.equal(taxCard.expiry_date, '2028-01-02');
  assert.equal(taxCard.source, 'portal_sync');

  testDb.close();
});
