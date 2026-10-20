'use strict'

const { getDatabase } = require('../db/connect')
const { id, now, audit } = require('../db/queries/shared')
const { boundedText } = require('../domain/bounded-text.cjs')

// --- Validation constants ---

const MAX_MESSAGE_BODY = 4000
const E164_PATTERN = /^\+[1-9]\d{1,14}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CHANNEL_TYPES = new Set(['whatsapp', 'telegram', 'email'])
const CONTACT_ROLES = new Set(['owner', 'tax_manager', 'accountant', 'test_recipient'])
const CONSENT_STATUSES = new Set(['explicit_opt_in', 'implied_business', 'opted_out', 'suppressed'])
const VERIFICATION_STATUSES = new Set(['unverified', 'test_verified', 'active'])
const CHANNEL_STATUSES = new Set(['unconfigured', 'connecting', 'qr_ready', 'connected', 'unhealthy', 'paused', 'disabled'])

function isValidE164(value) {
  return typeof value === 'string' && E164_PATTERN.test(value)
}

function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value)
}

function validateMessageBody(body) {
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('message_body is required and must be a non-empty string')
  }
  if (body.length > MAX_MESSAGE_BODY) {
    throw new Error(`message_body exceeds ${MAX_MESSAGE_BODY} character limit`)
  }
  return body
}

// --- Channel status ---

function getChannelStatus(channelId, db = getDatabase()) {
  const row = db.prepare(
    'SELECT id, provider_type, status, draft_only, last_heartbeat_at, last_error FROM channel_registry WHERE id = ?'
  ).get(channelId)
  if (!row) return null
  return {
    id: row.id,
    providerType: row.provider_type,
    status: row.status,
    draftOnly: row.draft_only === 1,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastError: row.last_error
  }
}

// --- Contact registration ---

function registerContact({ companyId, recipient, role = 'accountant', consent = 'unverified' }, db = getDatabase()) {

  if (!companyId || typeof companyId !== 'string') {
    throw new Error('companyId is required')
  }

  const channelType = recipient.startsWith('+') ? 'whatsapp' : 'email'
  if (!CHANNEL_TYPES.has(channelType)) {
    throw new Error('recipient must be a WhatsApp E.164 number or an email address')
  }
  if (!CONTACT_ROLES.has(role)) {
    throw new Error(`Invalid contact_role: ${role}`)
  }
  if (!CONSENT_STATUSES.has(consent)) {
    throw new Error(`Invalid consent_status: ${consent}`)
  }

  if (channelType === 'whatsapp' && !isValidE164(recipient)) {
    throw new Error('recipient must be a valid E.164 phone number (e.g., +201012345678)')
  }
  if (channelType === 'email' && !isValidEmail(recipient)) {
    throw new Error('recipient must be a valid email address')
  }

  // Verify company exists
  const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId)
  if (!company) {
    throw new Error(`Company not found: ${companyId}`)
  }

  const contactId = id('contact')
  const timestamp = now()

  return db.transaction(() => {
    // Upsert by company + channel + recipient
    const existing = db.prepare(
      'SELECT id FROM channel_contacts WHERE company_id = ? AND channel_type = ? AND recipient_address = ?'
    ).get(companyId, channelType, recipient)

    if (existing) {
      db.prepare(
        `UPDATE channel_contacts SET contact_role = ?, consent_status = ?, updated_at = ?
         WHERE id = ?`
      ).run(role, consent, timestamp, existing.id)
      audit(db, {
        actorId: 'system',
        action: 'channel.contact.updated',
        entityType: 'channel_contact',
        entityId: existing.id,
        details: { companyId, channelType, recipientAddress: recipient, role, consent }
      })
      return { id: existing.id, updated: true }
    }

    db.prepare(
      `INSERT INTO channel_contacts(id, company_id, channel_type, recipient_address, contact_role,
         consent_status, verification_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'unverified', ?, ?)`
    ).run(contactId, companyId, channelType, recipient, role, consent, timestamp, timestamp)

    audit(db, {
      actorId: 'system',
      action: 'channel.contact.registered',
      entityType: 'channel_contact',
      entityId: contactId,
      details: { companyId, channelType, recipientAddress: recipient, role, consent }
    })

    return { id: contactId, updated: false }
  })()
}

// --- Draft lifecycle ---

function createDraft({ channelId, contactId, body, caseId, taskId, actorId }, db = getDatabase()) {

  if (!channelId || typeof channelId !== 'string') {
    throw new Error('channelId is required')
  }
  if (!contactId || typeof contactId !== 'string') {
    throw new Error('contactId is required')
  }
  validateMessageBody(body)

  // Verify channel exists
  const channel = db.prepare('SELECT id, draft_only, status FROM channel_registry WHERE id = ?').get(channelId)
  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`)
  }

  // Verify contact exists
  const contact = db.prepare(
    'SELECT id, company_id FROM channel_contacts WHERE id = ?'
  ).get(contactId)
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`)
  }

  let companyId = contact.company_id
  if (taskId) {
    const task = db.prepare('SELECT company_id FROM tasks WHERE id = ?').get(taskId)
    if (task) companyId = task.company_id
  }

  const draftId = id('draft')
  const timestamp = now()

  return db.transaction(() => {
    db.prepare(
      `INSERT INTO communication_drafts(id, channel_id, contact_id, company_id, case_id, task_id,
         message_body, status, approved_by, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?)`
    ).run(draftId, channelId, contactId, companyId, caseId || null, taskId || null, body, timestamp, timestamp)

    audit(db, {
      actorId: actorId || 'system',
      action: 'channel.draft.created',
      entityType: 'communication_draft',
      entityId: draftId,
      details: { channelId, contactId, companyId, caseId, taskId, status: 'draft' }
    })

    return { id: draftId, status: 'draft', createdAt: timestamp }
  })()
}

function approveDraft({ draftId, actorId }, db = getDatabase()) {

  if (!draftId || typeof draftId !== 'string') {
    throw new Error('draftId is required')
  }
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('actorId is required')
  }

  // Verify the approving user exists and is not disabled
  const user = db.prepare('SELECT id, role, disabled FROM users WHERE id = ?').get(actorId)
  if (!user) {
    throw new Error(`Approving user not found: ${actorId}`)
  }
  if (user.disabled) {
    throw new Error(`Approving user is disabled: ${actorId}`)
  }

  const timestamp = now()

  return db.transaction(() => {
    const draft = db.prepare(
      'SELECT id, status, channel_id FROM communication_drafts WHERE id = ?'
    ).get(draftId)
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`)
    }
    if (draft.status !== 'draft' && draft.status !== 'rejected') {
      throw new Error(`Draft cannot be approved from status: ${draft.status}`)
    }

    db.prepare(
      `UPDATE communication_drafts SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(actorId, timestamp, timestamp, draftId)

    audit(db, {
      actorId,
      action: 'channel.draft.approved',
      entityType: 'communication_draft',
      entityId: draftId,
      details: { channelId: draft.channel_id, approvedBy: actorId, approvedAt: timestamp }
    })

    return { id: draftId, status: 'approved', approvedBy: actorId, approvedAt: timestamp }
  })()
}

function rejectDraft({ draftId, actorId, reason }, db = getDatabase()) {

  if (!draftId || typeof draftId !== 'string') {
    throw new Error('draftId is required')
  }
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('actorId is required')
  }

  const timestamp = now()

  return db.transaction(() => {
    const draft = db.prepare('SELECT id, status FROM communication_drafts WHERE id = ?').get(draftId)
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`)
    }
    if (draft.status !== 'approval_pending' && draft.status !== 'approved') {
      throw new Error(`Draft cannot be rejected from status: ${draft.status}`)
    }

    db.prepare(
      `UPDATE communication_drafts SET status = 'rejected', updated_at = ?
       WHERE id = ?`
    ).run(timestamp, draftId)

    audit(db, {
      actorId,
      action: 'channel.draft.rejected',
      entityType: 'communication_draft',
      entityId: draftId,
      details: { reason: reason || null }
    })

    return { id: draftId, status: 'rejected' }
  })()
}

// --- Dispatch ---

/**
 * Dispatch an approved draft through the channel provider.
 * Fail-closed: any precondition failure throws and the draft stays 'approved'.
 * @param {Object} params
 * @param {string} params.draftId - Draft ID to dispatch
 * @param {Function} params.sendFn - Async send function (recipient, text) => Promise<{ messageId?: string }>
 * @param {string} params.actorId - User ID triggering the dispatch
 * @returns {Object} { id, status, sentAt, externalId }
 */
async function dispatchApprovedDraft({ draftId, sendFn, actorId = 'system' }, db = getDatabase()) {

  if (!draftId || typeof draftId !== 'string') {
    throw new Error('draftId is required')
  }
  if (typeof sendFn !== 'function') {
    throw new Error('sendFn is required')
  }

  const timestamp = now()

  // Load draft + contact + channel outside transaction for async send
  const draft = db.prepare(
    `SELECT d.id, d.channel_id, d.contact_id, d.company_id, d.message_body, d.status,
              d.approved_by, d.approved_at,
              c.channel_type, c.recipient_address, c.verification_status
       FROM communication_drafts d
       JOIN channel_contacts c ON c.id = d.contact_id
       WHERE d.id = ?`
  ).get(draftId)

  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`)
  }
  if (draft.status !== 'approved') {
    throw new Error(`Draft is not approved (status: ${draft.status})`)
  }
  if (!draft.approved_by || !draft.approved_at) {
    throw new Error('Draft has no explicit approval record')
  }

  // Check channel health
  const channel = db.prepare(
    'SELECT id, status, draft_only FROM channel_registry WHERE id = ?'
  ).get(draft.channel_id)
  if (!channel) {
    throw new Error(`Channel not found: ${draft.channel_id}`)
  }
  if (channel.status !== 'connected') {
    throw new Error(`Channel is not connected (status: ${channel.status})`)
  }
  if (channel.draft_only === 1) {
    throw new Error('Channel is in draft-only mode; live dispatch is disabled')
  }
  if (draft.verification_status !== 'active' && draft.verification_status !== 'test_verified') {
    throw new Error(`Contact is not verified (status: ${draft.verification_status})`)
  }

  const bounded = boundedText(draft.message_body, MAX_MESSAGE_BODY)

  let externalId
  try {
    const result = await sendFn(draft.recipient_address, bounded)
    externalId = result && result.messageId ? String(result.messageId) : null
  } catch (error) {
    db.prepare(
      `UPDATE communication_drafts SET status = 'failed', updated_at = ?
       WHERE id = ?`
    ).run(timestamp, draftId)
    audit(db, {
      actorId,
      action: 'channel.draft.dispatch_failed',
      entityType: 'communication_draft',
      entityId: draftId,
      details: { error: error.message, channelId: draft.channel_id }
    })
    throw error
  }

  db.prepare(
    `UPDATE communication_drafts SET status = 'dispatched', updated_at = ?
     WHERE id = ?`
  ).run(timestamp, draftId)

  audit(db, {
    actorId,
    action: 'channel.draft.dispatched',
    entityType: 'communication_draft',
    entityId: draftId,
    details: {
      channelId: draft.channel_id,
      contactId: draft.contact_id,
      recipientAddress: draft.recipient_address,
      sentAt: timestamp
    }
  })

  return {
    id: draftId,
    status: 'dispatched',
    sentAt: timestamp,
    externalId
  }
}

module.exports = {
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
}



