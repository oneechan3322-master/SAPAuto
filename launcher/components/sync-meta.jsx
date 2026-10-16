/**
 * The sync label is shared so every surface says the same thing and carries the
 * exact timestamp on hover (Plan 2.4 §6.1: "last sync" must never be a vague
 * "last check"). Extracted here so the payment worklist and the record cards
 * cannot drift apart.
 */

function exactTimestamp(value, locale = 'ar-EG-u-nu-latn') {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return ''
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'full', timeStyle: 'medium'
  }).format(timestamp)
}

function relativeDate(value, locale = 'ar-EG-u-nu-latn') {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return ''
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const days = Math.round((timestamp - Date.now()) / 86400000)
  if (Math.abs(days) >= 1) return rtf.format(days, 'day')
  const hours = Math.round((timestamp - Date.now()) / 3600000)
  if (Math.abs(hours) >= 1) return rtf.format(hours, 'hour')
  return rtf.format(Math.round((timestamp - Date.now()) / 60000), 'minute')
}

export { exactTimestamp, relativeDate }

export default function SyncMeta({ value, state, locale }) {
  const exact = value ? exactTimestamp(value, locale) : ''
  if (state === 'scanning') return <span className="record-sync-meta">تجري المزامنة الآن</span>
  if (state === 'failed' || state === 'parked') {
    return (
      <span className="record-sync-meta is-stale" title={exact}>
        {value ? `تعذرت المزامنة؛ آخر بيانات ناجحة ${relativeDate(value, locale)}` : 'تعذرت المزامنة ولا توجد بيانات سابقة'}
      </span>
    )
  }
  if (!value) return <span className="record-sync-meta">لم تُزامن بعد</span>
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return <span className="record-sync-meta">وقت المزامنة غير متاح</span>
  const age = Math.max(0, Date.now() - timestamp)
  const stale = age > 24 * 60 * 60 * 1000
  return (
    <span className={`record-sync-meta ${stale ? 'is-stale' : ''}`} title={`وقت آخر مزامنة للبوابة: ${exact}`}>
      {stale ? 'آخر مزامنة' : 'تمت المزامنة'} {relativeDate(value, locale)}
    </span>
  )
}