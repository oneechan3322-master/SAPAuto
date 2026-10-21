'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const {
  getChannelStatus,
  registerContact,
  createDraft,
  approveDraft,
  rejectDraft,
  dispatchApprovedDraft,
  isValidE164,
  isValidEmail,
  validateMessageBody,
  MAX_MESSAGE_BODY
} = require('../domain/channel-broker.cjs')

function setupDb(directory) {
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  const ts = new Date().toISOString()
  db.prepare(`INSERT INTO companies(id, name, account_key, external_ref, status, created_at, updated_at)
    VALUES ('company-1', 'شركة اختبار', 'acc-1', 'ext-1', 'active', ?, ?)`).run(ts, ts)
  db.prepare(`INSERT INTO users(id, name, email, emailVerified, createdAt, updatedAt, role, disabled)
    VALUES ('user-owner', 'Owner', 'owner@example.test', 1, ?, ?, 'Owner', 0)`).run(ts, ts)
  db.prepare(`INSERT INTO users(id, name, email, emailVerified, createdAt, updatedAt, role, disabled)
    VALUES ('user-viewer', 'Viewer', 'viewer@example.test', 1, ?, ?, 'Viewer', 0)`).run(ts, ts)
  db.prepare(`INSERT INTO users(id, name, email, emailVerified, createdAt, updatedAt, role, disabled)
    VALUES ('user-disabled', 'Disabled', 'disabled@example.test', 1, ?, ?, 'Owner', 1)`).run(ts, ts)
  return db
}

test('slice 4.1: E.164 phone validation', () => {
  assert.equal(isValidE164('+201012345678'), true)
  assert.equal(isValidE164('+14155552671'), true)
  assert.equal(isValidE164('201012345678'), false)
  assert.equal(isValidE164('+00123'), false)
  assert.equal(isValidE164(''), false)
  assert.equal(isValidE164(null), false)
})

test('slice 4.1: email validation', () => {
  assert.equal(isValidEmail('owner@example.test'), true)
  assert.equal(isValidEmail('not-an-email'), false)
  assert.equal(isValidEmail(''), false)
  assert.equal(isValidEmail(null), false)
})

test('slice 4.1: message body validation', () => {
  assert.equal(validateMessageBody('hello'), 'hello')
  const longBody = 'a'.repeat(MAX_MESSAGE_BODY + 1)
  assert.throws(() => validateMessageBody(longBody), /exceeds/)
  assert.throws(() => validateMessageBody(''), /required/)
  assert.throws(() => validateMessageBody(null), /required/)
})

test('slice 4.1: registerContact validates and creates contact', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-contact-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const result = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)
  assert.equal(result.updated, false)
  assert.equal(typeof result.id, 'string')
  assert.equal(result.id.startsWith('contact_'), true)

  const result2 = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'tax_manager',
    consent: 'implied_business'
  }, db)
  assert.equal(result2.updated, true)
  assert.equal(result2.id, result.id)

  assert.throws(() => registerContact({
    companyId: 'company-1',
    recipient: 'not-a-phone',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db), /email/)

  assert.throws(() => registerContact({
    companyId: 'company-1',
    recipient: '+00',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db), /E.164/)

  assert.throws(() => registerContact({
    companyId: 'company-1',
    recipient: 'not-an-email',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db), /email/)

  assert.throws(() => registerContact({
    companyId: 'nonexistent',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db), /Company not found/)

  assert.throws(() => registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'invalid_role',
    consent: 'explicit_opt_in'
  }, db), /contact_role/)
})

test('slice 4.1: getChannelStatus returns registry state', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-status-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const status = getChannelStatus('whatsapp-office-primary', db)
  assert.equal(status.id, 'whatsapp-office-primary')
  assert.equal(status.providerType, 'whatsapp_web')
  assert.equal(status.status, 'unconfigured')
  assert.equal(status.draftOnly, true)

  // Must pass the test database explicitly: the default singleton would open
  // the real data/sapauto.db from a test process.
  assert.equal(getChannelStatus('nonexistent', db), null)
})

test('slice 4.1: createDraft requires channel and contact', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-draft-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const contact = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)

  const draft = createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'Test payroll reminder',
    actorId: 'user-owner'
  }, db)
  assert.equal(draft.status, 'draft')
  assert.equal(typeof draft.id, 'string')
  assert.equal(draft.id.startsWith('draft_'), true)

  assert.throws(() => createDraft({
    channelId: '',
    contactId: contact.id,
    body: 'hello',
    actorId: 'user-owner'
  }, db), /channelId is required/)

  assert.throws(() => createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: '',
    body: 'hello',
    actorId: 'user-owner'
  }, db), /contactId is required/)

  assert.throws(() => createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: '',
    actorId: 'user-owner'
  }, db), /required/)

  assert.throws(() => createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'a'.repeat(MAX_MESSAGE_BODY + 1),
    actorId: 'user-owner'
  }, db), /exceeds/)

  assert.throws(() => createDraft({
    channelId: 'nonexistent',
    contactId: contact.id,
    body: 'hello',
    actorId: 'user-owner'
  }, db), /Channel not found/)

  assert.throws(() => createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: 'nonexistent',
    body: 'hello',
    actorId: 'user-owner'
  }, db), /Contact not found/)
})

test('slice 4.1: approveDraft requires valid actor and draft state', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-approve-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const contact = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)
  const draft = createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'Test payroll reminder',
    actorId: 'user-owner'
  }, db)

  const approved = approveDraft({ draftId: draft.id, actorId: 'user-owner' }, db)
  assert.equal(approved.status, 'approved')
  assert.equal(approved.approvedBy, 'user-owner')
  assert.equal(typeof approved.approvedAt, 'string')

  assert.throws(() => approveDraft({ draftId: draft.id, actorId: 'user-owner' }, db), /cannot be approved/)
  assert.throws(() => approveDraft({ draftId: draft.id, actorId: 'nonexistent' }, db), /not found/)
  assert.throws(() => approveDraft({ draftId: draft.id, actorId: 'user-disabled' }, db), /disabled/)
  assert.throws(() => approveDraft({ draftId: 'draft-nonexistent', actorId: 'user-owner' }, db), /Draft not found/)
})

test('slice 4.1: dispatchApprovedDraft fails without approval', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-dispatch-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const contact = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)
  const draft = createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'Test payroll reminder',
    actorId: 'user-owner'
  }, db)

  let threw = false
  try {
    await dispatchApprovedDraft({
      draftId: draft.id,
      sendFn: async () => ({ messageId: 'msg-1' }),
      actorId: 'user-owner'
    }, db)
  } catch (error) {
    threw = true
    assert.equal(error.message.includes('not approved'), true)
  }
  assert.equal(threw, true, 'Expected dispatch to fail for unapproved draft')

  const row = db.prepare('SELECT status FROM communication_drafts WHERE id = ?').get(draft.id)
  assert.equal(row.status, 'draft')
})

test('slice 4.1: dispatchApprovedDraft fails closed for unconfigured channel', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-failclosed-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const contact = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)
  const draft = createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'Test payroll reminder',
    actorId: 'user-owner'
  }, db)
  await approveDraft({ draftId: draft.id, actorId: 'user-owner' }, db)

  let threw = false
  try {
    await dispatchApprovedDraft({
      draftId: draft.id,
      sendFn: async () => ({ messageId: 'msg-1' }),
      actorId: 'user-owner'
    }, db)
  } catch (error) {
    threw = true
  }
  assert.equal(threw, true)

  const row = db.prepare('SELECT status FROM communication_drafts WHERE id = ?').get(draft.id)
  assert.equal(row.status, 'approved')
})

test('slice 4.1: dispatchApprovedDraft succeeds when channel connected and draft_only off', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-success-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const contact = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)
  db.prepare(`UPDATE channel_contacts SET verification_status = 'test_verified' WHERE id = ?`).run(contact.id)

  const draft = createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'Test payroll reminder',
    actorId: 'user-owner'
  }, db)
  await approveDraft({ draftId: draft.id, actorId: 'user-owner' }, db)

  db.prepare(`UPDATE channel_registry SET status = 'connected', draft_only = 0 WHERE id = 'whatsapp-office-primary'`).run()

  let sentTo = null
  let sentText = null
  const result = await dispatchApprovedDraft({
    draftId: draft.id,
    sendFn: async (to, text) => {
      sentTo = to
      sentText = text
      return { messageId: 'msg-abc-123' }
    },
    actorId: 'user-owner'
  }, db)
  assert.equal(result.status, 'dispatched')
  assert.equal(result.externalId, 'msg-abc-123')
  assert.equal(sentTo, '+201012345678')
  assert.equal(sentText, 'Test payroll reminder')

  const row = db.prepare('SELECT status FROM communication_drafts WHERE id = ?').get(draft.id)
  assert.equal(row.status, 'dispatched')
})

test('slice 4.1: dispatchApprovedDraft sends fn failure marks draft failed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-fail-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const contact = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)
  db.prepare(`UPDATE channel_contacts SET verification_status = 'test_verified' WHERE id = ?`).run(contact.id)

  const draft = createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'Test payroll reminder',
    actorId: 'user-owner'
  }, db)
  await approveDraft({ draftId: draft.id, actorId: 'user-owner' }, db)
  db.prepare(`UPDATE channel_registry SET status = 'connected', draft_only = 0 WHERE id = 'whatsapp-office-primary'`).run()

  let threw = false
  try {
    await dispatchApprovedDraft({
      draftId: draft.id,
      sendFn: async () => { throw new Error('Network error') },
      actorId: 'user-owner'
    }, db)
  } catch (error) {
    threw = true
    assert.equal(error.message, 'Network error')
  }
  assert.equal(threw, true)

  const row = db.prepare('SELECT status FROM communication_drafts WHERE id = ?').get(draft.id)
  assert.equal(row.status, 'failed')
})

test('slice 4.1: rejectDraft transitions approved draft to rejected', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-slice4-1-reject-'))
  const db = setupDb(directory)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

  const contact = registerContact({
    companyId: 'company-1',
    recipient: '+201012345678',
    role: 'accountant',
    consent: 'explicit_opt_in'
  }, db)
  const draft = createDraft({
    channelId: 'whatsapp-office-primary',
    contactId: contact.id,
    body: 'Test payroll reminder',
    actorId: 'user-owner'
  }, db)
  await approveDraft({ draftId: draft.id, actorId: 'user-owner' }, db)

  const rejected = rejectDraft({ draftId: draft.id, actorId: 'user-owner', reason: 'Wrong recipient' }, db)
  assert.equal(rejected.status, 'rejected')

  const row = db.prepare('SELECT status FROM communication_drafts WHERE id = ?').get(draft.id)
  assert.equal(row.status, 'rejected')
})
