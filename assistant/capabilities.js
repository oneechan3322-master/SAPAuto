'use strict'

const { getDatabase } = require('../db/connect')
const { audit, id, now } = require('../db/queries/shared')
const capabilities = require('../domain/ai-capabilities.cjs')

const CLOUD_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'
const PROBE_TIMEOUT_MS = 8000

function rows(db = getDatabase()) {
  return db.prepare('SELECT * FROM ai_provider_state').all()
}

function row(capability, db = getDatabase()) {
  if (!capabilities.CAPABILITY_IDS.includes(capability)) {
    throw new Error(`Unsupported capability: ${capability}`)
  }
  return db.prepare('SELECT * FROM ai_provider_state WHERE capability=?').get(capability)
}

function isOpenCodeConfigured() {
  try {
    return require('./code-proposals.js').isOpenCodeConfigured()
  } catch {
    return false
  }
}

/** Facts only — never a key, a path, or a raw command line. */
function inputs(db = getDatabase()) {
  const store = rows(db)
  const byId = Object.fromEntries(store.map((entry) => [entry.capability, entry]))
  const pendingProposals = db
    .prepare("SELECT COUNT(*) AS n FROM code_upgrade_proposals WHERE status='pending'")
    .get().n
  return {
    local_assistant: {
      configured: true,
      paused: Boolean(byId.local_assistant?.paused),
      health: byId.local_assistant?.health || 'unknown',
      lastSuccessAt: byId.local_assistant?.last_success_at || null
    },
    cloud_reviewer: {
      configured: Boolean(process.env.MISTRAL_API_KEY),
      paused: Boolean(byId.cloud_reviewer?.paused),
      health: byId.cloud_reviewer?.health || 'unknown',
      lastSuccessAt: byId.cloud_reviewer?.last_success_at || null
    },
    system_adviser: {
      configured: isOpenCodeConfigured(),
      paused: Boolean(byId.system_adviser?.paused),
      health: byId.system_adviser?.health || 'unknown',
      lastSuccessAt: byId.system_adviser?.last_success_at || null,
      pendingCount: pendingProposals
    }
  }
}

/** Read-only readiness payload (plan 2.0 §12.1). */
function readiness(db = getDatabase()) {
  return capabilities.capabilityReport(inputs(db))
}

function setPaused(capability, paused, { actorId = 'system', reason = '', db = getDatabase() } = {}) {
  if (!capabilities.CAPABILITY_IDS.includes(capability)) {
    throw new Error(`Unsupported capability: ${capability}`)
  }
  const timestamp = now()
  return db.transaction(() => {
    const result = db.prepare(`UPDATE ai_provider_state SET paused=?,updated_at=? WHERE capability=?`)
      .run(paused ? 1 : 0, timestamp, capability)
    if (!result.changes) throw new Error('Capability state was not found')
    const eventId = id('policy')
    db.prepare(`INSERT INTO ai_policy_event(id,capability,action,actor_id,detail,at)
      VALUES(?,?,?,?,?,?)`)
      .run(eventId, capability, paused ? 'pause' : 'resume', actorId,
        JSON.stringify({ reason: String(reason || '').slice(0, 200) }), timestamp)
    audit(db, {
      actorId,
      action: `ai.capability.${paused ? 'paused' : 'resumed'}`,
      entityType: 'ai_capability',
      entityId: capability,
      details: { policyVersion: capabilities.REDACTION_POLICY_VERSION, reason: String(reason || '').slice(0, 200) }
    })
    return { capability, paused: Boolean(paused), eventId }
  }).immediate()
}

function recordProbe(capability, { health, errorCode = '', db = getDatabase(), actorId = 'system' } = {}) {
  const timestamp = now()
  db.transaction(() => {
    db.prepare(`UPDATE ai_provider_state SET health=?,last_success_at=?,last_error_code=?,updated_at=?
      WHERE capability=?`)
      .run(health, health === 'healthy' ? timestamp : null, String(errorCode).slice(0, 80), timestamp, capability)
    db.prepare(`INSERT INTO ai_policy_event(id,capability,action,actor_id,detail,at)
      VALUES(?,?,'probe',?,?,?)`)
      .run(id('policy'), capability, actorId, JSON.stringify({ health, errorCode }), timestamp)
  })()
  return readiness(db)
}

/**
 * Synthetic health probe (plan 2.0 §11 / §3.2B). Each probe uses fixed
 * non-sensitive text; no stored record, company name, payment, document, or
 * portal content is ever sent. The local lane is loopback-only by
 * construction; the cloud lane sends nothing without a configured key and
 * records no payload.
 */
async function probe(capability, db = getDatabase(), actorId = 'system') {
  if (!capabilities.CAPABILITY_IDS.includes(capability)) {
    throw new Error(`Unsupported capability: ${capability}`)
  }
  const current = row(capability, db)

  if (capability === 'local_assistant') {
    if (current.paused) return { capability, health: current.health, skipped: 'paused', report: readiness(db) }
    try {
      const { localNovaUrl } = require('./model')
      const base = localNovaUrl().replace(/\/v1\/chat\/completions$/, '')
      const headers = { accept: 'application/json' }
      if (process.env.V8_LOCAL_AI_TOKEN) headers.authorization = `Bearer ${process.env.V8_LOCAL_AI_TOKEN}`
      const response = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: 'error' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const model = Array.isArray(payload?.data) && typeof payload.data[0]?.id === 'string'
        ? payload.data[0].id.slice(0, 60) : 'gemma4-local'
      db.prepare('UPDATE ai_provider_state SET model_label=? WHERE capability=?').run(model, capability)
      const report = recordProbe(capability, { health: 'healthy', db, actorId })
      return { capability, health: 'healthy', model, report }
    } catch (error) {
      const code = /loopback/i.test(String(error.message)) ? 'AI_POLICY_BLOCKED' : 'LOCAL_ASSISTANT_UNAVAILABLE'
      const report = recordProbe(capability, { health: 'unreachable', errorCode: code, db, actorId })
      return { capability, health: 'unreachable', errorCode: code, message: capabilities.ERROR_VOCABULARY[code], report }
    }
  }

  if (capability === 'cloud_reviewer') {
    if (current.paused) return { capability, health: current.health, skipped: 'paused', report: readiness(db) }
    if (!process.env.MISTRAL_API_KEY) {
      const report = recordProbe(capability, { health: 'unknown', errorCode: 'CLOUD_REVIEW_NOT_CONFIGURED', db, actorId })
      return {
        capability,
        health: 'unknown',
        errorCode: 'CLOUD_REVIEW_NOT_CONFIGURED',
        message: capabilities.ERROR_VOCABULARY.CLOUD_REVIEW_NOT_CONFIGURED,
        report
      }
    }
    try {
      const response = await fetch(CLOUD_ENDPOINT, {
        method: 'POST',
        headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'mistral-tiny', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        redirect: 'error'
      })
      // Any answer proves reachability; the key is never sent and never logged.
      const reachable = response.status < 500 && response.status !== 404
      const report = recordProbe(capability, { health: reachable ? 'healthy' : 'unreachable', db, actorId })
      return {
        capability,
        health: reachable ? 'healthy' : 'unreachable',
        message: reachable
          ? 'الخدمة تستجيب. لم يُرسل أي محتوى من SAPAuto.'
          : capabilities.ERROR_VOCABULARY.CLOUD_REVIEW_NOT_CONFIGURED,
        report
      }
    } catch (error) {
      const report = recordProbe(capability, { health: 'unreachable', errorCode: 'CLOUD_REVIEW_NOT_CONFIGURED', db, actorId })
      return {
        capability,
        health: 'unreachable',
        message: capabilities.ERROR_VOCABULARY.CLOUD_REVIEW_NOT_CONFIGURED,
        report
      }
    }
  }

  // The engineering adviser never makes a network call as part of a probe.
  const configured = isOpenCodeConfigured()
  const report = recordProbe(capability, { health: configured ? 'healthy' : 'unknown', db, actorId })
  return {
    capability,
    health: configured ? 'healthy' : 'unknown',
    skipped: 'no_network_call',
    errorCode: configured ? '' : 'OPENCODE_NOT_CONFIGURED',
    message: configured ? 'المستشار مهيأ. فحص الحالة محلي بالكامل ولم يُجرَ أي اتصال شبكي.' : capabilities.ERROR_VOCABULARY.OPENCODE_NOT_CONFIGURED,
    report
  }
}

function listPolicyEvents(limit = 50, db = getDatabase()) {
  return db.prepare('SELECT id,capability,action,actor_id,detail,at FROM ai_policy_event ORDER BY at DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 50, 1), 200))
}

module.exports = {
  capabilityInputs: inputs,
  isPaused: (capability, db) => Boolean(row(capability, db).paused),
  listPolicyEvents,
  probe,
  readiness,
  recordProbe,
  setPaused
}