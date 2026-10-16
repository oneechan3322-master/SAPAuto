'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Filter } from 'lucide-react'
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
  { id: 'all', label: 'الكل' },
  { id: 'needs_attention', label: 'تحتاج انتباهك' },
  { id: 'conflict', label: 'تعارض' },
  { id: 'stale', label: 'بيانات قديمة' },
  { id: 'source_complete', label: 'مسدّدة في المصدر' },
  { id: 'source_active', label: 'مستحقة في المصدر' }
]

function matchesFilter(payment, filter) {
  if (filter === 'all') return true
  if (filter === 'needs_attention') return payment.conflict || payment.stale || payment.source.disposition !== 'active'
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
    acc[lane.id] = described.filter(({ payment }) => matchesFilter(payment, lane.id)).length
    return acc
  }, {}), [described])
  const visible = described.filter(({ payment }) => matchesFilter(payment, filter))

  return (
    <section className="payment-worklist" aria-labelledby="payment-worklist-title">
      <h2 id="payment-worklist-title" className="visually-hidden">قائمة المدفوعات</h2>

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
                  <tr key={row.id} className={payment.conflict ? 'worklist-row is-conflict' : 'worklist-row'}>
                    <th scope="row" className="worklist-company">
                      <span className="worklist-company-name company-name-full" title={row.company_name || ''}>
                        {row.company_name || 'غير معروفة'}
                      </span>
                      {row.company_english_name && (
                        <span className="worklist-company-english company-name-full" dir="ltr" title={row.company_english_name}>
                          {row.company_english_name}
                        </span>
                      )}
                      {row.claim_number && (
                        <span className="worklist-claim" dir="ltr">claim {row.claim_number}</span>
                      )}
                    </th>
                    <td className="worklist-amount">{formatAmount(row.amount, row.currency)}</td>
                    <td className="worklist-date">
                      {row.due_date
                        ? <time dateTime={String(row.due_date).slice(0, 10)}>{String(row.due_date).slice(0, 10)}</time>
                        : <span className="worklist-unknown">غير مسجّل</span>}
                    </td>
                    <td>
                      <span className={`worklist-lane ${payment.source.tone}`}>
                        {payment.source.disposition === 'unknown' && <AlertTriangle size={12} aria-hidden="true" />}
                        {payment.source.label}
                      </span>
                      {payment.source.raw && payment.source.disposition !== 'unknown' && (
                        <span className="worklist-lane-raw" dir="ltr">{payment.source.raw}</span>
                      )}
                    </td>
                    <td>
                      <span className={`worklist-lane ${payment.local.tone}`}>{payment.local.label}</span>
                    </td>
                    <td className="worklist-sync">
                      <SyncMeta value={row.company_last_synced_at} state={row.last_scan_state} locale={locale} />
                    </td>
                    <td>
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