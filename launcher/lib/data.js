import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.js'
import identity from '../../domain/company-identity.cjs'
import legalDeadlines from '../../domain/legal-deadlines.cjs'
import taxClassifier from '../../domain/tax-classifier.cjs'
import secretaryRules from '../../domain/secretary-rules.cjs'
import documentsArchive from '../../domain/documents-archive.cjs'

const { classifyTaxObligation } = taxClassifier
const { matchSecretaryRule, parseSecretaryMemo } = secretaryRules
const { STANDARD_DOCUMENT_TYPES, evaluateDocumentStatus, syncPortalDocumentsToArchive, syncPortalTaskPdfsToArchive } = documentsArchive

/** Attaches the Plan 4.5 countdown to obligations that carry a legal stamp. */
function attachLegalDeadlineDays(row, now = new Date()) {
  if (!row.respond_by) return row
  const days = legalDeadlines.daysBetweenCairo(now, row.respond_by)
  if (days === null) return row
  row.days_left = days
  row.deadline_tone = legalDeadlines.deadlineTone(days)
  return row
}

/** A period is source data, never a JavaScript object rendered to the accountant. */
function displayPeriod(value, from = '', to = '') {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    for (const key of ['label', 'name', 'period', 'value', 'fromTo']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
    }
    const start = typeof value.from === 'string' ? value.from : from
    const end = typeof value.to === 'string' ? value.to : to
    if (start || end) return [start, end].filter(Boolean).join(' — ')
  }
  return [from, to].filter(Boolean).join(' — ')
}

/** Enriches task records with executive secretary rules, deadlines, and memo parsing. */
function enrichTaskRecord(row, now = new Date()) {
  const rule = matchSecretaryRule(row.title || row.doc_number || '')
  if (row.deadline) {
    const days = legalDeadlines.daysBetweenCairo(now, row.deadline)
    if (days !== null) {
      row.days_left = days
      row.deadline_tone = legalDeadlines.deadlineTone(days)
    }
  }
  row.required_action = row.required_action || rule.requiredAction
  row.assigned_to = row.assigned_to || rule.assignedRole
  row.portal_url = row.portal_url || rule.portalUrl
  row.secretary_memo = parseSecretaryMemo(row.ai_study)
  if (!row.secretary_memo.requiredDoc) {
    row.secretary_memo = {
      requiredDoc: rule.docName,
      legalDeadline: `${rule.deadlineDays} يوماً — ${rule.basis}`,
      executiveAction: rule.requiredAction,
      assignedRole: rule.assignedRole
    }
  }
  return row
}

/** Statuses the source still counts as open, matching the record list rules. */
const ACTIVE_STATUS_SQL = `LOWER(CASE WHEN json_valid(o.raw_json) AND json_type(o.raw_json,'$.status') IS NULL
        THEN '' ELSE COALESCE(o.status,'') END)
        IN ('open','pending','in_progress','in progress','مفتوح','قيد المتابعة','غير مكتمل')`

/** Cairo calendar day, so "this week" matches what the user sees elsewhere. */
function cairoDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date)
}

const COMPANY_SUMMARY_SQL = `,
    (SELECT COUNT(*) FROM obligations o WHERE o.company_id=c.id AND ${ACTIVE_STATUS_SQL}
      AND substr(o.deadline,1,10) < @today) overdue_obligations,
    (SELECT COUNT(*) FROM obligations o WHERE o.company_id=c.id AND ${ACTIVE_STATUS_SQL}
      AND substr(o.deadline,1,10) BETWEEN @today AND @week) due_this_week_obligations,
    (SELECT COUNT(*) FROM payments p WHERE p.company_id=c.id
      AND substr(p.due_date,1,10) < @today
      AND LOWER(CASE WHEN json_valid(p.raw_json) AND json_type(p.raw_json,'$.status') IS NULL
        THEN '' ELSE COALESCE(p.status,'') END) NOT IN
        ('paid','done','complete','completed','resolved','settled','closed','تم السداد','مدفوع','مسدد بالكامل')) overdue_payments,
    (SELECT MIN(o.deadline) FROM obligations o WHERE o.company_id=c.id AND ${ACTIVE_STATUS_SQL}
      AND NULLIF(substr(o.deadline,1,10),'') >= @today) next_obligation_deadline,
    (SELECT MIN(p.due_date) FROM payments p WHERE p.company_id=c.id
      AND NULLIF(substr(p.due_date,1,10),'') >= @today
      AND LOWER(CASE WHEN json_valid(p.raw_json) AND json_type(p.raw_json,'$.status') IS NULL
        THEN '' ELSE COALESCE(p.status,'') END) NOT IN
        ('paid','done','complete','completed','resolved','settled','closed','تم السداد','مدفوع','مسدد بالكامل')) next_payment_due_date`

const queries = {
  companies: `SELECT c.id,c.name,c.account_key,c.name_source,c.english_name,c.portal_name,
    c.portal_name_english,
    c.tax_registration_number,c.status,c.last_scanned_at,
    a.state AS last_scan_state,
    (SELECT COUNT(*) FROM obligations o WHERE o.company_id=c.id
      AND ${ACTIVE_STATUS_SQL}) open_obligations,
    (SELECT COUNT(*) FROM obligations o WHERE o.company_id=c.id
      AND LOWER(CASE WHEN json_valid(o.raw_json) AND json_type(o.raw_json,'$.status') IS NULL
        THEN '' ELSE COALESCE(o.status,'') END) NOT IN
        ('open','pending','in_progress','in progress','مفتوح','قيد المتابعة','غير مكتمل',
        'done','complete','completed','resolved','submitted','closed','مكتمل','تم التقديم')) unknown_obligations
    ${COMPANY_SUMMARY_SQL}
    FROM companies c LEFT JOIN account_status a ON a.account_key=c.account_key ORDER BY c.name`,
  tasks: `SELECT t.*,c.account_key AS company_account_key,c.name AS company_name,
      c.tax_registration_number AS company_tax_registration_number,c.name_source AS company_name_source,
      c.english_name AS company_english_name,c.portal_name AS company_portal_name,
      c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,
      a.state AS last_scan_state
    FROM tasks t JOIN companies c ON c.id=t.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key ORDER BY t.deadline LIMIT 1000`,
  obligations: `SELECT o.*,CASE WHEN json_valid(o.raw_json) AND json_type(o.raw_json,'$.status') IS NULL
      THEN '' ELSE o.status END AS source_status,c.account_key AS company_account_key,c.name AS company_name,
      c.tax_registration_number AS company_tax_registration_number,
      c.name_source AS company_name_source,c.english_name AS company_english_name,
      c.portal_name AS company_portal_name,c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,a.state AS last_scan_state,
      CASE WHEN json_valid(o.raw_json) THEN COALESCE(json_extract(o.raw_json,'$.deadlineBasis'),'') ELSE '' END AS deadline_basis
    FROM obligations o JOIN companies c ON c.id=o.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key
    ORDER BY CASE WHEN NULLIF(TRIM(o.deadline),'') IS NULL THEN 1 ELSE 0 END, o.deadline LIMIT 1000`,
  payments: `SELECT p.*,CASE WHEN json_valid(p.raw_json) AND json_type(p.raw_json,'$.status') IS NULL
      THEN '' ELSE p.status END AS source_status,c.account_key AS company_account_key,c.name AS company_name,
      c.tax_registration_number AS company_tax_registration_number,
      c.name_source AS company_name_source,c.english_name AS company_english_name,
      c.portal_name AS company_portal_name,c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,a.state AS last_scan_state
    FROM payments p JOIN companies c ON c.id=p.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key ORDER BY p.due_date LIMIT 1000`,
  messages: `SELECT m.id,m.company_id,m.ai_study,m.ai_action_required,m.ai_studied_at,
    COALESCE(NULLIF(m.title,''),CASE WHEN json_valid(m.raw_json) THEN
      COALESCE(NULLIF(json_extract(m.raw_json,'$.subject'),''),NULLIF(json_extract(m.raw_json,'$.rawSummary'),''),NULLIF(json_extract(m.raw_json,'$.message'),''),'')
      ELSE '' END) AS title,
    COALESCE(NULLIF(m.body,''),CASE WHEN json_valid(m.raw_json) THEN
      COALESCE(NULLIF(json_extract(m.raw_json,'$.body'),''),NULLIF(json_extract(m.raw_json,'$.message'),''),'')
      ELSE '' END) AS body,
    CASE WHEN json_valid(m.raw_json) AND json_type(m.raw_json,'$.severity') IS NULL
      THEN '' ELSE m.severity END AS severity,
    COALESCE(m.received_at,CASE WHEN json_valid(m.raw_json) THEN json_extract(m.raw_json,'$.scrapedAt') END,m.created_at) AS observed_at,
    m.is_read,c.name AS company_name,c.account_key AS company_account_key,
    c.tax_registration_number AS company_tax_registration_number,
    c.name_source AS company_name_source,c.english_name AS company_english_name,
    c.portal_name AS company_portal_name,c.portal_name_english AS company_portal_name_english,
    c.last_scanned_at AS company_last_synced_at,
    a.state AS last_scan_state
    FROM messages m JOIN companies c ON c.id=m.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key
    ORDER BY observed_at DESC LIMIT 1000`,
  failures: `SELECT f.*,c.id AS company_joined_id,c.account_key AS company_account_key,c.name AS company_name,
      c.tax_registration_number AS company_tax_registration_number,
      c.name_source AS company_name_source,c.english_name AS company_english_name,
      c.portal_name AS company_portal_name,c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,
      a.state AS last_scan_state
    FROM failures f LEFT JOIN companies c ON c.id=COALESCE(
      f.company_id,(SELECT source.id FROM companies source WHERE source.account_key=f.account_key))
    LEFT JOIN account_status a ON a.account_key=f.account_key
    WHERE f.resolved_at IS NULL ORDER BY f.occurred_at DESC LIMIT 500`,
  reminders: `SELECT r.*,
    c.id AS company_joined_id,c.account_key AS company_account_key,c.name AS company_name,
    c.tax_registration_number AS company_tax_registration_number,c.name_source AS company_name_source,
    c.english_name AS company_english_name,c.portal_name AS company_portal_name,
    c.portal_name_english AS company_portal_name_english,
    c.last_scanned_at AS company_last_synced_at,
    a.state AS last_scan_state
    FROM reminders r
    LEFT JOIN obligations o ON r.target_type='obligation' AND o.id=r.target_id
    LEFT JOIN tasks t ON r.target_type='task' AND t.id=r.target_id
    LEFT JOIN payments p ON r.target_type='payment' AND p.id=r.target_id
    LEFT JOIN companies c ON c.id=COALESCE(o.company_id,t.company_id,p.company_id,r.company_id)
    LEFT JOIN account_status a ON a.account_key=c.account_key
    WHERE r.cancelled_at IS NULL ORDER BY r.due_at LIMIT 500`,
  reports: `SELECT r.*,c.name AS company_name,c.account_key AS company_account_key,
      c.tax_registration_number AS company_tax_registration_number,
      c.name_source AS company_name_source,c.english_name AS company_english_name,
      c.portal_name AS company_portal_name,c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,a.state AS last_scan_state
    FROM reports r LEFT JOIN companies c ON c.id=r.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key
    ORDER BY r.created_at DESC LIMIT 500`,
  audit: 'SELECT * FROM audit_log ORDER BY at DESC LIMIT 1000'
}

/**
 * Plan 2.4 §3.4 / §5.2 — a capped list must never look complete when it is
 * not. Each capped query is fetched with `limit + 1` rows so the presence of a
 * hidden tail is detected, and the exact total is counted separately. The UI
 * renders `result.truncation` instead of implying "this is everything".
 */
export const RECORD_LIMITS = {
  tasks: 1000,
  obligations: 1000,
  payments: 1000,
  messages: 1000,
  failures: 500,
  reminders: 500,
  reports: 500,
  audit: 1000,
  document_history: 20
}

/** Same row set as `queries[section]`, with no LIMIT, for the true count. */
const COUNT_SQL = {
  tasks: 'SELECT COUNT(*) AS n FROM tasks',
  obligations: 'SELECT COUNT(*) AS n FROM obligations',
  payments: 'SELECT COUNT(*) AS n FROM payments',
  messages: 'SELECT COUNT(*) AS n FROM messages',
  failures: 'SELECT COUNT(*) AS n FROM failures WHERE resolved_at IS NULL',
  reminders: 'SELECT COUNT(*) AS n FROM reminders WHERE cancelled_at IS NULL',
  reports: 'SELECT COUNT(*) AS n FROM reports',
  audit: 'SELECT COUNT(*) AS n FROM audit_log'
}

const TOTAL_CACHE_MS = 30000
const totalCache = new Map()

function exactTotal(section) {
  const sql = COUNT_SQL[section]
  if (!sql) return null
  const cached = totalCache.get(section)
  if (cached && Date.now() - cached.at < TOTAL_CACHE_MS) return cached.total
  const total = db.prepare(sql).get().n
  totalCache.set(section, { total, at: Date.now() })
  return total
}

export function listRecords(section) {
  const sql = queries[section]
  if (!sql) throw new Error(`Unknown records section: ${section}`)
  const limit = RECORD_LIMITS[section]
  // Swap the inline LIMIT for a parameter and fetch one extra row as the
  // "is there a hidden tail?" probe.
  const statement = db.prepare(limit ? sql.replace(/LIMIT\s+\d+\s*$/i, `LIMIT ${limit + 1}`) : sql)
  const run = () => (section === 'companies'
    ? statement.all({ today: cairoDayKey(new Date()), week: cairoDayKey(new Date(Date.now() + 7 * 86400000)) })
    : statement.all())
  const rows = run()
  const truncated = Boolean(limit) && rows.length > limit
  const visible = attachTruncation(
    truncated ? rows.slice(0, limit) : rows,
    { section, limit, truncated, total: exactTotal(section) }
  )
  if (section === 'companies') {
    return visible.map((row) => {
      const company = identity.resolveCompanyIdentity(row)
      const {
        account_key: _accountKey,
        name_source: _nameSource,
        portal_name: _portalName,
        portal_name_english: _portalEnglishName,
        ...safeCompany
      } = row
      return {
        ...safeCompany,
        name: company.name,
        english_name: company.englishName,
        company_known: company.known,
        company_name_origin: company.origin,
        company_manual_name: company.manualName,
        company_portal_name: company.portalName,
        company_name_candidate: company.origin === 'unverified_mapping' ? company.name : ''
      }
    })
  }
  if (!['tasks', 'obligations', 'payments', 'messages', 'failures', 'reminders', 'reports'].includes(section)) {
    return visible
  }
  const mapped = attachTruncation(visible.map((row) => {
    const company = identity.resolveCompanyIdentity({
      id: row.company_joined_id || row.company_id,
      name: row.company_name,
      account_key: row.company_account_key || row.account_key,
      name_source: row.company_name_source,
      english_name: row.company_english_name,
      portal_name: row.company_portal_name,
      portal_name_english: row.company_portal_name_english,
      tax_registration_number: row.company_tax_registration_number
    })
    const {
      company_account_key: _accountKey,
      company_name_source: _nameSource,
      company_english_name: _englishName,
      company_portal_name: _portalName,
      company_portal_name_english: _portalEnglishName,
      company_joined_id: _joinedCompanyId,
      account_key: _recordAccountKey,
      raw_json: _rawJson,
      ...message
    } = row
    const shaped = {
      ...message,
      company_id: row.company_joined_id || row.company_id || '',
      company_name: company.name,
      company_english_name: company.englishName,
      company_known: company.known,
      company_name_origin: company.origin,
      company_manual_name: company.manualName,
      company_portal_name: company.portalName,
      company_name_candidate: company.origin === 'unverified_mapping' ? company.name : '',
      company_tax_registration_number: company.taxRegistrationNumber
    }
    if (section === 'obligations') {
      shaped.period = displayPeriod(row.period, row.period_from || row.periodFrom || '', row.period_to || row.periodTo || '')
      attachLegalDeadlineDays(shaped)
      shaped.tax = classifyTaxObligation(row)
    }
    if (section === 'tasks') {
      enrichTaskRecord(shaped)
    }
    return shaped
  }), { section, limit, truncated, total: exactTotal(section) })
  return mapped
}

/**
 * Truncation metadata rides on the returned array as a non-enumerable property
 * so every existing caller keeps working, while React/JSON serialisation never
 * sees a stray key. Read it with `truncationOf` before filtering or mapping.
 */
function attachTruncation(rows, meta) {
  Object.defineProperty(rows, 'truncation', { value: meta, enumerable: false })
  return rows
}

export function truncationOf(rows) {
  return rows?.truncation || null
}

export function getCompany(identifier) {
  return db.prepare('SELECT * FROM companies WHERE id=?').get(identifier)
    || db.prepare('SELECT * FROM companies WHERE account_key=?').get(identifier)
    || null
}

export function getCompanyRecords(identifier) {
  const storedCompany = getCompany(identifier)
  if (!storedCompany) return null
  const company = {
    id: storedCompany.id,
    name: storedCompany.name,
    account_key: storedCompany.account_key,
    english_name: storedCompany.english_name,
    portal_name: storedCompany.portal_name,
    portal_name_english: storedCompany.portal_name_english,
    tax_registration_number: storedCompany.tax_registration_number,
    name_source: storedCompany.name_source
  }
  const rows = {}
  for (const table of ['tasks', 'obligations', 'payments']) {
    const sourceStatus = ['obligations', 'payments'].includes(table)
      ? `CASE WHEN json_valid(r.raw_json) AND json_type(r.raw_json,'$.status') IS NULL
          THEN '' ELSE r.status END AS source_status,`
      : ''
    rows[table] = db.prepare(`SELECT r.*,${sourceStatus}
      c.name AS company_name,c.name_source AS company_name_source,
      c.english_name AS company_english_name,c.portal_name AS company_portal_name,
      c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,
      a.state AS last_scan_state FROM ${table} r
      JOIN companies c ON c.id=r.company_id
      LEFT JOIN account_status a ON a.account_key=c.account_key
      WHERE r.company_id=? ORDER BY 1`).all(company.id).map((row) => safeCompanyRecord(row, storedCompany, table))
  }
  rows.messages = db.prepare(`SELECT m.id,m.company_id,
      COALESCE(NULLIF(m.title,''),CASE WHEN json_valid(m.raw_json) THEN
        COALESCE(NULLIF(json_extract(m.raw_json,'$.subject'),''),NULLIF(json_extract(m.raw_json,'$.rawSummary'),''),NULLIF(json_extract(m.raw_json,'$.message'),''),'')
        ELSE '' END) AS title,
      COALESCE(NULLIF(m.body,''),CASE WHEN json_valid(m.raw_json) THEN
        COALESCE(NULLIF(json_extract(m.raw_json,'$.body'),''),NULLIF(json_extract(m.raw_json,'$.message'),''),'')
        ELSE '' END) AS body,
      CASE WHEN json_valid(m.raw_json) AND json_type(m.raw_json,'$.severity') IS NULL
        THEN '' ELSE m.severity END AS severity,
      COALESCE(m.received_at,CASE WHEN json_valid(m.raw_json) THEN json_extract(m.raw_json,'$.scrapedAt') END,m.created_at) AS observed_at,m.is_read,
      c.name AS company_name,c.account_key AS company_account_key,
      c.name_source AS company_name_source,c.english_name AS company_english_name,
      c.portal_name AS company_portal_name,
      c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,a.state AS last_scan_state
    FROM messages m JOIN companies c ON c.id=m.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key
    WHERE m.company_id=? ORDER BY observed_at DESC`).all(company.id).map((row) => {
    const resolved = identity.resolveCompanyIdentity({
      id: row.company_id,
      name: row.company_name,
      account_key: row.company_account_key,
name_source: row.company_name_source,
      english_name: row.company_english_name,
      portal_name: row.company_portal_name,
      portal_name_english: row.company_portal_name_english
    })
    const {
      company_account_key: _accountKey,
      company_name_source: _NameSource,
      company_english_name: _EnglishName,
      company_portal_name: _PortalName,
      company_portal_name_english: _PortalEnglishName,
      ...message
    } = row
    return {
      ...message,
      company_name: resolved.name,
      company_english_name: resolved.englishName,
      company_known: resolved.known,
      company_name_origin: resolved.origin,
      company_manual_name: resolved.manualName,
      company_portal_name: resolved.portalName,
      company_name_candidate: resolved.origin === 'unverified_mapping' ? resolved.name : ''
    }
  })
  rows.documents = listCompanyDocuments(company.id)
  return { company, rows }
}

function safeCompanyRecord(row, company, section = '') {
  const resolved = identity.resolveCompanyIdentity(company)
  const {
    account_key: _accountKey,
    raw_json: _rawJson,
    company_name_source: _NameSource,
    company_english_name: _EnglishName,
    company_portal_name: _PortalName,
    company_portal_name_english: _PortalEnglishName,
    ...safeRecord
  } = row
  const shaped = {
    ...safeRecord,
    company_name: resolved.name,
    company_english_name: resolved.englishName,
    company_known: resolved.known,
    company_name_origin: resolved.origin
  }
  if (section === 'obligations') {
    attachLegalDeadlineDays(shaped)
    shaped.tax = classifyTaxObligation(row)
  }
  if (section === 'tasks') {
    enrichTaskRecord(shaped)
  }
  return shaped
}

function findPayrollFile() {
  const candidates = [
    process.env.V8_ROOT ? path.join(process.env.V8_ROOT, 'data', 'payroll.json') : null,
    path.join(process.cwd(), 'data', 'payroll.json'),
    path.resolve(process.cwd(), '..', 'data', 'payroll.json')
  ].filter(Boolean)
  for (const file of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ file)) return file
  }
  return candidates[0] || path.join(process.cwd(), 'data', 'payroll.json')
}

export function readPayrollData(companyAccountKey = null) {
  if (companyAccountKey !== null && typeof companyAccountKey !== 'string') {
    throw new TypeError('companyAccountKey must be null or a string')
  }

  const filePath = findPayrollFile()
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    return {
      available: false,
      count: 0,
      scannedAt: '',
      accounts: [],
      matchedAccount: null
    }
  }

  let parsed = null
  try {
    const content = fs.readFileSync(/*turbopackIgnore: true*/ filePath, 'utf8')
    parsed = JSON.parse(content)
  } catch (err) {
    console.error(`[readPayrollData] Failed to parse payroll JSON at ${filePath}:`, err)
    return {
      available: false,
      count: 0,
      scannedAt: '',
      accounts: [],
      matchedAccount: null,
      error: 'ملف بيانات الرواتب تالف أو غير قابل للقراءة'
    }
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.accounts)) {
    return {
      available: false,
      count: 0,
      scannedAt: '',
      accounts: [],
      matchedAccount: null,
      error: 'صيغة سجل بيانات الرواتب غير صالحة'
    }
  }

  let dbCompanies = []
  try {
    dbCompanies = db.prepare('SELECT id, name, account_key, portal_name FROM companies').all()
  } catch (dbErr) {
    console.error('[readPayrollData] Failed to query companies for payroll matching:', dbErr)
  }

  const MAX_ACCOUNTS = 100
  const MAX_OBLIGATIONS = 1000
  const safeAccounts = parsed.accounts.slice(0, MAX_ACCOUNTS).map((item) => {
    const rawCompany = typeof item?.company === 'string' ? item.company.trim() : ''
    const rawKey = typeof item?.accountKey === 'string' ? item.accountKey.trim() : ''

    const matchedDbCompany = dbCompanies.find((c) => {
      const matchKey = Boolean(rawKey && c.account_key && c.account_key.toLowerCase() === rawKey.toLowerCase())
      const matchName = Boolean(rawCompany && (
        (c.name && c.name.toLowerCase() === rawCompany.toLowerCase()) ||
        (c.portal_name && c.portal_name.toLowerCase() === rawCompany.toLowerCase()) ||
        (c.account_key && c.account_key.toLowerCase() === rawCompany.toLowerCase())
      ))
      return matchKey || matchName
    })

    const summary = (item?.summary && typeof item.summary === 'object') ? {
      taxDueCurrentYear: Math.max(0, Number(item.summary.taxDueCurrentYear) || 0),
      paymentsCurrentYear: Math.max(0, Number(item.summary.paymentsCurrentYear) || 0),
      employeeCount: Math.max(0, Number(item.summary.employeeCount) || 0),
      submittedFilings: Math.max(0, Number(item.summary.submittedFilings) || 0),
      unsubmittedFilings: Math.max(0, Number(item.summary.unsubmittedFilings) || 0),
      paidOnTimeCurrentYear: Math.max(0, Number(item.summary.paidOnTimeCurrentYear) || 0),
      paidLateCurrentYear: Math.max(0, Number(item.summary.paidLateCurrentYear) || 0),
      egyptianEmployees: Math.max(0, Number(item.summary.egyptianEmployees) || 0),
      foreignEmployees: Math.max(0, Number(item.summary.foreignEmployees) || 0)
    } : {
      taxDueCurrentYear: 0, paymentsCurrentYear: 0, employeeCount: 0,
      submittedFilings: 0, unsubmittedFilings: 0, paidOnTimeCurrentYear: 0,
      paidLateCurrentYear: 0, egyptianEmployees: 0, foreignEmployees: 0
    }

    const rawObligations = Array.isArray(item?.obligations) ? item.obligations.slice(0, MAX_OBLIGATIONS) : []
    const obligations = rawObligations.map((ob) => ({
      id: typeof ob?.id === 'string' ? ob.id : '',
      company: typeof ob?.company === 'string' ? ob.company : rawCompany,
      form: typeof ob?.form === 'string' ? ob.form : '',
      revenueType: typeof ob?.revenueType === 'string' ? ob.revenueType : '',
      period: typeof ob?.period === 'string' ? ob.period : '',
      periodFrom: typeof ob?.periodFrom === 'string' ? ob.periodFrom : '',
      periodTo: typeof ob?.periodTo === 'string' ? ob.periodTo : '',
      dueDate: typeof ob?.dueDate === 'string' ? ob.dueDate : '',
      receiptDate: typeof ob?.receiptDate === 'string' ? ob.receiptDate : '',
      submitted: Boolean(ob?.submitted)
    }))

    return {
      company: rawCompany,
      companyId: matchedDbCompany ? matchedDbCompany.id : null,
      accountKey: rawKey,
      scannedAt: typeof item?.scannedAt === 'string' ? item.scannedAt : (parsed.scannedAt || ''),
      summary,
      obligations
    }
  })

  let matchedAccount = null
  if (companyAccountKey) {
    const target = companyAccountKey.trim().toLowerCase()
    matchedAccount = safeAccounts.find((a) => {
      const matchKey = Boolean(a.accountKey && a.accountKey.toLowerCase() === target)
      const matchComp = Boolean(a.company && (
        a.company.toLowerCase() === target ||
        a.company.toLowerCase().includes(target) ||
        target.includes(a.company.toLowerCase())
      ))
      return matchKey || matchComp
    }) || null
  }

  return {
    available: true,
    version: parsed.version || 1,
    scannedAt: typeof parsed.scannedAt === 'string' ? parsed.scannedAt : '',
    count: safeAccounts.length,
    accounts: safeAccounts,
    matchedAccount
  }
}

export function listCompanyDocuments(companyId) {
  if (!companyId) return []
  const rows = db.prepare(`
    SELECT d.*, c.name AS company_name, c.english_name AS company_english_name,
           c.tax_registration_number AS company_tax_registration_number,
           p.inspection_officer,p.books_from_year,p.books_to_year,p.inspection_notes,p.source_document_id AS inspection_source_document_id
    FROM company_documents d
    JOIN companies c ON c.id = d.company_id
    LEFT JOIN company_inspection_profiles p ON p.company_id = d.company_id
    WHERE d.company_id = ?
    ORDER BY d.created_at ASC
  `).all(companyId)

  return rows.map((row) => {
    const evaluation = evaluateDocumentStatus(row.expiry_date)
    return {
      ...row,
      days_left: evaluation.daysLeft,
      status: evaluation.status,
      status_label: evaluation.statusLabel,
      countdown_label: evaluation.countdownLabel,
      tone: evaluation.tone,
      def: STANDARD_DOCUMENT_TYPES[row.doc_type] || STANDARD_DOCUMENT_TYPES.other
    }
  })
}

export function listArchiveDocuments({ companyId = '', docType = '', status = '', query = '' } = {}) {
  let sql = `
    SELECT d.*, c.name AS company_name, c.english_name AS company_english_name,
           c.tax_registration_number AS company_tax_registration_number,
           c.account_key AS company_account_key,
           p.inspection_officer,p.books_from_year,p.books_to_year,p.inspection_notes,p.source_document_id AS inspection_source_document_id
    FROM company_documents d
    JOIN companies c ON c.id = d.company_id
    LEFT JOIN company_inspection_profiles p ON p.company_id = d.company_id
    WHERE 1=1
  `
  const params = []
  if (companyId) {
    sql += ` AND d.company_id = ?`
    params.push(companyId)
  }
  if (docType) {
    sql += ` AND d.doc_type = ?`
    params.push(docType)
  }
  sql += ` ORDER BY CASE WHEN d.expiry_date = '' THEN 1 ELSE 0 END, d.expiry_date ASC, d.doc_type ASC`

  const rows = db.prepare(sql).all(...params)
  const mapped = rows.map((row) => {
    const evaluation = evaluateDocumentStatus(row.expiry_date)
    return {
      ...row,
      days_left: evaluation.daysLeft,
      status: evaluation.status,
      status_label: evaluation.statusLabel,
      countdown_label: evaluation.countdownLabel,
      tone: evaluation.tone,
      def: STANDARD_DOCUMENT_TYPES[row.doc_type] || STANDARD_DOCUMENT_TYPES.other
    }
  })

  return mapped.filter((item) => {
    if (status && status !== 'all' && item.status !== status) return false
    if (!query) return true
    const q = query.toLowerCase()
    return (
      (item.doc_name && item.doc_name.toLowerCase().includes(q)) ||
      (item.doc_number && item.doc_number.toLowerCase().includes(q)) ||
      (item.company_name && item.company_name.toLowerCase().includes(q)) ||
      (item.assigned_role && item.assigned_role.toLowerCase().includes(q)) ||
      (item.issuer && item.issuer.toLowerCase().includes(q)) ||
      (item.custodian && item.custodian.toLowerCase().includes(q)) ||
      (item.notes && item.notes.toLowerCase().includes(q))
    )
  })
}

export function getArchiveStats() {
  const all = listArchiveDocuments()
  return {
    total: all.length,
    valid: all.filter((d) => d.status === 'valid').length,
    expiringSoon: all.filter((d) => d.status === 'expiring_soon').length,
    expired: all.filter((d) => d.status === 'expired').length,
    noDate: all.filter((d) => d.status === 'no_date').length
  }
}

export function saveCompanyDocument(data) {
  if (!data || !data.company_id || !data.doc_type) {
    throw new Error('company_id and doc_type are required')
  }
  const nowIso = new Date().toISOString()
  const def = STANDARD_DOCUMENT_TYPES[data.doc_type] || STANDARD_DOCUMENT_TYPES.other
  const docName = data.doc_name || def.arabicName
  const evaluation = evaluateDocumentStatus(data.expiry_date)

  if (data.id) {
    db.prepare(`
      UPDATE company_documents
      SET doc_name = @doc_name,
          doc_number = @doc_number,
          issuer = @issuer,
          issue_date = @issue_date,
          expiry_date = @expiry_date,
          assigned_role = @assigned_role,
          status = @status,
          notes = @notes,
          file_path = @file_path,
          direction = @direction,
          received_at = @received_at,
          sent_at = @sent_at,
          custodian = @custodian,
          last_resaved_at = @last_resaved_at,
          last_resaved_by = @last_resaved_by,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: data.id,
      doc_name: docName,
      doc_number: data.doc_number || '',
      issuer: data.issuer || def.defaultIssuer,
      issue_date: data.issue_date || '',
      expiry_date: data.expiry_date || '',
      assigned_role: data.assigned_role || def.defaultRole,
      status: evaluation.status,
      notes: data.notes || '',
      file_path: data.file_path || '',
      direction: data.direction === 'outgoing' ? 'outgoing' : 'incoming',
      received_at: data.received_at || '',
      sent_at: data.sent_at || '',
      custodian: data.custodian || data.assigned_role || def.defaultRole,
      last_resaved_at: nowIso,
      last_resaved_by: data.registered_by || 'office user',
      updated_at: nowIso
    })
    db.prepare(`INSERT INTO company_document_history(id,document_id,actor,action,occurred_at,details) VALUES(?,?,?,?,?,?)`)
      .run(`doc_history_${Date.now()}`, data.id, data.registered_by || 'office user', 'resaved', nowIso, JSON.stringify({ direction: data.direction || 'incoming', custodian: data.custodian || '' }))
    return db.prepare('SELECT * FROM company_documents WHERE id = ?').get(data.id)
  }

  const id = `doc_${data.company_id}_${data.doc_type}_${Date.now()}`
  db.prepare(`
    INSERT INTO company_documents (
      id, company_id, account_key, doc_type, doc_name, doc_number,
      issuer, issue_date, expiry_date, assigned_role, status, notes,
      file_path, source, direction, received_at, sent_at, registered_by, custodian, last_resaved_at, last_resaved_by, created_at, updated_at
    ) VALUES (
      @id, @company_id, @account_key, @doc_type, @doc_name, @doc_number,
      @issuer, @issue_date, @expiry_date, @assigned_role, @status, @notes,
      @file_path, 'manual', @direction, @received_at, @sent_at, @registered_by, @custodian, @last_resaved_at, @last_resaved_by, @created_at, @updated_at
    )
  `).run({
    id,
    company_id: data.company_id,
    account_key: data.account_key || '',
    doc_type: data.doc_type,
    doc_name: docName,
    doc_number: data.doc_number || '',
    issuer: data.issuer || def.defaultIssuer,
    issue_date: data.issue_date || '',
    expiry_date: data.expiry_date || '',
    assigned_role: data.assigned_role || def.defaultRole,
    status: evaluation.status,
    notes: data.notes || '',
    file_path: data.file_path || '',
    direction: data.direction === 'outgoing' ? 'outgoing' : 'incoming',
    received_at: data.received_at || '',
    sent_at: data.sent_at || '',
    registered_by: data.registered_by || 'office user',
    custodian: data.custodian || data.assigned_role || def.defaultRole,
    last_resaved_at: nowIso,
    last_resaved_by: data.registered_by || 'office user',
    created_at: nowIso,
    updated_at: nowIso
  })
  db.prepare(`INSERT INTO company_document_history(id,document_id,actor,action,occurred_at,details) VALUES(?,?,?,?,?,?)`)
    .run(`doc_history_${Date.now()}`, id, data.registered_by || 'office user', 'registered', nowIso, JSON.stringify({ direction: data.direction || 'incoming', custodian: data.custodian || '' }))
  return db.prepare('SELECT * FROM company_documents WHERE id = ?').get(id)
}

export function deleteCompanyDocument(id) {
  if (!id) return false
  const res = db.prepare('DELETE FROM company_documents WHERE id = ?').run(id)
  return res.changes > 0
}

export function syncPortalDocuments() {
  const legal = syncPortalDocumentsToArchive(db)
  const portalPdfs = syncPortalTaskPdfsToArchive(db)
  return { ...legal, portalPdfs: portalPdfs.synced }
}

export function listDocumentHistory(documentId) {
  if (!documentId) return []
  return db.prepare(`SELECT actor,action,occurred_at,details FROM company_document_history WHERE document_id=? ORDER BY occurred_at DESC LIMIT 20`).all(documentId)
}


