import { timingSafeEqual } from 'node:crypto'
import { db } from '../../../lib/db.js'
import identity from '../../../../domain/company-identity.cjs'
import { getRecordCounts } from '../../../../domain/record-counts.cjs'

const eventTitles = {
  new_doc: 'وصل مستند جديد',
  removed_doc: 'لم يعد المستند ظاهرًا في المصدر',
  scan_failed: 'تعذرت مراجعة الحساب',
  reminder_due: 'حان موعد تذكير'
}

function tokenMatches(value, expected) {
  if (typeof value !== 'string' || !expected) return false
  const candidate = Buffer.from(value)
  const secret = Buffer.from(expected)
  return candidate.length === secret.length && timingSafeEqual(candidate, secret)
}

export async function GET(request) {
  const token = new URL(request.url).searchParams.get('token')
  if (!tokenMatches(token, process.env.V8_KIOSK_TOKEN)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const harness = db.prepare('SELECT state,account_index,account_total,current_account,last_heartbeat,next_cycle_at FROM harness_status WHERE id=1').get()
  const currentCompanyRow = harness.current_account
    ? db.prepare(`SELECT id,name,account_key,name_source,english_name,portal_name
      FROM companies WHERE account_key=?`).get(harness.current_account)
    : null
  const currentCompany = currentCompanyRow ? identity.resolveCompanyIdentity(currentCompanyRow) : null
  const summary = getRecordCounts(db)
  const counts = {
    newToday: summary.newToday,
    overdue: summary.overdueTasks + summary.overdueObligations + summary.overduePayments,
    dueSoon: summary.dueSoonTasks + summary.dueSoonObligations + summary.dueSoonPayments,
    failures: summary.openFailures
  }
  const events = db.prepare(`SELECT e.kind,e.created_at,c.id AS company_id,c.name,
      c.account_key,c.name_source,c.english_name,c.portal_name
    FROM events e LEFT JOIN companies c ON c.account_key=e.account_key
    WHERE e.kind<>'reminder_due' ORDER BY e.created_at DESC LIMIT 20`).all().map((event) => {
    const company = identity.resolveCompanyIdentity(event)
    return {
      title: eventTitles[event.kind] || 'تحديث محفوظ',
      created_at: event.created_at,
      companyName: company.name
    }
  })
  const safeHarness = {
    state: harness.state,
    account_index: harness.account_index,
    account_total: harness.account_total,
    current_company: currentCompany?.name || '',
    last_heartbeat: harness.last_heartbeat,
    next_cycle_at: harness.next_cycle_at
  }
  return Response.json({ harness: safeHarness, counts, events }, { headers: { 'cache-control': 'no-store' } })
}
