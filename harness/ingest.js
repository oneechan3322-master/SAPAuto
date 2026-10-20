'use strict'

const { getDatabase } = require('../db/connect')
const { audit, id, now } = require('../db/queries/shared')
const identity = require('../domain/company-identity.cjs')

function stable(prefix, value) {
  const { createHash } = require('node:crypto')
  return `${prefix}_${createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`
}

function upsertRows(db, accountKey, companyId, table, rows, keyName, mapRow) {
  const insertSql = {
    tasks: `INSERT INTO tasks(id, company_id, account_key, doc_number, title, deadline, status, urgency,
      required_action, assigned_to, pdf_path, origin, raw_json, created_at, updated_at)
      VALUES(@id,@company_id,@account_key,@doc_number,@title,@deadline,@status,@urgency,
      @required_action,@assigned_to,@pdf_path,@origin,@raw_json,@created_at,@updated_at)
      ON CONFLICT(account_key,doc_number) DO UPDATE SET title=excluded.title, deadline=excluded.deadline,
      status=excluded.status, urgency=excluded.urgency, required_action=excluded.required_action,
      assigned_to=excluded.assigned_to, pdf_path=excluded.pdf_path, raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
    obligations: `INSERT INTO obligations(id,company_id,account_key,obligation_code,period,title,deadline,status,
      penalty_band,evidence,raw_json,created_at,updated_at)
      VALUES(@id,@company_id,@account_key,@obligation_code,@period,@title,@deadline,@status,@penalty_band,
      @evidence,@raw_json,@created_at,@updated_at)
      ON CONFLICT(account_key,obligation_code,period) DO UPDATE SET title=excluded.title,deadline=excluded.deadline,
      status=excluded.status,penalty_band=excluded.penalty_band,raw_json=excluded.raw_json,updated_at=excluded.updated_at`,
payments: `INSERT INTO payments(id,company_id,account_key,claim_number,amount,currency,due_date,status,raw_json,created_at,updated_at,source_observed_at,source_stale)
    VALUES(@id,@company_id,@account_key,@claim_number,@amount,@currency,@due_date,@status,@raw_json,@created_at,@updated_at,@source_observed_at,@source_stale)
    ON CONFLICT(account_key,claim_number) DO UPDATE SET amount=excluded.amount,currency=excluded.currency,
      due_date=excluded.due_date,status=excluded.status,raw_json=excluded.raw_json,
      source_observed_at=excluded.source_observed_at,source_stale=excluded.source_stale,
      updated_at=excluded.updated_at`,
    messages: `INSERT INTO messages(id,company_id,account_key,portal_message_id,title,body,severity,received_at,is_read,raw_json,created_at)
      VALUES(@id,@company_id,@account_key,@portal_message_id,@title,@body,@severity,@received_at,@is_read,@raw_json,@created_at)
      ON CONFLICT(account_key,portal_message_id) DO UPDATE SET title=excluded.title,
      body=CASE WHEN excluded.body<>'' THEN excluded.body ELSE messages.body END,
      severity=excluded.severity,received_at=excluded.received_at,raw_json=excluded.raw_json`
  }[table]
  if (!insertSql) throw new Error(`Unsupported ingest table: ${table}`)
  const statement = db.prepare(insertSql)
  const timestamp = now()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || typeof row !== 'object') continue
    const natural = String(row[keyName] || row.id || row.docNumber || `${table}-${index}`).trim()
    if (!natural) continue
    statement.run(mapRow(row, {
      id: stable(table, `${accountKey}:${natural}:${row.period || ''}`),
      company_id: companyId, account_key: accountKey, created_at: timestamp,
      updated_at: timestamp, raw_json: JSON.stringify(row)
    }))
  }
}

function ingestAccount(result, db = getDatabase()) {
  if (!result || !result.account || !result.account.key) throw new Error('Account scan result is missing its account identity')
  if (result.login.success !== true) throw new Error(`Account ${result.account.key} did not authenticate successfully`)
  const accountKey = result.account.key
  const timestamp = now()
  const companyId = stable('company', accountKey.toLowerCase())
  const portalName = identity.portalCompanyName(result, accountKey)
  const portalNameEnglish = identity.portalCompanyNameEnglish(result)
  const transaction = db.transaction(() => {
    const oldTasks = db.prepare(`SELECT doc_number,title,deadline,status FROM tasks
      WHERE account_key=? AND origin='portal'`).all(accountKey)
    db.prepare(`INSERT INTO companies
      (id,name,account_key,status,last_scanned_at,created_at,updated_at,portal_name,portal_name_english)
      VALUES(?,?,?,'ready',?,?,?,?,?)
      ON CONFLICT(account_key) DO UPDATE SET
      name=CASE WHEN companies.name_source='manual' THEN companies.name
                WHEN excluded.portal_name<>'' THEN excluded.portal_name
                ELSE companies.name END,
      portal_name=excluded.portal_name,
      portal_name_english=CASE WHEN excluded.portal_name_english<>'' THEN excluded.portal_name_english
                ELSE companies.portal_name_english END,
      status='ready',last_scanned_at=excluded.last_scanned_at,updated_at=excluded.updated_at`)
      .run(companyId, portalName || accountKey, accountKey, timestamp, timestamp, timestamp,
        portalName, portalNameEnglish)
    upsertRows(db, accountKey, companyId, 'tasks', result.tasks, 'docNumber', (row, base) => ({
      ...base, doc_number: String(row.docNumber || row.id || ''),
      title: String(row.docTitle || row.title || ''), deadline: String(row.deadline || ''),
      status: row.status === 'closed' || row.status === 'completed' ? 'done' : 'open',
        urgency: String(row.urgency || ''), required_action: String(row.requiredAction || ''),
      assigned_to: String(row.assignedTo || ''), pdf_path: String(row.pdfPath || ''),
      origin: row.portalOrigin === 'user_created' ? 'user_created' : 'portal'
    }))
    upsertRows(db, accountKey, companyId, 'obligations', result.obligations, 'obligationCode', (row, base) => ({
      ...base, obligation_code: String(row.obligationCode || row.code || row.id || ''),
      period: String(row.period || row.periodKey || ''), title: String(row.formLabel || row.title || row.taxLabel || ''),
        deadline: String(row.deadline || row.dueDate || ''), status: String(row.status || ''),
      penalty_band: String(row.penaltyBand || ''), evidence: String(row.evidence || '')
    }))
upsertRows(db, accountKey, companyId, 'payments', result.payments, 'claimNumber', (row, base) => ({
      ...base, claim_number: String(row.claimNumber || row.id || ''),
        amount: row.amount === null || row.amount === undefined || row.amount === ''
          ? null
          : Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
        currency: String(row.currency || ''), due_date: String(row.payBefore || row.dueDate || ''),
        status: String(row.status || ''),
        source_observed_at: String(row.lastSeenAt || row.updatedAt || '') || base.updated_at,
        // The upstream store flags a claim it could no longer read completely.
        // Carrying that flag keeps a stale observation from being counted as a
        // clean overdue payment (plan 2.3 §2 "truth over polish").
        source_stale: row.stale ? 1 : 0
      }))
    upsertRows(db, accountKey, companyId, 'messages', result.messages, 'portalMessageId', (row, base) => ({
      ...base, portal_message_id: String(row.portalMessageId || row.id || ''),
      title: String(row.title || row.subject || row.rawSummary || ''), body: String(row.body || row.message || ''),
        severity: String(row.severity || ''), received_at: row.receivedAt || row.date || null,
      is_read: row.isRead ? 1 : 0
    }))
    const scannedNumbers = new Set(result.tasks.map((task) =>
      String(task.docNumber || task.id || '').trim()
    ).filter(Boolean))
    const currentTasks = db.prepare(`SELECT doc_number,title,deadline,status FROM tasks
      WHERE account_key=? AND origin='portal'`).all(accountKey)
      .filter((task) => scannedNumbers.has(task.doc_number))
    const oldMap = new Map(oldTasks.map((row) => [row.doc_number, JSON.stringify(row)]))
    const currentNumbers = new Set(currentTasks.map((row) => row.doc_number))
    for (const task of currentTasks) {
      const previous = oldMap.get(task.doc_number)
      if (!previous || JSON.parse(previous).status === 'removed') {
        db.prepare(`INSERT INTO events(id,kind,account_key,entity_id,payload,created_at)
          VALUES(?,?,?,?,?,?)`).run(id('event'), 'new_doc', accountKey, task.doc_number, JSON.stringify(task), timestamp)
      } else if (previous !== JSON.stringify(task)) {
        db.prepare(`INSERT INTO events(id,kind,account_key,entity_id,payload,created_at)
          VALUES(?,?,?,?,?,?)`).run(id('event'), 'changed_doc', accountKey, task.doc_number, JSON.stringify(task), timestamp)
      }
    }
    const markRemoved = db.prepare("UPDATE tasks SET status='removed',updated_at=? WHERE account_key=? AND doc_number=?")
    const recordRemoved = db.prepare(`INSERT INTO events(id,kind,account_key,entity_id,payload,created_at)
      VALUES(?,?,?,?,?,?)`)
    for (const task of oldTasks) {
      if (task.status === 'removed' || currentNumbers.has(task.doc_number)) continue
      markRemoved.run(timestamp, accountKey, task.doc_number)
      recordRemoved.run(id('event'), 'removed_doc', accountKey, task.doc_number, JSON.stringify(task), timestamp)
    }
    db.prepare(`INSERT INTO account_status(account_key,state,consecutive_failures,last_success_at,updated_at)
      VALUES(?,'ready',0,?,?) ON CONFLICT(account_key) DO UPDATE SET state='ready',
      consecutive_failures=0,last_success_at=excluded.last_success_at,last_error='',updated_at=excluded.updated_at`)
      .run(accountKey, timestamp, timestamp)
    audit(db, { action: 'account.scan.completed', entityType: 'company', entityId: companyId, details: { accountKey, portalNameCaptured: Boolean(portalName) } })
  })
  transaction()
  try {
    const { syncPortalDocumentsToArchive, syncPortalTaskPdfsToArchive } = require('../domain/documents-archive.cjs')
    syncPortalDocumentsToArchive(db)
    syncPortalTaskPdfsToArchive(db)
  } catch (err) {
    console.warn(`[ingestAccount] Archive sync failed for ${accountKey}: ${err.message}`)
  }
  triggerLiveAiStudy(accountKey, db)
}

function triggerLiveAiStudy(accountKey, db = getDatabase(), limit = 3) {
  if (!accountKey || typeof accountKey !== 'string') return
  setImmediate(async () => {
    try {
      const { LiveAiAnalyst } = require('../assistant/live-analyst')
      const analyst = new LiveAiAnalyst({ db })
      await analyst.studyNewAccountEntities(accountKey, limit)
    } catch (err) {
      try {
        const { defaultLogger } = require('./scraper/common/logger')
        defaultLogger.warn(`[triggerLiveAiStudy] Background AI study failed for ${accountKey}: ${err.message}`)
      } catch {
        console.warn(`[triggerLiveAiStudy] Background AI study failed for ${accountKey}: ${err.message}`)
      }
    }
  })
}

module.exports = { ingestAccount, stable, triggerLiveAiStudy }
