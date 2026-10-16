'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, callbackURL: '/' })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || result.error || 'تعذر تسجيل الدخول. تحقق من البيانات وحاول مجددًا.')
      router.replace('/')
      router.refresh()
    } catch (caught) {
      setError(caught.message || 'تعذر تسجيل الدخول. تحقق من البيانات وحاول مجددًا.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page" dir="rtl">
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-eyebrow">SAPAuto · مساحة العمل</span>
        <h1>مرحبًا بعودتك</h1>
        <p>سجّل الدخول للمتابعة إلى مساحة العمل المحلية.</p>
        <label>البريد الإلكتروني<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>كلمة المرور<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button-primary" type="submit" disabled={busy}>{busy ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}</button>
      </form>
    </main>
  )
}
