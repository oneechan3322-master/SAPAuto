import Link from 'next/link'
import { AlertTriangle, Building2, CheckCircle2, CircleSlash, Clock } from 'lucide-react'
import MessagesView from './messages-view.jsx'
import PaymentWorklist from './payment-worklist.jsx'
import CompanyAssignment from './company-assignment.jsx'
import CopyCompanyName from './copy-company-name.jsx'
import SyncMeta from './sync-meta.jsx'
import recordStatus from '../../domain/record-status.cjs'
import identity from '../../domain/company-identity.cjs'
import { displayText } from '../../domain/display-text.cjs'

const { UNREGISTERED_COMPANY_NAME, companyInitials: initialsOf } = identity

/**
 * Plan 2.4 §4.1 — a status chip carries text, an icon AND colour. Colour alone
 * is never the only signal, and the icon differs per state.
 */
const STATUS_ICONS = {
  calm: CheckCircle2,
  attention: Clock,
  urgent: AlertTriangle,
  muted: CircleSlash
}

function StatusPill({ tone = 'muted', label }) {
  if (!label) return null
  const Icon = STATUS_ICONS[tone] || CircleSlash
  return (
    <span className={`record-status-pill ${tone}`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  )
}

const titles = {
  tasks: 'المهمة',
  obligations: 'الالتزام',
  payments: 'موعد الدفع',
  failures: 'مراجعة مطلوبة',
  reminders: 'تذكيرك',
  reports: 'ملخصك',
  audit: 'تحديث'
}

export default function RecordsView({ section, rows, companyOptions = [], locale = 'ar-EG-u-nu-latn', truncation = null }) {
  if (section === 'companies') return <CompanyCards rows={rows} locale={locale} />
  if (section === 'messages') return <MessagesView rows={rows} />
  // Plan 2.4 §3.3 — payments get a worklist, not a card wall.
  if (section === 'payments') return <PaymentWorklist rows={rows} locale={locale} truncation={truncation} />
  if (!titles[section]) return <p className="error">هذه الصفحة غير متاحة.</p>
  if (!rows.length) return <RecordsEmpty section={section} />

  return (
    <div className={`record-card-list record-card-list-${section}`} aria-label={titles[section]}>
      {rows.map((row, index) => (
        <RecordCard section={section} row={row} index={index} companyOptions={companyOptions} locale={locale} key={row.id || index} />
      ))}
    </div>
  )
}

function RecordCard({ section, row, index, companyOptions, locale }) {
  const company = companyName(row)
  const date = recordDate(row, section, locale)
  const state = recordState(row, section)

  if (section === 'payments') {
    const paymentState = state
    return (
      <article className={`record-card payment-record-card ${paymentState.tone ? `record-card-${paymentState.tone}` : ''}`}>
        <div className="record-card-top">
          <span className="record-card-symbol payment-symbol" aria-hidden="true">↗</span>
          {paymentState.label && <StatusPill tone={paymentState.tone} label={paymentState.label} />}
        </div>
        <div className="payment-record-amount">{recordStatus.formatAmount(row.amount, row.currency)}</div>
        <div className="record-card-title">موعد دفع</div>
        <CompanyLine row={row} />
        <time className="record-card-date" dateTime={isoDate(row.due_date)}>{date}</time>
        <SyncMeta value={row.company_last_synced_at} state={row.last_scan_state} locale={locale} />
      </article>
    )
  }

  if (section === 'tasks') {
    const title = safeTitle(row.title, 'لم يتم تسجيل عنوان المهمة')
    const deadlineTone = state.tone
    return (
      <article className={`record-card ${deadlineTone ? `record-card-${deadlineTone}` : ''}`}>
        <div className="record-card-top">
          <span className="record-card-symbol task-symbol" aria-hidden="true">✦</span>
          {state.label && <StatusPill tone={state.tone} label={state.label} />}
        </div>
        <h2 className="record-card-title">{title}</h2>
        {row.required_action && safeTitle(row.required_action, '') && (
          <p className="record-card-description">{safeTitle(row.required_action, '')}</p>
        )}
        <RecordMeta row={row} company={company} date={date} locale={locale} />
      </article>
    )
  }

  if (section === 'obligations') {
    const title = safeTitle(row.title, 'لم يتم تسجيل عنوان الالتزام')
    const period = safeTitle(row.period, '')
    const dueTone = state.tone
    return (
      <article className={`record-card ${dueTone ? `record-card-${dueTone}` : ''}`}>
        <div className="record-card-top">
          <span className="record-card-symbol obligation-symbol" aria-hidden="true">◷</span>
          {state.label && <StatusPill tone={state.tone} label={state.label} />}
        </div>
        <h2 className="record-card-title">{title}</h2>
        {period && period !== title && <p className="record-card-description">{period}</p>}
        <RecordMeta row={row} company={company} date={date} locale={locale} />
      </article>
    )
  }

  if (section === 'failures') {
    return (
      <article className="record-card record-card-attention">
        <div className="record-card-top">
          <span className="record-card-symbol attention-symbol" aria-hidden="true">!</span>
          <StatusPill tone="attention" label="نحتاج إلى مراجعتك" />
        </div>
        <h2 className="record-card-title">تعذّرت المراجعة</h2>
        {row.company_id
          ? <CompanyLine row={row} />
          : <CompanyAssignment section="failures" recordId={row.id} companies={companyOptions} />}
        <p className="record-card-description">تحقق من الاتصال والإعدادات، ثم أعد المحاولة من مركز التحكم.</p>
        {date && <time className="record-card-date" dateTime={isoDate(row.occurred_at)}>{date}</time>}
        <SyncMeta value={row.company_last_synced_at} state={row.last_scan_state} locale={locale} />
      </article>
    )
  }

  if (section === 'reminders') {
    return (
      <article className="record-card">
        <div className="record-card-top">
          <span className="record-card-symbol reminder-symbol" aria-hidden="true">◷</span>
          <StatusPill tone="calm" label={channelLabel(row.channel)} />
        </div>
        <h2 className="record-card-title">{safeTitle(row.message, 'تذكيرك')}</h2>
        <RecordMeta row={row} company={company} date={date} locale={locale} />
        {!row.company_id && <CompanyAssignment section="reminders" recordId={row.id} companies={companyOptions} />}
      </article>
    )
  }

  if (section === 'reports') {
    return (
      <article className="record-card">
        <div className="record-card-top">
          <span className="record-card-symbol report-symbol" aria-hidden="true">✧</span>
          <StatusPill tone={row.sent_at ? 'calm' : 'attention'} label={row.sent_at ? 'تم الإرسال' : 'محفوظ لديك'} />
        </div>
        <h2 className="record-card-title">ملخص {channelLabel(row.channel)}</h2>
        {row.company_id
          ? <CompanyLine row={row} />
          : <CompanyAssignment section="reports" recordId={row.id} companies={companyOptions} />}
        <RecordMeta date={row.sent_at ? formatDate(row.sent_at, locale) : formatDate(row.created_at, locale)} />
      </article>
    )
  }

  const auditTitle = auditLabel(row.action)
  return (
    <article className="record-card">
      <div className="record-card-top">
        <span className="record-card-symbol report-symbol" aria-hidden="true">✧</span>
        <StatusPill tone="calm" label="تم" />
      </div>
      <h2 className="record-card-title">{auditTitle}</h2>
      <RecordMeta date={formatDate(row.at, locale)} />
    </article>
  )
}

function RecordMeta({ row, company, date, locale }) {
  const lastSynced = row ? row.company_last_synced_at : undefined
  const syncState = row ? row.last_scan_state : undefined
  if (!company && !date) return null
  return (
    <div className="record-card-meta">
      {company && row ? <CompanyLine row={row} /> : company && <span className="record-company">{company}</span>}
      {date && <span>{date}</span>}
      {lastSynced ? <SyncMeta value={lastSynced} state={syncState} locale={locale} /> : <span className="record-sync-meta">لم تُزامن بعد</span>}
    </div>
  )
}

/**
 * The company is always named on a record. When the portal never sent a name
 * and the user has not entered one, the line shows the single honest empty
 * state plus the set-name action; it never invents "الشركة" + a number.
 */
function CompanyLine({ row }) {
  const known = Boolean(row.company_known)
  const name = known ? row.company_name : UNREGISTERED_COMPANY_NAME
  const englishName = row.company_english_name
  const label = known && englishName ? `${name} · ${englishName}` : name
  const href = row.company_id ? `/companies/${encodeURIComponent(row.company_id)}` : ''
  const body = (
    <>
      <span className={`company-line-badge ${known ? '' : 'is-empty'}`} aria-hidden="true">
        {known ? <CompanyBadgeText name={name} /> : <Building2 size={16} strokeWidth={1.8} />}
      </span>
      <span className="company-line-text">
        {href ? <Link className="record-company company-name-full" href={href} title={label}>{label}</Link> : <span className="record-company company-name-full" title={label}>{label}</span>}
        {row.company_name_origin === 'manual_verified' && <span className="company-origin-tag">أدخلته أنت</span>}
        {row.company_name_origin === 'conflict' && (
          <span className="company-identity-warning">
            الاسم المحفوظ: {row.company_manual_name} · اسم البوابة: {row.company_portal_name}
          </span>
        )}
        {row.company_name_origin === 'unverified_mapping' && (
          <span className="company-identity-warning">اسم محفوظ يحتاج إلى تأكيد: {row.company_name_candidate}</span>
        )}
        {!known && href && (
          <Link className="company-set-link" href={`${href}#set-company-name`}>
            {row.company_name_origin === 'conflict' || row.company_name_origin === 'unverified_mapping' ? 'مراجعة الاسم' : 'تعيين اسم الشركة'}
          </Link>
        )}
      </span>
    </>
  )
  return <div className="company-line">{body}</div>
}

function CompanyBadgeText({ name }) {
  const text = initialsOf(name)
  return text || <Building2 size={16} strokeWidth={1.8} />
}

function CompanyCardBadge({ name, known }) {
  const text = known ? initialsOf(name) : ''
  return (
    <span className={`company-avatar ${known ? '' : 'is-empty'}`} aria-hidden="true">
      {text || <Building2 size={20} strokeWidth={1.7} />}
    </span>
  )
}

function CompanyCards({ rows, locale }) {
  if (!rows.length) {
    return (
      <section className="company-empty">
        <span className="company-empty-mark" aria-hidden="true"><Building2 size={24} strokeWidth={1.6} /></span>
        <h2>مساحتك تبدأ هنا</h2>
        <p>ستظهر شركاتك هنا بعد ربط حساب وبدء مراجعة سجلاته.</p>
      </section>
    )
  }
  const number = (value) => Number(value || 0).toLocaleString(locale)
  return (
    <div className="company-grid">
      {rows.map((company, index) => {
        const known = Boolean(company.company_known)
        const name = known ? company.name : UNREGISTERED_COMPANY_NAME
        const href = `/companies/${encodeURIComponent(company.id)}`
        return (
          <article className={`company-card ${known ? '' : 'is-unnamed'}`} key={company.id || index}>
            <Link className="company-card-body" href={href}>
              <div className="company-card-top">
                <CompanyCardBadge name={name} known={known} />
                <span className="company-presence" aria-label="محفوظة في مساحتك" />
              </div>
              <h2 className="company-name-full" title={name}>{name}</h2>
              {known && company.english_name && (
                <p className="company-card-english" dir="ltr" title={company.english_name}>{company.english_name}</p>
              )}
              {!known && company.company_name_origin === 'conflict' && (
                <p className="company-card-identity-help">
                  الاسم الذي أدخلته: {company.company_manual_name}<br />
                  اسم البوابة: {company.company_portal_name}
                </p>
              )}
              {!known && company.company_name_origin === 'unverified_mapping' && (
                <p className="company-card-identity-help">اسم محفوظ يحتاج إلى تأكيد: {company.company_name_candidate}</p>
              )}
              {!known && !['conflict', 'unverified_mapping'].includes(company.company_name_origin) && (
                <p className="company-card-identity-help">لم يصلنا اسم الشركة من البوابة بعد.</p>
              )}
              {known && <CopyCompanyName name={name} englishName={company.english_name} compact />}
              {known && company.company_name_origin === 'manual_verified' && (
                <p className="company-origin-note">الاسم أدخلته أنت — لا يأتي من البوابة</p>
              )}
              <p className="company-card-summary-line">
                <span className="summary-chip" style={{ '--chip-accent': 'var(--overdue)' }}>
                  <i aria-hidden="true" />
                  <strong>{number(company.overdue_obligations)}</strong> التزام تجاوز موعده
                </span>
                <span className="summary-sep" aria-hidden="true">·</span>
                <span className="summary-chip" style={{ '--chip-accent': 'var(--overdue)' }}>
                  <i aria-hidden="true" />
                  <strong>{number(company.overdue_payments)}</strong> موعد سداد تجاوز موعده
                </span>
                <span className="summary-sep" aria-hidden="true">·</span>
                <span className="summary-chip" style={{ '--chip-accent': 'var(--soon)' }}>
                  <i aria-hidden="true" />
                  <strong>{number(company.due_this_week_obligations)}</strong> التزام خلال 7 أيام
                </span>
              </p>
            </Link>
            <div className="company-card-footer">
              <span
                className="company-sync-stamp"
                title={company.last_scanned_at
                  ? `آخر مزامنة للبوابة: ${exactTimestamp(company.last_scanned_at, locale)}`
                  : 'لا توجد مزامنة محفوظة لهذه الشركة'}
              >
                {company.last_scan_state === 'failed' || company.last_scan_state === 'parked'
                  ? `تعذرت المزامنة · ${company.last_scanned_at ? `آخر بيانات ${relativeDate(company.last_scanned_at, locale)}` : 'لا توجد بيانات سابقة'}`
                  : company.last_scanned_at ? `آخر مزامنة ${relativeDate(company.last_scanned_at, locale)}` : 'لم تُزامن بعد'}
              </span>
              <Link
                className={`company-card-action ${known ? 'is-secondary' : 'is-set-name'}`}
                href={`${href}#set-company-name`}
              >
                {known ? 'فتح سجل الشركة' : 'تعيين اسم الشركة'}
              </Link>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function RecordsEmpty({ section }) {
  const text = {
    tasks: ['كل شيء على ما يرام', 'لا توجد مهام تنتظر المتابعة الآن.'],
    obligations: ['أمورك مرتبة', 'لا توجد التزامات تحتاج إلى مراجعة الآن.'],
    payments: ['لا توجد مدفوعات هنا', 'ستظهر المواعيد عند توفرها.'],
    failures: ['كل شيء يسير بسلاسة', 'لا توجد مراجعات متعثرة الآن.'],
    reminders: ['مساحتك هادئة', 'ستجد تذكيراتك هنا عند إضافتها.'],
    reports: ['ملخصاتك في انتظارك', 'ستظهر هنا الملخصات التي تحفظها.'],
    audit: ['لا توجد تحديثات بعد', 'ستظهر هنا التحديثات المهمة.']
  }[section] || ['كل شيء هادئ', 'لا توجد سجلات للعرض الآن.']
  return <section className="record-empty"><span aria-hidden="true">✳</span><h2>{text[0]}</h2><p>{text[1]}</p></section>
}

function companyName(row) {
  const value = String(row?.company_name || '').trim()
  return value || UNREGISTERED_COMPANY_NAME
}

function exactTimestamp(value, locale = 'ar-EG-u-nu-latn') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'full', timeStyle: 'medium', timeZone: 'Africa/Cairo'
  }).format(date)
}

function safeTitle(value, fallback) {
  return displayText(value, fallback)
}

function recordDate(row, section, locale) {
  const dateField = section === 'tasks' || section === 'obligations'
    ? row.deadline
    : section === 'payments'
      ? row.due_date
      : section === 'failures'
        ? row.occurred_at
        : section === 'reminders'
          ? row.due_at
          : row.sent_at || row.created_at
  return dateField ? formatDate(dateField, locale) : 'لم يتم تسجيل الموعد'
}

function recordState(row, section) {
  const raw = String(row.source_status ?? row.status ?? '')
  const state = raw.toLowerCase()
  const dateField = section === 'payments' ? row.due_date : row.deadline
  const derived = recordStatus.classifyRecord(section, dateField, raw)
  if (derived === 'complete') return { label: section === 'payments' ? 'تم السداد وفق السجل' : 'مكتمل وفق السجل', tone: 'calm' }
  if (derived === 'overdue') return { label: 'تجاوز الموعد المسجل', tone: 'urgent' }
  if (derived === 'due_today') return { label: 'موعد اليوم', tone: 'attention' }
  if (derived === 'due_soon') return { label: 'موعد خلال 7 أيام', tone: 'attention' }
  if (derived === 'missing_date') return { label: 'لم يتم تسجيل الموعد', tone: 'muted' }
  if (derived === 'invalid_date') return { label: 'الموعد المسجل غير صالح', tone: 'muted' }
  if (derived === 'unknown') {
    return { label: state === 'unknown' ? 'الحالة غير معروفة في المصدر' : 'لم يتم تسجيل الحالة', tone: 'muted' }
  }
  if (section === 'payments' && state === 'مسدد جزئياً') return { label: 'مسدد جزئياً وفق السجل', tone: 'attention' }
  return { label: 'الموعد قادم وفق التاريخ المسجل', tone: 'calm' }
}

function channelLabel(value) {
  return ({ launcher: 'على جهازك', email: 'البريد الإلكتروني', gmail: 'البريد الإلكتروني', telegram: 'Telegram', whatsapp: 'WhatsApp' })[value] || 'تذكير شخصي'
}

function auditLabel(value) {
  return ({
    'task.marked_done': 'اكتملت مهمة',
    'obligation.marked_done': 'تم تحديث التزام',
    'payment.marked_paid': 'تم تحديث حالة دفع',
    'message.marked_read': 'تمت قراءة رسالة',
    'channel.connected': 'تم ربط قناة',
    'whatsapp.pairing_requested': 'بدأ ربط WhatsApp',
    'whatsapp.connected': 'تم ربط WhatsApp'
  })[value] || 'تم تحديث مساحتك'
}

function formatDate(value, locale = 'ar-EG-u-nu-latn') {
  if (!value) return 'لم يتم تسجيل الموعد'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(date.getTime()) || (dateOnly && !recordStatus.validDateKey(value))) return 'الموعد المسجل غير صالح'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(!dateOnly ? { timeStyle: 'short' } : {}),
    timeZone: dateOnly ? 'UTC' : 'Africa/Cairo'
  }).format(date)
}

function isoDate(value) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** "آخر مزامنة" always means the last portal scan, never when a page was opened. */
function relativeDate(value, locale = 'ar-EG-u-nu-latn') {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'وقت المزامنة غير متاح'
  const elapsed = Math.max(0, Date.now() - timestamp)
  const number = (value) => value.toLocaleString(locale)
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${number(minutes)} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `قبل ${number(hours)} ساعة`
  const days = Math.floor(hours / 24)
  if (days < 30) return `قبل ${number(days)} يوم`
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Africa/Cairo' }).format(timestamp)
}
