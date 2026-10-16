import { db } from './db.js'
import identity from '../../domain/company-identity.cjs'

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
        ('paid','done','complete','completed','resolved','settled','closed','تم السداد','مدفوع','مسدد بالكامل')) overdue_payments`

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
      c.last_scanned_at AS company_last_synced_at,a.state AS last_scan_state
    FROM obligations o JOIN companies c ON c.id=o.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key ORDER BY o.deadline LIMIT 1000`,
  payments: `SELECT p.*,CASE WHEN json_valid(p.raw_json) AND json_type(p.raw_json,'$.status') IS NULL
      THEN '' ELSE p.status END AS source_status,c.account_key AS company_account_key,c.name AS company_name,
      c.tax_registration_number AS company_tax_registration_number,
      c.name_source AS company_name_source,c.english_name AS company_english_name,
      c.portal_name AS company_portal_name,c.portal_name_english AS company_portal_name_english,
      c.last_scanned_at AS company_last_synced_at,a.state AS last_scan_state
    FROM payments p JOIN companies c ON c.id=p.company_id
    LEFT JOIN account_status a ON a.account_key=c.account_key ORDER BY p.due_date LIMIT 1000`,
  messages: `SELECT m.id,m.company_id,
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
  audit: 1000
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
    return {
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
      WHERE r.company_id=? ORDER BY 1`).all(company.id).map((row) => safeCompanyRecord(row, storedCompany))
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
  return { company, rows }
}

function safeCompanyRecord(row, company) {
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
  return {
    ...safeRecord,
    company_name: resolved.name,
    company_english_name: resolved.englishName,
    company_known: resolved.known,
    company_name_origin: resolved.origin
  }
}
