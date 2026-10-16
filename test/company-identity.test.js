'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const identity = require('../domain/company-identity.cjs')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-company-identity-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

test('company identity never treats an account key as a verified display name', () => {
  assert.deepEqual(
    identity.resolveCompanyIdentity({
      id: 'company-1',
      name: 'company-account',
      account_key: 'company-account',
      name_source: 'source'
    }),
    {
      id: 'company-1',
      name: 'اسم غير مسجّل',
      englishName: '',
      taxRegistrationNumber: '',
      known: false,
      origin: '',
      manualName: '',
      portalName: ''
    }
  )
  assert.equal(identity.resolveCompanyIdentity({
    name: 'شركة النور',
    account_key: 'company-account',
    name_source: 'manual'
  }).name, 'شركة النور')
})

test('identity origins separate portal, verified manual, legacy mapping, and conflicting names', () => {
  const portal = identity.resolveCompanyIdentity({
    name: 'portal-key',
    account_key: 'portal-key',
    portal_name: 'شركة النور',
    portal_name_english: 'Al Noor'
  })
  assert.equal(portal.origin, 'portal_verified')
  assert.equal(portal.known, true)
  assert.equal(portal.englishName, 'Al Noor')

  const manual = identity.resolveCompanyIdentity({
    name: 'شركة النور',
    account_key: 'portal-key',
    name_source: 'manual',
    portal_name: 'شركة النور',
    english_name: 'Al Noor'
  })
  assert.equal(manual.origin, 'manual_verified')
  assert.equal(manual.known, true)

  const conflict = identity.resolveCompanyIdentity({
    name: 'شركة الشمس',
    account_key: 'portal-key',
    name_source: 'manual',
    portal_name: 'شركة النور'
  })
  assert.equal(conflict.origin, 'conflict')
  assert.equal(conflict.known, false)
  assert.equal(conflict.manualName, 'شركة الشمس')
  assert.equal(conflict.portalName, 'شركة النور')

  const legacy = identity.resolveCompanyIdentity({
    name: 'شركة قديمة',
    account_key: 'portal-key',
    name_source: 'source'
  })
  assert.equal(legacy.origin, 'unverified_mapping')
  assert.equal(legacy.known, false)
  assert.equal(legacy.name, 'شركة قديمة')
})

test('company identity validates real names and preserves leading zeros in tax numbers', (t) => {
  const db = fixture(t)
  const validated = identity.validateCompanyIdentity({
    name: 'شركة النور',
    englishName: 'Al Noor',
    taxRegistrationNumber: '0012345'
  }, 'acct-1')
  assert.deepEqual(validated.value, {
    name: 'شركة النور',
    englishName: 'Al Noor',
    taxRegistrationNumber: '0012345'
  })
  assert.equal(identity.validateCompanyIdentity({
    name: 'acct-1',
    taxRegistrationNumber: '0012345'
  }, 'acct-1').error, 'أدخل اسم الشركة الحقيقي، لا رقم الحساب أو معرّفه.')

  const insert = db.prepare(`INSERT INTO companies
    (id,name,account_key,tax_registration_number,created_at,updated_at)
    VALUES(?,?,?,?,?,?)`)
  insert.run('company-1', 'شركة النور', 'acct-1', validated.value.taxRegistrationNumber, 'now', 'now')
  insert.run('company-2', 'شركة أخرى', 'acct-2', '', 'now', 'now')
  assert.equal(db.prepare('SELECT tax_registration_number FROM companies WHERE id=?').get('company-1').tax_registration_number, '0012345')
  assert.throws(() => db.prepare(`UPDATE companies SET tax_registration_number=?
    WHERE id=?`).run('0012345', 'company-2'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })
})
