import { db } from '../../../lib/db.js'
import { requireRole } from '../../../lib/guard.js'
import recordStatus from '../../../../domain/record-status.cjs'
import recordCounts from '../../../../domain/record-counts.cjs'
import identity from '../../../../domain/company-identity.cjs'
import { displayText } from '../../../../domain/display-text.cjs'
import { numberLocale } from '../../../lib/display.js'

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response
  const digits = await numberLocale()
  const harness = db.prepare('SELECT state,last_heartbeat,next_cycle_at,paused FROM harness_status WHERE id=1').get()
  const assistantManager = db.prepare('SELECT state,last_run_at FROM assistant_manager_status WHERE id=1').get()
  const attentionLimit = 7
  const attentionRows = db.prepare(`SELECT id,category,title,details,account_key,entity_id,updated_at
    FROM assistant_attention WHERE state='open' ORDER BY updated_at DESC LIMIT ?`).all(attentionLimit)
  const attention = attentionRows.map((item, index) => presentAttention(item, index, digits))
  const counts = recordCounts.getRecordCounts(db)
  counts.openTasks = counts.tasks
  counts.openObligations = counts.obligations
  counts.failures = counts.openFailures
  counts.attentionTotal = counts.openAttention
  counts.overdue = counts.overdueObligations + counts.overduePayments + counts.overdueTasks
  counts.dueSoon = counts.dueSoonObligations + counts.dueSoonPayments + counts.dueSoonTasks
  const lastScannedAt = db.prepare('SELECT MAX(last_scanned_at) AS at FROM companies').get().at
  const lastCycle = db.prepare(`SELECT started_at,finished_at,state,accounts_total,accounts_processed,accounts_failed
    FROM automation_cycles ORDER BY started_at DESC LIMIT 1`).get() || null
  const setting = (key, fallback) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? fallback
  const configuredProviders = [
    Boolean(process.env.TELEGRAM_BOT_TOKEN),
    Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    process.env.WHATSAPP_ENABLED === 'true'
  ].filter(Boolean).length
  const linkedRecipients = db.prepare(`SELECT COUNT(*) AS n FROM user_channels c
    JOIN users u ON u.id=c.user_id WHERE u.disabled=0 AND c.verified_at IS NOT NULL`).get().n
  const eventRows = db.prepare(`SELECT e.kind,e.created_at,c.id AS company_id,c.name,
      c.account_key,c.name_source,c.english_name,c.portal_name
    FROM events e LEFT JOIN companies c ON c.account_key=e.account_key
    ORDER BY e.created_at DESC LIMIT 20`).all()
  const events = eventRows.map((event, index) => {
    const company = event.account_key ? identity.resolveCompanyIdentity(event) : null
    return {
      key: `event-${index}`,
      title: eventTitle(event.kind),
      created_at: event.created_at,
      companyName: company?.name || (event.account_key ? identity.UNREGISTERED_COMPANY_NAME : ''),
      companyEnglishName: company?.englishName || '',
      companyId: event.company_id || '',
      companyKnown: Boolean(company?.known)
    }
  })
  return Response.json({
    harness, assistantManager, attention, counts, events, lastCycle, lastScannedAt,
    controls: {
      automationEnabled: setting('automation_enabled', 'false') === 'true',
      automationIntervalMin: setting('cycle_interval_min', '120'),
      assistantManagerEnabled: setting('assistant_manager_enabled', 'true') !== 'false',
      messageMode: setting('message_mode', 'dry-run'),
      configuredProviders,
      linkedRecipients,
      liveDeliveryReady: configuredProviders > 0 && linkedRecipients > 0
    },
    currentTime: new Date().toISOString()
  })
}

function presentAttention(item, index, locale = 'ar-EG-u-nu-latn') {
  const company = item.account_key
    ? db.prepare(`SELECT id,name,account_key,name_source,english_name,portal_name FROM companies WHERE account_key=?`).get(item.account_key)
    : null
  const resolvedCompany = company ? identity.resolveCompanyIdentity(company) : null
  let companyName = resolvedCompany?.name || (item.account_key ? identity.UNREGISTERED_COMPANY_NAME : '')
  let type = 'general'
  let title = 'هناك أمر يحتاج إلى مراجعتك'
  let details = ''
  let href = '/settings'
  let urgent = false
  let label = 'للمراجعة'
  let dueAt = ''

  if (item.category === 'payment_overdue' || item.category === 'payment_due' ||
      item.category === 'payment_status_unknown') {
    type = 'payment'
    title = item.category === 'payment_status_unknown'
      ? 'تحقق من حالة الدفع المسجلة'
      : item.category === 'payment_overdue' ? 'موعد سداد مضى' : 'موعد سداد قريب'
    href = '/payments'
    urgent = item.category === 'payment_overdue'
    label = urgent ? 'عاجل' : item.category === 'payment_due' ? 'قريبًا' : 'تحقق'
    const payment = db.prepare('SELECT amount,currency,due_date,status FROM payments WHERE id=?').get(item.entity_id)
    if (payment) {
      dueAt = payment.due_date || ''
      const amount = formatAmount(payment.amount, payment.currency)
      const dueDate = formatDate(payment.due_date, locale)
      details = [
        amount,
        item.category === 'payment_status_unknown' && 'الحالة غير معروفة في المصدر',
        dueDate && `الموعد ${dueDate}`
      ].filter(Boolean).join(' · ')
    } else {
      details = 'تحقق من الموعد المسجل وحالة السداد قبل اتخاذ أي إجراء.'
    }
  } else if (item.category === 'obligation_overdue' || item.category === 'obligation_deadline') {
    type = 'obligation'
    title = item.category === 'obligation_overdue' ? 'التزام يحتاج مراجعتك' : 'موعد التزام قريب'
    href = '/obligations'
    urgent = item.category === 'obligation_overdue'
    label = urgent ? 'عاجل' : 'قريبًا'
    const obligation = db.prepare('SELECT title,deadline FROM obligations WHERE id=?').get(item.entity_id)
    if (obligation) {
      dueAt = obligation.deadline || ''
      const titleText = cleanTitle(obligation.title)
      const dueDate = formatDate(obligation.deadline, locale)
      details = [titleText, dueDate && `الموعد ${dueDate}`].filter(Boolean).join(' · ')
    }
  } else if (item.category === 'obligation_status_unknown') {
    type = 'obligation'
    title = 'تحقق من حالة الالتزام المسجلة'
    href = '/obligations'
    label = 'تحقق'
    const obligation = db.prepare('SELECT title,deadline FROM obligations WHERE id=?').get(item.entity_id)
    if (obligation) {
      dueAt = obligation.deadline || ''
      const titleText = cleanTitle(obligation.title)
      const dueDate = formatDate(obligation.deadline, locale)
      details = [titleText, 'الحالة غير معروفة في المصدر', dueDate && `الموعد ${dueDate}`].filter(Boolean).join(' · ')
    }
  } else if (item.category === 'task_deadline') {
    type = 'task'
    title = 'مهمة تستحق انتباهك'
    href = '/tasks'
    label = 'قريبًا'
    const task = db.prepare('SELECT title,deadline FROM tasks WHERE id=?').get(item.entity_id)
    if (task) {
      dueAt = task.deadline || ''
      const titleText = cleanTitle(task.title)
      const dueDate = formatDate(task.deadline, locale)
      details = [titleText, dueDate && `الموعد ${dueDate}`].filter(Boolean).join(' · ')
    }
  } else if (item.category === 'account_failure') {
    type = 'failure'
    const accountLabel = item.account_key || 'حساب غير معروف'
    title = `تعذرت مراجعة الحساب ${accountLabel}`
    href = '/failures'
    details = explainAccountFailure(item.details)
    if (!company) companyName = `الحساب: ${accountLabel}`
    urgent = true
    label = 'عاجل'
  } else if (item.category === 'harness_offline') {
    type = 'general'
    title = 'المتابعة غير متاحة الآن'
    details = 'يمكنك الاطلاع على آخر ما حُفظ من مركز التحكم.'
    href = '/settings'
  }

  return {
    key: `attention-${index}`,
    type,
    title,
    details,
    companyName,
    updated_at: item.updated_at,
    due_at: dueAt,
    href,
    tone: urgent ? 'urgent' : 'attention',
    label,
    companyId: company?.id || '',
    companyKnown: Boolean(resolvedCompany?.known),
    companyEnglishName: resolvedCompany?.englishName || ''
  }
}

function explainAccountFailure(reason) {
  const text = String(reason || '').toLowerCase()
  if (text.includes('authentication') || text.includes('rejected account')) {
    return 'رفضت البوابة تسجيل الدخول. راجع كلمة المرور أو صلاحية الحساب قبل إعادة الفحص.'
  }
  if (text.includes('timeout') || text.includes('unreachable')) {
    return 'لم تستجب البوابة أثناء تسجيل الدخول. أعد الفحص لاحقًا وتحقق من اتصال البوابة.'
  }
  return 'توجد مشكلة في آخر فحص لهذا الحساب. افتح الإخفاقات لرؤية التفاصيل المسجلة.'
}

function eventTitle(kind) {
  return ({
    reminder_due: 'حان موعد تذكيرك',
    new_doc: 'وصل تحديث جديد إلى سجلاتك',
    changed_doc: 'تم تحديث أحد سجلاتك',
    removed_doc: 'تغيّر ما يظهر في أحد سجلاتك',
    account_parked: 'توقفت متابعة إحدى الشركات مؤقتًا',
    harness_offline: 'المتابعة غير متاحة الآن',
    assistant_attention: 'هناك أمر جديد يستحق انتباهك'
  })[kind] || 'تحديث جديد في مساحتك'
}

function cleanTitle(value) {
  return displayText(value)
}

const formatAmount = recordStatus.formatAmount

function formatDate(value, locale = 'ar-EG-u-nu-latn') {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !recordStatus.validDateKey(String(value))) return ''
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'Africa/Cairo'
  }).format(date)
}
