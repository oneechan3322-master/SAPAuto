'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, Filter } from 'lucide-react'
import recordStatus from '../../domain/record-status.cjs'
import CopyCompanyName from './copy-company-name.jsx'
import SyncMeta from './sync-meta.jsx'

const { formatAmount, describePayment } = recordStatus

/**
 * Plan 2.4 §3.3 / §5.3 — payments were a wall of cards that showed an amount
 * and a vague label and nothing else. An accountant cannot work a queue from
 * that: they need the company, the due date, what the SOURCE says, what the
 * LOCAL review says, whether the source is stale, and how many rows they are
 * actually looking at. That is a worklist, so this is one.
 *
 * Read-only by design: Plan 2.4 §7.3 forbids making payments from the UI
 * until the authentication path is real, so there is deliberately no button
 * here that claims to mark anything paid.
 */

const LANE_FILTERS = [
  { id: 'review_now', label: 'للمراجعة الآن' },
  { id: 'historical', label: 'سجل تاريخي' },
  { id: 'all', label: 'كل السجلات' },
  { id: 'conflict', label: 'تعارض' },
  { id: 'stale', label: 'بيانات قديمة' },
  { id: 'source_complete', label: 'مسدّدة في المصدر' },
  { id: 'source_active', label: 'مستحقة في المصدر' }
]

function dueKey(row) {
  return typeof row.due_date === 'string' ? row.due_date.slice(0, 10) : ''
}

function isHistorical(row) {
  const date = dueKey(row)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const currentYear = new Date().getFullYear()
  return date < `${currentYear - 1}-01-01`
}

function needsReviewNow(row, payment) {
  if (isHistorical(row)) return false
  return payment.source.disposition === 'active' || payment.source.disposition === 'unknown' || payment.conflict || payment.stale
}

function matchesFilter(row, payment, filter) {
  if (filter === 'all') return true
  if (filter === 'review_now') return needsReviewNow(row, payment)
  if (filter === 'historical') return isHistorical(row)
  if (filter === 'needs_attention') return needsReviewNow(row, payment)
  if (filter === 'conflict') return payment.conflict
  if (filter === 'stale') return payment.stale
  if (filter === 'source_complete') return payment.source.disposition === 'complete'
  if (filter === 'source_active') return payment.source.disposition === 'active'
  return true
}

export default function PaymentWorklist({ rows, locale = 'ar-EG-u-nu-latn', truncation = null }) {
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)

  const described = useMemo(
    () => rows.map((row) => ({ row, payment: describePayment(row) })),
    [rows]
  )
  const counts = useMemo(() => LANE_FILTERS.reduce((acc, lane) => {
    acc[lane.id] = described.filter(({ row, payment }) => matchesFilter(row, payment, lane.id)).length
    return acc
  }, {}), [described])

  const financialMetrics = useMemo(() => {
    let reviewNow = 0
    let historical = 0
    let complete = 0
    let unknown = 0

    described.forEach(({ row, payment }) => {
      if (isHistorical(row)) historical++
      if (needsReviewNow(row, payment)) reviewNow++
      if (payment.source.disposition === 'complete') complete++
      if (payment.source.disposition === 'unknown') unknown++
    })

    return { reviewNow, historical, complete, unknown }
  }, [described])

  const visible = described.filter(({ row, payment }) => matchesFilter(row, payment, filter))

  return (
    <section className="payment-worklist" aria-labelledby="payment-worklist-title">
      <h2 id="payment-worklist-title" className="visually-hidden">قائمة المدفوعات</h2>

      <div className="payment-worklist-intro">
        <div>
          <span className="payment-worklist-kicker">قائمة مراجعة المدفوعات</span>
          <h2>ابدأ بالسجلات الحالية، ثم راجع التاريخية عند الحاجة</h2>
          <p>لا نعرض مجموعًا ماليًا كأنه دين مؤكد. حالة البوابة هي المرجع، والسجلات القديمة تبقى منفصلة للمراجعة.</p>
        </div>
      </div>

      <div className="payment-kpi-grid">
        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-teal">✓</div>
          <div className="tax-kpi-label">للمراجعة الآن</div>
          <strong className="tax-kpi-value">{financialMetrics.reviewNow.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">سجلات من السنة الحالية والسابقة</span>
        </div>
        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-amber">⌛</div>
          <div className="tax-kpi-label">سجل تاريخي</div>
          <strong className="tax-kpi-value">{financialMetrics.historical.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">قبل السنة السابقة — لا يدخل في ملخص العمل</span>
        </div>
        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-green">✓</div>
          <div className="tax-kpi-label">حالتها غير محددة</div>
          <strong className="tax-kpi-value">{financialMetrics.unknown.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">تحتاج التحقق من المصدر</span>
        </div>
      </div>

      <div className="worklist-toolbar">
        <span className="worklist-count">
          <Filter size={14} aria-hidden="true" />
          {filter === 'all'
            ? `تعرض ${visible.length.toLocaleString(locale)} من ${described.length.toLocaleString(locale)} سجلًا`
            : `${visible.length.toLocaleString(locale)} يطابق «${LANE_FILTERS.find((lane) => lane.id === filter).label}» من ${described.length.toLocaleString(locale)}`}
        </span>
        <div className="worklist-filters" role="group" aria-label="تصفية قائمة المدفوعات">
          {LANE_FILTERS.map((lane) => (
            <button
              key={lane.id}
              type="button"
              className={`worklist-filter ${filter === lane.id ? 'is-active' : ''}`}
              aria-pressed={filter === lane.id}
              onClick={() => setFilter(lane.id)}
            >
              {lane.label}
              <span className="worklist-filter-count">{counts[lane.id].toLocaleString(locale)}</span>
            </button>
          ))}
        </div>
      </div>

      {truncation?.truncated && (
        <p className="record-truncation-notice" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          هذه القائمة محدودة بـ {truncation.limit.toLocaleString(locale)} صف، والمجموع المخزَّن {truncation.total.toLocaleString(locale)}. ما تراه ليس كل المدفوعات.
        </p>
      )}

      {!visible.length && (
        <p className="worklist-empty">
          {described.length
            ? 'لا سجلات مطابقة لهذا التصنيف.'
            : 'لا توجد مدفوعات مسجّلة بعد.'}
        </p>
      )}

      {Boolean(visible.length) && (
        <div className="worklist-table-wrap">
          <table className="worklist-table">
            <caption className="visually-hidden">
              المدفوعات: الشركة، المبلغ، موعد السداد، ما تقوله البوابة، وما سجّلته محليًا.
            </caption>
            <thead>
              <tr>
                <th scope="col">الشركة</th>
                <th scope="col">المبلغ</th>
                <th scope="col">موعد السداد</th>
                <th scope="col">ما تقوله البوابة</th>
                <th scope="col">مراجعتك المحلية</th>
                <th scope="col">المزامنة</th>
                <th scope="col"><span className="visually-hidden">تفاصيل</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, payment }) => {
                const open = expanded === row.id
                return [
                  <tr key={row.id} className={`${payment.conflict ? 'worklist-row is-conflict' : 'worklist-row'}${isHistorical(row) ? ' is-historical' : ''}`}>
                    <th scope="row" className="worklist-company" data-label="الشركة والمطالبة">
                      <span className="worklist-company-name company-name-full" title={row.company_name || ''}>
                        {row.company_name || 'غير معروفة'}
                      </span>
                      {row.claim_number && (
                        <div className="worklist-claim-row" dir="ltr">
                          <span className="worklist-claim">مطالبة #{row.claim_number}</span>
                          <button
                            type="button"
                            className="text-slate-400 hover:text-teal-600 transition-colors p-0.5 rounded cursor-pointer"
                            title="نسخ رقم المطالبة"
                            aria-label="نسخ رقم المطالبة"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigator.clipboard.writeText(String(row.claim_number))
                            }}
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      )}
                    </th>
                    <td className="worklist-amount" data-label="المبلغ">{formatAmount(row.amount, row.currency)}</td>
                    <td className="worklist-date" data-label="موعد السداد">
                      {row.due_date
                        ? <time dateTime={String(row.due_date).slice(0, 10)}>{String(row.due_date).slice(0, 10)}</time>
                        : <span className="worklist-unknown">غير مسجّل</span>}
                    </td>
                    <td data-label="حالة البوابة">
                      <span className={`worklist-lane ${payment.source.tone}`}>
                        {payment.source.disposition === 'unknown' && <AlertTriangle size={12} aria-hidden="true" />}
                        {payment.source.label}
                      </span>
                      {payment.source.raw && payment.source.disposition !== 'unknown' && (
                        <span className="worklist-lane-raw" dir="ltr">{payment.source.raw}</span>
                      )}
                    </td>
                    <td data-label="المراجعة المحلية">
                      <span className={`worklist-lane ${payment.local.tone}`}>{payment.local.label}</span>
                    </td>
                    <td className="worklist-sync" data-label="آخر مزامنة">
                      <SyncMeta value={row.company_last_synced_at} state={row.last_scan_state} locale={locale} />
                    </td>
                    <td className="worklist-actions">
                      <button
                        type="button"
                        className="worklist-expand"
                        aria-expanded={open}
                        aria-label={open ? `إخفاء تفاصيل السجل` : `عرض تفاصيل السجل`}
                        onClick={() => setExpanded(open ? null : row.id)}
                      >
                        {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                      </button>
                    </td>
                  </tr>,
                  open && (
                    <tr key={`${row.id}-detail`} className="worklist-detail-row">
                      <td colSpan={7}>
                        <div className="worklist-detail">
                          {Boolean(payment.flags.length) && (
                            <ul className="worklist-flags">
                              {payment.flags.map((flag) => (
                                <li key={flag.label} className={`worklist-flag ${flag.tone}`}>{flag.label}</li>
                              ))}
                            </ul>
                          )}
                          <dl className="worklist-detail-list">
                            <div><dt>حالة المصدر كما سُجّلت</dt><dd dir="ltr">{payment.source.raw || '—'}</dd></div>
                            <div><dt>حالة المراجعة المحلية</dt><dd dir="ltr">{payment.local.state}</dd></div>
                            <div><dt>بيانات المصدر قديمة؟</dt><dd>{payment.stale ? 'نعم' : 'لا'}</dd></div>
                            <div><dt>آخر مزامنة للشركة</dt><dd>{row.company_last_synced_at || 'لم تُسجَّل مزامنة'}</dd></div>
                          </dl>
                          <CopyCompanyName name={row.company_name} englishName={row.company_english_name} compact />
                          <p className="worklist-readonly-note">
                            هذه القائمة للقراءة فقط. التسجيل والسداد يتمّان في البوابة، وما تكتبه محليًا يُوسم «مراجعتك المحلية» ولا يُغيّر حالة البوابة.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
