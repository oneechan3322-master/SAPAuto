'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useMemo, useState } from 'react'
import {
  Building2, CalendarClock, ClipboardList, CreditCard, Mail, Radio, ShieldAlert
} from 'lucide-react'
import { formatDateWith, numberLocaleFromCookie } from '../lib/digits-client.js'

const fetcher = async (url) => {
  const response = await fetch(url, { cache: 'no-store' })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'تعذر تحميل معلوماتك الآن.')
  return value
}

/** At most seven prioritized items — never more, so the page stays a decision. */
const PRIORITY_LIMIT = 7

export default function MissionBoard() {
  const { data, error, isLoading } = useSWR('/api/status', fetcher, { refreshInterval: 10000 })
  const locale = numberLocaleFromCookie()
  const counts = data?.counts || {}

  const priority = useMemo(() => (data?.attention || []).slice(0, PRIORITY_LIMIT), [data])
  const today = formatDateWith(new Date(), { dateStyle: 'full' })
  const heartbeatAge = data?.harness?.last_heartbeat ? Date.now() - Date.parse(data.harness.last_heartbeat) : Infinity
  const harnessOnline = heartbeatAge < 180000
  const managerOnline = Boolean(data?.controls?.assistantManagerEnabled) && data?.assistantManager?.state === 'online'

  const cells = [
    {
      href: '/companies',
      label: 'شركاتك',
      value: counts.companies,
      hint: 'مساحاتك المرتبة',
      icon: Building2,
      accent: 'var(--accent)'
    },
    {
      href: '/tasks',
      label: 'مهام تنتظرك',
      value: counts.openTasks,
      hint: 'خطواتك القادمة',
      icon: ClipboardList,
      accent: 'var(--info)'
    },
    {
      href: '/obligations',
      label: 'التزامات متأخرة',
      value: counts.overdueObligations,
      hint: 'تجاوزت الموعد المسجل',
      icon: CalendarClock,
      accent: 'var(--overdue)'
    },
    {
      href: '/payments',
      label: 'مواعيد سداد قريبة',
      value: counts.dueSoonPayments,
      hint: 'خلال 7 أيام',
      icon: CreditCard,
      accent: 'var(--soon)'
    },
    {
      href: '/messages',
      label: 'رسائل تنتظر القراءة',
      value: counts.unreadMessages,
      hint: `${number(counts.newToday)} منها اليوم`,
      icon: Mail,
      accent: 'var(--done)'
    }
  ]

  return (
    <div className="dashboard">
      <header className="dashboard-heading">
        <div>
          <div className="eyebrow">مساحتك الخاصة</div>
          <h1>مكتب اليوم</h1>
          <p className="muted">{today} <span aria-hidden="true">·</span> نرتّب لك ما يستحق اهتمامك.</p>
        </div>
      </header>

      {error && <div className="notice-error" role="alert">{error.message}</div>}
      {isLoading && <div className="panel loading-state"><span className="loading-mark" />نجهّز مساحتك…</div>}

      {data && (
        <>
          <nav className="summary-strip" aria-label="ملخص سريع — اضغط للانتقال">
            {cells.map((cell) => (
              <Link
                className="summary-cell"
                href={cell.href}
                key={cell.href}
                style={{ '--cell-accent': cell.accent }}
              >
                <span className="summary-cell-label">
                  <cell.icon size={15} strokeWidth={1.8} aria-hidden="true" />
                  {cell.label}
                </span>
                <strong className="summary-cell-value">{number(counts && cell.value)}</strong>
                <span className="summary-cell-hint">{cell.hint}</span>
              </Link>
            ))}
          </nav>

          <section className="priority-panel" aria-labelledby="priority-title">
            <div className="priority-head">
              <div>
                <span className="eyebrow">مرتّب حسب الأولوية</span>
                <h2 id="priority-title">ما يحتاج انتباهك الآن</h2>
              </div>
              <span className="tag">
                {number(counts.attentionTotal ?? data.attention.length)} مفتوح · نعرض {number(priority.length)}
              </span>
            </div>

            {priority.length ? (
              <ul className="priority-list">
                {priority.map((item) => (
                  <PriorityItem item={item} key={item.key} />
                ))}
              </ul>
            ) : (
              <div className="empty-state">
                <strong>لا توجد تنبيهات مفتوحة</strong>
                <span>كل شيء هادئ الآن. سنعرض هنا ما يستحق اهتمامك فور وروده.</span>
              </div>
            )}
          </section>

          <div className="dashboard-columns">
            <section className="dashboard-card">
              <div className="card-heading">
                <div><div className="eyebrow">حالة النظام</div><h2>المتابعة والقنوات</h2></div>
                <Link href="/settings">خصّص ما يناسبك ←</Link>
              </div>
              <div className="service-list">
                <ServiceRow
                  name="متابعة البوابة"
                  state={harnessOnline ? 'تعمل' : 'غير متاحة'}
                  good={harnessOnline}
                />
                <ServiceRow
                  name="المساعد الآلي"
                  state={managerOnline ? 'إلى جانبك' : 'متوقف'}
                  good={managerOnline}
                />
                <ServiceRow
                  name="المزامنة التلقائية"
                  state={data.controls.automationEnabled
                    ? `كل ${data.controls.automationIntervalMin} دقيقة`
                    : 'متوقفة'}
                  good={data.controls.automationEnabled}
                />
                <ServiceRow
                  name="التنبيهات الخارجية"
                  state={data.controls.liveDeliveryReady ? 'جاهزة للإرسال' : 'تبقى داخل التطبيق'}
                  good={data.controls.liveDeliveryReady}
                />
              </div>
              {counts.failures > 0 && (
                <Link className="failure-link" href="/failures">
                  <ShieldAlert size={14} aria-hidden="true" />
                  {number(counts.failures)} أمر يحتاج مراجعة — عرض التفاصيل ←
                </Link>
              )}
            </section>

            <section className="dashboard-card">
              <div className="card-heading">
                <div><div className="eyebrow">لحظاتك الأخيرة</div><h2>ما جرى مؤخرًا</h2></div>
              </div>
              {data.events.length ? (
                <div className="activity-list">
                  {data.events.slice(0, 8).map((event) => (
                    <div className="activity-row" key={event.key}>
                      <span className="activity-symbol" aria-hidden="true"><Radio size={13} /></span>
                      <div className="activity-copy">
                        <span className="activity-text">{event.title}</span>
                        {event.companyName && (event.companyId ? (
                          <Link className="activity-company" href={`/companies/${encodeURIComponent(event.companyId)}`}>
                            {event.companyName}
                            {!event.companyKnown && ' · اسم غير مسجّل'}
                          </Link>
                        ) : <span className="activity-company">{event.companyName}</span>)}
                        {event.created_at && (
                          <time className="activity-time" dateTime={event.created_at}>
                            {formatDateWith(event.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
                          </time>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>لا شيء جديد حتى الآن</strong>
                  <span>ستظهر هنا التذكيرات والتنبيهات عند حدوثها.</span>
                </div>
              )}
            </section>
          </div>

          <p className="dashboard-footnote">
            {data.lastScannedAt
              ? `آخر مزامنة للبوابة: ${formatDateWith(data.lastScannedAt, { dateStyle: 'medium', timeStyle: 'short' })}.`
              : 'تظهر المعلومات بعد أول مراجعة تختارها.'}
            {counts.staleCompanies ? ` قد تكون بيانات ${number(counts.staleCompanies)} شركة قديمة.` : ''}
            {' '}نطّلع على البوابة دون تغيير، ولا ننفّذ رواتب أو مدفوعات.
          </p>
        </>
      )}
    </div>
  )
}

function PriorityItem({ item }) {
  const urgent = item.tone === 'urgent'
  const accent = urgent ? 'var(--overdue)' : 'var(--soon)'
  const soft = urgent ? 'var(--overdue-soft)' : 'var(--soon-soft)'
  const companyText = item.companyName || 'اسم غير مسجّل'
  return (
    <li
      className="priority-item"
      style={{ '--item-accent': accent, '--item-soft': soft }}
    >
      <i className="priority-rail" aria-hidden="true" />
      <div className="priority-copy">
        <span className="priority-title">{item.title}</span>
        {item.details && <span className="priority-detail">{item.details}</span>}
        {item.companyName && (
          item.companyId ? (
            <Link className="priority-company company-name-full" href={`/companies/${encodeURIComponent(item.companyId)}`} title={companyText}>
              {companyText}{!item.companyKnown ? ' · تعيين الاسم' : ''}
            </Link>
          ) : (
            <span className="priority-company company-name-full" title={companyText}>{companyText}</span>
          )
        )}
      </div>
      <div className="priority-meta">
        {item.label && <span className="priority-pill">{item.label}</span>}
        {item.updated_at && (
          <time className="priority-time" dateTime={item.updated_at} title={formatDateWith(item.updated_at, { dateStyle: 'full', timeStyle: 'short' })}>
            {relativeLabel(item.updated_at)}
          </time>
        )}
        <Link className={`priority-cta ${item.companyId ? 'is-secondary' : ''}`} href={item.href || '/settings'}>
          افتح
        </Link>
      </div>
    </li>
  )
}

function ServiceRow({ name, state, good }) {
  return (
    <div className="service-row">
      <div className="service-name">
        <i className={`status-light ${good ? 'healthy' : 'offline'}`} aria-hidden="true" />
        {name}
      </div>
      <span className="service-state">{state}</span>
    </div>
  )
}

function number(value) {
  const count = Number(value || 0)
  return (Number.isFinite(count) ? count : 0).toLocaleString(numberLocaleFromCookie())
}

function relativeLabel(value) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return '—'
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${number(minutes)} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `قبل ${number(hours)} ساعة`
  const days = Math.floor(hours / 24)
  if (days < 7) return `قبل ${number(days)} يوم`
  return formatDateWith(value, { dateStyle: 'medium' })
}