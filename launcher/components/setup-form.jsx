'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupForm() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.name, email: form.email, password: form.password })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر إنشاء المالك الأول.')
      router.replace('/')
      router.refresh()
    } catch (caught) {
      setError(caught.message || 'تعذر إنشاء المالك الأول.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page" dir="rtl">
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-eyebrow">SAPAuto · الإعداد الأول</span>
        <h1>أنشئ حساب المالك</h1>
        <p>سيكون هذا الحساب الوحيد الذي يملك صلاحية إدارة مساحة العمل.</p>
        <label>الاسم<input name="name" autoComplete="name" required minLength={2} maxLength={120} value={form.name} onChange={update} /></label>
        <label>البريد الإلكتروني<input name="email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={update} /></label>
        <label>كلمة مرور قوية<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={form.password} onChange={update} /></label>
        <label>تأكيد كلمة المرور<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={form.confirmPassword} onChange={update} /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button-primary" type="submit" disabled={busy}>{busy ? 'جارٍ الإعداد…' : 'إنشاء حساب المالك'}</button>
      </form>
    </main>
  )
}
