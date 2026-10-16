'use client'

import { useEffect, useRef, useState } from 'react'
import { Mail, Send, X } from 'lucide-react'

/**
 * Plan 2.4 §3.3 — a channel is listed only when it can genuinely be used.
 * WhatsApp was removed rather than shown as "coming soon": a tile that
 * cannot work is a false affordance, and the plan allows no alternative.
 */
const channelInfo = [
  { id: 'email', title: 'Gmail', description: 'ملخصاتك وتنبيهاتك تصل إلى بريدك.', action: 'اربط بريدك' },
  { id: 'telegram', title: 'Telegram', description: 'تنبيهات خفيفة ومحادثة مباشرة مع مساعدك.', action: 'اربط بوتك' }
]

async function readResponse(response) {
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'تعذر إكمال الربط الآن.')
  return result
}

export default function ChannelCenter({
  channels,
  linkedRecipients,
  liveDeliveryReady,
  liveOn,
  whatsappAvailable = false,
  busy,
  onModeChange,
  onConnected
}) {
  const [modalChannel, setModalChannel] = useState('')
  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [whatsapp, setWhatsapp] = useState({ paired: false, pairingRequested: false, qr: '', available: whatsappAvailable })
  const [pairingError, setPairingError] = useState('')
  const [confirmDelivery, setConfirmDelivery] = useState(false)
  const modalRef = useRef(null)
  const deliveryConfirmRef = useRef(null)

  useEffect(() => {
    let active = true
    let timer
    const refresh = async () => {
      try {
        const state = await readResponse(await fetch('/api/channels', { cache: 'no-store' }))
        if (!active) return
        setWhatsapp(state.whatsapp)
        if (state.whatsapp.pairingRequested && !state.whatsapp.paired) {
          timer = setTimeout(refresh, 2500)
        }
      } catch {
        if (active) setPairingError('تعذر تحديث حالة ربط الهاتف.')
      }
    }
    void refresh()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!modalChannel) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const modal = modalRef.current
    const focusable = () => [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
    const initialFocus = modal.querySelector('input:not(:disabled)') || focusable()[0]
    initialFocus?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        closeConnect()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modalChannel])

  useEffect(() => {
    if (!confirmDelivery) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const modal = deliveryConfirmRef.current
    modal.querySelector('button:not(:disabled)')?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setConfirmDelivery(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = [...modal.querySelectorAll('button:not(:disabled)')]
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
        event.preventDefault()
        items[0].focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [confirmDelivery, busy])

  function openConnect(channel) {
    setError('')
    setEmail('')
    setSecret('')
    setModalChannel(channel)
  }

  function closeConnect() {
    setModalChannel('')
    setEmail('')
    setSecret('')
    setError('')
  }

  async function connect(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await readResponse(await fetch('/api/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(modalChannel === 'email'
          ? { channel: 'gmail', email, password: secret }
          : { channel: 'telegram', token: secret })
      }))
      closeConnect()
      try {
        await onConnected()
      } catch {
        setPairingError('تم الربط، لكن تعذر تحديث القائمة الآن.')
      }
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function pairWhatsApp() {
    setSubmitting(true)
    setPairingError('')
    try {
      const result = await readResponse(await fetch('/api/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: 'whatsapp', action: 'pair' })
      }))
      setWhatsapp(result.state.whatsapp)
      setPairingError('')
    } catch (caught) {
      setPairingError(caught.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="channel-experience" aria-labelledby="channels-title">
      <header className="channel-experience-heading">
        <div>
          <span className="channel-eyebrow">دائمًا على تواصل</span>
          <h2 id="channels-title">اختَر أين تصلك رسائلك</h2>
          <p>اربط قنواتك المفضلة، وابقَ قريبًا من كل جديد.</p>
        </div>
        <span className="channel-heading-mark" aria-hidden="true">✳</span>
      </header>

      <div className="channel-cards">
        {channelInfo.map((channel) => {
          const connected = Boolean(channels.find((item) => item.id === channel.id)?.configured)
          return (
            <article className={`channel-card-luxe ${connected ? 'is-connected' : ''}`} key={channel.id}>
              <div className={`channel-brand channel-brand-${channel.id}`} aria-hidden="true">
                {channel.id === 'email' ? <Mail size={23} strokeWidth={1.65} />
                  : <Send size={22} strokeWidth={1.65} />}
              </div>
              <div className="channel-card-copy">
                <div className="channel-card-title-row">
                  <h3>{channel.title}</h3>
                  <span className={`channel-connection ${connected ? 'connected' : ''}`}>
                    {connected ? 'متصلة' : 'جاهزة للربط'}
                  </span>
                </div>
                <p>{channel.description}</p>
                {!connected && (
                  <button
                    className="channel-connect-button"
                    type="button"
                    disabled={submitting}
                    onClick={() => openConnect(channel.id)}
                  >
                    {channel.action}
                    <span aria-hidden="true">←</span>
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {pairingError && <p className="channel-inline-note" role="status">{pairingError}</p>}

      <div className="delivery-preference">
        <div className="delivery-copy">
          <span className="delivery-kicker">على طريقتك</span>
          <h3>إرسال التنبيهات إلى قنواتك</h3>
          <p>{liveOn
            ? 'التنبيهات الجديدة تصل إلى المستلمين الذين اخترتهم.'
            : liveDeliveryReady
              ? 'الرسائل تبقى هنا حتى تختار إرسالها.'
              : 'أضف مستلمًا موثوقًا واربط قناة قبل تفعيل الإرسال.'}</p>
          <span className="delivery-recipient-count">{Number(linkedRecipients).toLocaleString('ar-EG')} مستلم موثوق</span>
        </div>
        <button
          type="button"
          className={`setting-switch channel-switch ${liveOn ? 'is-on' : ''}`}
          role="switch"
          aria-checked={liveOn}
          aria-label="إرسال التنبيهات إلى قنواتك"
          disabled={busy || (!liveOn && !liveDeliveryReady)}
          onClick={() => liveOn ? onModeChange(false) : setConfirmDelivery(true)}
        >
          <span />
        </button>
      </div>
      {!liveDeliveryReady && (
        <p className="delivery-safety-note"><span aria-hidden="true">✳</span> لن يغادر أي تنبيه مساحتك قبل تجهيز قناة ومستلم موثوق.</p>
      )}

      {confirmDelivery && (
        <div className="connect-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmDelivery(false)
        }}>
          <section ref={deliveryConfirmRef} className="connect-modal delivery-confirmation" role="dialog" aria-modal="true" aria-labelledby="delivery-confirm-title">
            <button className="connect-modal-close" type="button" aria-label="إغلاق" onClick={() => setConfirmDelivery(false)}>
              <X size={18} />
            </button>
            <span className="channel-brand channel-brand-whatsapp" aria-hidden="true"><Send size={22} /></span>
            <span className="channel-eyebrow">أنت من يختار</span>
            <h2 id="delivery-confirm-title">هل تريد إرسال التنبيهات؟</h2>
            <p className="connect-modal-description">
              ستصل التنبيهات الجديدة إلى {Number(linkedRecipients).toLocaleString('ar-EG')} مستلم موثوق عبر القنوات المرتبطة. يمكنك إيقاف الإرسال في أي وقت.
            </p>
            <div className="delivery-confirm-actions">
              <button className="button-secondary" type="button" disabled={busy} onClick={() => setConfirmDelivery(false)}>ليس الآن</button>
              <button className="connect-submit" type="button" disabled={busy} onClick={() => {
                setConfirmDelivery(false)
                onModeChange(true)
              }}>أوافق، فعّل الإرسال</button>
            </div>
          </section>
        </div>
      )}

      {modalChannel && (
        <div className="connect-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeConnect()
        }}>
          <section
            className="connect-modal"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-modal-title"
          >
            <button className="connect-modal-close" type="button" aria-label="إغلاق" onClick={closeConnect}>
              <X size={18} />
            </button>
            <span className={`channel-brand channel-brand-${modalChannel}`} aria-hidden="true">
              {modalChannel === 'email' ? <Mail size={23} /> : <Send size={22} />}
            </span>
            <span className="channel-eyebrow">خطوة واحدة وتصبح أقرب</span>
            <h2 id="connect-modal-title">{modalChannel === 'email' ? 'اربط بريد Gmail' : 'اربط بوت Telegram'}</h2>
            <p className="connect-modal-description">
              {modalChannel === 'email'
                ? 'نختبر الاتصال أولًا، ثم نحفظ بيانات الربط مشفّرة بحماية حساب Windows الخاص بك.'
                : 'نتحقق من رمز البوت مع Telegram قبل حفظه مشفّرًا بحماية حساب Windows الخاص بك.'}
            </p>
            <form className="connect-form" onSubmit={connect}>
              {modalChannel === 'email' && (
                <label>
                  <span>عنوان البريد</span>
                  <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" dir="ltr" />
                </label>
              )}
              <label>
                <span>{modalChannel === 'email' ? 'كلمة مرور التطبيق' : 'رمز البوت'}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={modalChannel === 'email' ? 12 : 20}
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={modalChannel === 'email' ? '•••• •••• •••• ••••' : 'أدخل الرمز بأمان'}
                  dir="ltr"
                />
              </label>
              {error && <p className="connect-form-error" role="alert">{error}</p>}
              <button className="connect-submit" type="submit" disabled={submitting}>
                {submitting ? 'جارٍ التحقق بأمان…' : 'تحقّق واربط'}
              </button>
            </form>
            <p className="connect-privacy">لا نعرض كلمة المرور مرة أخرى، ولا نرسلها إلا للخدمة التي اخترتها.</p>
          </section>
        </div>
      )}
    </section>
  )
}
