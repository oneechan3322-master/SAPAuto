'use client'

import { useEffect, useState } from 'react'

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  fontSize: 15,
  background: 'var(--surface-inset)',
  color: 'var(--text)'
}

export default function SetupPage() {
  const [state, setState] = useState('loading')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/setup', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return
        if (data?.setupRequired) setState('required')
        else window.location.href = '/login'
      })
      .catch(() => {
        if (!cancelled) {
          setState('unavailable')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (password.length < 12) {
      setError('كلمة المرور يجب أن تكون 12 حرفًا على الأقل.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password })
      })
      if (!response.ok) {
        let message = 'تعذر إنشاء المالك الأول. حاول مجددًا.'
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch {}
        setError(message)
        setBusy(false)
        return
      }
      window.location.href = '/'
    } catch {
      setError('تعذر الوصول إلى الخادم. حاول مجددًا.')
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return (
      <main
        dir="rtl"
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)', color: 'var(--text-3)' }}
      >
        جارٍ التحقق من حالة الإعداد…
      </main>
    )
  }

  if (state === 'unavailable') {
    return (
      <main
        dir="rtl"
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)', color: 'var(--overdue)', padding: 24 }}
      >
        تعذر الوصول إلى الخادم. حاول تحديث الصفحة.
      </main>
    )
  }

  return (
    <main
      dir="rtl"
      style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)', padding: 24 }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 'min(400px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 28,
          display: 'grid',
          gap: 14,
          boxShadow: 'var(--shadow-2)'
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 15, color: 'var(--text-3)' }}>ساب-أوتو</span>
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text)' }}>إعداد المالك الأول</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
            بيانات المالك تبقى على جهازك — لا يُرسل أي شيء إلى خدمة خارجية.
          </p>
        </div>

        <label style={{ display: 'grid', gap: 6, fontSize: 14, color: 'var(--text-2)' }}>
          الاسم
          <input
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 14, color: 'var(--text-2)' }}>
          البريد الإلكتروني
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 14, color: 'var(--text-2)' }}>
          كلمة المرور (12 حرفًا على الأقل)
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={inputStyle}
          />
        </label>

        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: 14, color: 'var(--overdue)' }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '11px 16px',
            borderRadius: 10,
            border: 'none',
            background: busy ? 'var(--text-3)' : 'var(--accent)',
            color: 'var(--accent-ink)',
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer'
          }}
        >
          {busy ? 'جارٍ الإنشاء…' : 'إنشاء المالك'}
        </button>
      </form>
    </main>
  )
}
