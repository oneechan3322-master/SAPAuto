'use client'

import useSWR from 'swr'

const readBoard = (url) => fetch(url, { cache: 'no-store' }).then(async (response) => {
  if (!response.ok) throw new Error('الرابط غير صالح أو تعذر الاتصال')
  return response.json()
})

export default function KioskBoard({ token }) {
  const url = token ? `/api/kiosk?token=${encodeURIComponent(token)}` : null
  const { data, error } = useSWR(url, readBoard, { refreshInterval: 5000 })
  const status = data?.harness || {}
  const online = status.last_heartbeat && Date.now() - Date.parse(status.last_heartbeat) < 180000

  if (!token) {
    return (
      <section className="panel kiosk-empty">
        <span className="company-empty-mark" aria-hidden="true">✳</span>
        <h1>شاشة العرض غير مفعّلة</h1>
        <p>هذه الشاشة مخصّصة لعرض آمن. استخدم رابط العرض الذي أُعدّ لهذا الجهاز.</p>
      </section>
    )
  }
  if (error) return <section className="panel"><h1>تعذّر تحديث شاشة العرض</h1><p>تحقق من الاتصال أو افتح رابط العرض الآمن من جديد.</p></section>
  if (!data) return <div className="panel loading-state"><span className="loading-mark" />نجهّز شاشة العرض…</div>

  return <div className="stack">
    <div className="between"><h1>لوحة SAPAuto</h1><span className="row"><i className={`status-light ${online ? 'healthy' : 'offline'}`} />{online ? 'النظام متصل' : 'المحرك غير متصل'}</span></div>
    <section className="grid grid-4">
      <article className="panel"><p className="muted">الحسابات التي تمت مراجعتها</p><div className="metric">{formatCount(status.account_index)} / {formatCount(status.account_total)}</div><p>{status.current_company || 'لا توجد مراجعة جارية'}</p></article>
      <article className="panel"><p className="muted">وصلت اليوم</p><div className="metric">{formatCount(data.counts.newToday)}</div></article>
      <article className="panel"><p className="muted">مواعيد تحتاج مراجعة</p><div className="metric">{formatCount(data.counts.overdue)}</div></article>
      <article className="panel"><p className="muted">مراجعات لم تكتمل</p><div className="metric">{formatCount(data.counts.failures)}</div></article>
    </section>
    <section className="panel">
      <h2>آخر التحديثات</h2>
      {data.events.length ? (
        <div className="log">{data.events.map((event, index) => (
          <div key={`${event.created_at}-${index}`}>
            <strong>{event.title}</strong>
            <span>{event.companyName}</span>
            <time dateTime={validDate(event.created_at)}>{formatDate(event.created_at)}</time>
          </div>
        ))}</div>
      ) : <p className="muted">لا توجد تحديثات محفوظة بعد.</p>}
    </section>
  </div>
}

function formatCount(value) {
  if (value === null || value === undefined || value === '') return 'غير متاح'
  const count = Number(value)
  return Number.isFinite(count) ? count.toLocaleString('ar-EG') : 'غير متاح'
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'وقت التحديث غير متاح'
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo'
  }).format(date)
}

function validDate(value) {
  return Number.isNaN(Date.parse(value)) ? undefined : new Date(value).toISOString()
}
