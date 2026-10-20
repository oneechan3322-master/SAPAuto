'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Building2, Mail, MailOpen } from 'lucide-react'
import identity from '../../domain/company-identity.cjs'
import { displayText } from '../../domain/display-text.cjs'
import { formatDateWith, numberLocaleFromCookie } from '../lib/digits-client.js'

const { UNREGISTERED_COMPANY_NAME, companyInitials: initialsOf } = identity

export default function MessagesView({ rows }) {
  const [messages, setMessages] = useState(rows)
  const [errors, setErrors] = useState({})
  const [busyId, setBusyId] = useState(null)
  const unreadCount = messages.filter((message) => !Number(message.is_read)).length

  async function markAsRead(id) {
    setBusyId(id)
    setErrors((current) => ({ ...current, [id]: '' }))
    try {
      const response = await fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: String(id) })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر تحديث حالة الرسالة.')
      setMessages((current) => current.map((message) => (
        message.id === id ? { ...message, is_read: 1 } : message
      )))
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: error.message || 'تعذر تحديث حالة الرسالة.' }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="messages-experience" aria-labelledby="messages-title">
      <header className="messages-heading">
        <div>
          <span className="messages-eyebrow">كل ما يهمك، في مكان واحد</span>
          <h1 id="messages-title">الرسائل</h1>
          <p>إشعاراتك وتحديثاتك مرتبة لتعود إليها في أي وقت.</p>
        </div>
        <div className="messages-summary" aria-label={`${messages.length} رسالة، ${unreadCount} غير مقروءة`}>
          <div><strong>{messages.length.toLocaleString(numberLocaleFromCookie())}</strong><span>رسالة</span></div>
          <i aria-hidden="true" />
          <div><strong>{unreadCount.toLocaleString(numberLocaleFromCookie())}</strong><span>تنتظر قراءتك</span></div>
        </div>
      </header>

      {!messages.length ? (
        <div className="messages-empty">
          <span className="messages-empty-mark" aria-hidden="true"><Mail size={23} strokeWidth={1.5} /></span>
          <h2>مساحتك هادئة الآن</h2>
          <p>ستظهر هنا الرسائل الجديدة عندما تصل.</p>
        </div>
      ) : (
        <ol className="message-stream" aria-label="قائمة الرسائل">
          {messages.map((message) => {
            const read = Boolean(Number(message.is_read))
            const title = cleanText(message.title) || 'لم يتم تسجيل عنوان الرسالة'
            const body = cleanText(message.body)
            const severity = severityStyle(message.source_severity ?? message.severity)

            return (
              <li className={`message-card ${read ? 'is-read' : 'is-unread'}`} key={message.id}>
                <span className={`message-accent message-accent-${severity.tone}`} aria-hidden="true" />
                <article>
                  <div className="message-card-heading">
                    <div className="message-title-group">
                      <span className={`message-state-icon ${read ? '' : 'message-state-unread'}`} aria-hidden="true">
                        {read ? <MailOpen size={17} strokeWidth={1.7} /> : <Mail size={17} strokeWidth={1.7} />}
                      </span>
                      <h2>{title}</h2>
                    </div>
                    <span className={`message-severity message-severity-${severity.tone}`} title={severity.label}>
                      <i aria-hidden="true" />
                      <span className="visually-hidden">{severity.label}</span>
                    </span>
                  </div>

                  <p className={`message-excerpt ${body ? '' : 'message-excerpt-empty'}`}>
                    {body || 'لم يتم تسجيل نص الرسالة في البيانات المستلمة.'}
                  </p>

                  {message.ai_action_required && (
                    <div style={{ margin: '8px 0 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: '6px',
                        background: message.ai_action_required.includes('عاجل') ? 'var(--overdue-soft)' : 'var(--info-soft)',
                        color: message.ai_action_required.includes('عاجل') ? 'var(--overdue)' : 'var(--info)',
                        border: `1px solid ${message.ai_action_required.includes('عاجل') ? 'var(--overdue-line)' : 'var(--info)'}`
                      }}>
                        ⚡ الإجراء المطلوب: {message.ai_action_required}
                      </span>
                    </div>
                  )}

                  <footer className="message-card-footer">
                    <time dateTime={validIsoDate(message.observed_at) || undefined} title={formatDateWith(message.observed_at, { dateStyle: 'full', timeStyle: 'short' })}>
                      {relativeDate(message.observed_at)}
                    </time>
                    {message.company_id ? (
                      <Link className="message-origin" href={`/companies/${encodeURIComponent(message.company_id)}`}>
                        {companyLabel(message)}
                      </Link>
                    ) : (
                      <span className="message-origin">{UNREGISTERED_COMPANY_NAME}</span>
                    )}
                    <span className={`message-sync ${isStale(message.company_last_synced_at, message.last_scan_state) ? 'is-stale' : ''}`}>
                      {syncLabel(message.company_last_synced_at, message.last_scan_state)}
                    </span>
                    {read ? (
                      <span className="message-read-state"><Check size={14} aria-hidden="true" /> تمت قراءتها</span>
                    ) : (
                      <button
                        className="message-read-button"
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => markAsRead(message.id)}
                      >
                        {busyId === message.id ? 'جارٍ الحفظ…' : 'وضع علامة كمقروءة'}
                      </button>
                    )}
                  </footer>
                  {errors[message.id] && <p className="message-action-error" role="alert">{errors[message.id]}</p>}
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function cleanText(value) {
  return displayText(value)
}

function companyLabel(message) {
  if (!message.company_known) {
    const href = message.company_id ? `/companies/${encodeURIComponent(message.company_id)}#set-company-name` : ''
    return (
      <span className="company-line-text">
        <span className="company-line-badge is-empty" aria-hidden="true"><Building2 size={14} strokeWidth={1.8} /></span>
        <span>{UNREGISTERED_COMPANY_NAME}</span>
        {message.company_name_origin === 'conflict' && (
          <span className="company-identity-warning">
            الاسم المحفوظ: {message.company_manual_name} · اسم البوابة: {message.company_portal_name}
          </span>
        )}
        {message.company_name_origin === 'unverified_mapping' && (
          <span className="company-identity-warning">اسم محفوظ يحتاج إلى تأكيد: {message.company_name_candidate}</span>
        )}
        {href && <Link className="company-set-link" href={href}>
          {message.company_name_origin === 'conflict' || message.company_name_origin === 'unverified_mapping' ? 'مراجعة الاسم' : 'تعيين اسم الشركة'}
        </Link>}
      </span>
    )
  }
  const name = message.company_name
  const englishName = message.company_english_name
  const full = englishName ? `${name} · ${englishName}` : name
  return (
    <span className="company-line-text">
      <span className="company-line-badge" aria-hidden="true">{initialsOf(name)}</span>
      <span className="company-name-full" title={full}>{full}</span>
      {message.company_name_origin === 'manual_verified' && <span className="company-origin-tag">أدخلته أنت</span>}
    </span>
  )
}

function severityStyle(value) {
  if (value === 'critical' || value === 'error') return { tone: 'urgent', label: 'تحتاج انتباهًا' }
  if (value === 'warning' || value === 'high') return { tone: 'attention', label: 'للمراجعة' }
  if (value === 'info') return { tone: 'calm', label: 'للعلم' }
  if (!value) return { tone: 'muted', label: 'الأهمية غير محددة في البيانات' }
  return { tone: 'calm', label: 'للعلم' }
}

function isStale(value, state) {
  if (state === 'failed' || state === 'parked') return true
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) || Date.now() - timestamp > 24 * 60 * 60 * 1000
}

function syncLabel(value, state) {
  if (state === 'scanning') return 'تجري المزامنة الآن'
  const timestamp = Date.parse(value)
  if (state === 'failed' || state === 'parked') {
    return Number.isNaN(timestamp)
      ? 'تعذرت المزامنة ولا توجد بيانات سابقة'
      : `تعذرت المزامنة؛ آخر بيانات ناجحة ${relativeDate(value)}`
  }
  if (Number.isNaN(timestamp)) return 'لم تُزامن بعد'
  return `آخر مزامنة ${relativeDate(value)}`
}

function validIsoDate(value) {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? '' : new Date(timestamp).toISOString()
}

function relativeDate(value) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'وقت الاستلام غير متاح'
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${minutes.toLocaleString(numberLocaleFromCookie())} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `قبل ${hours.toLocaleString(numberLocaleFromCookie())} ساعة`
  const days = Math.floor(hours / 24)
  if (days < 7) return `قبل ${days.toLocaleString(numberLocaleFromCookie())} يوم`
  return formatDateWith(timestamp, { dateStyle: 'medium' })
}
