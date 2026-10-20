'use client'

import { useState } from 'react'

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

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), password })
      })
      if (!response.ok) {
        let message = 'فشل تسجيل الدخول. تأكد من البريد وكلمة المرور.'
        try {
          const payload = await response.json()
          if (payload?.message) message = payload.message
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

  return (
    <main
      dir="rtl"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--canvas)',
        padding: 24
      }}
    >
      <form
        onSubmit={submit}
        dir="rtl"
        style={{
          width: 'min(380px, 100%)',
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
          <span style={{ fontSize: 15, color: 'var(--text-3)' }}>
            ساب-أوتو
          </span>
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text)' }}>
            تسجيل الدخول
          </h1>
        </div>

        <label style={{ display: 'grid', gap: 6, fontSize: 14, color: 'var(--text-2)' }}>
          البريد الإلكتروني
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 14, color: 'var(--text-2)' }}>
          كلمة المرور
          <input
            type="password"
            autoComplete="current-password"
            required
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
            background: busy ? 'var(--text-3)' : 'var(--text)',
            color: 'var(--accent-ink)',
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer'
          }}
        >
          {busy ? 'جارٍ التحقق…' : 'دخول'}
        </button>
      </form>
    </main>
  )
}
