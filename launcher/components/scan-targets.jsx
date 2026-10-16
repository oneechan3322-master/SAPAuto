'use client'

import useSWR from 'swr'
import { useState } from 'react'

const targetsFetcher = async (url) => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error((await response.json()).error || 'تعذر تحميل الحسابات')
  return response.json()
}

export default function ScanTargets() {
  const { data: targets, error, mutate } = useSWR('/api/accounts', targetsFetcher, { revalidateOnFocus: true })
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  async function scan(event, target) {
    event.preventDefault()
    setBusy(target.key)
    setMessage('')
    try {
      const response = await fetch('/api/assistant/confirmations', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolName: 'scan_now', args: { account: target.key } })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر طلب تأكيد الفحص')
      setMessage(`تم إنشاء طلب فحص ${target.label}. راجعه ووافق عليه من الإجراءات المعلقة.`)
    } catch (caught) {
      setMessage(caught.message)
    } finally {
      setBusy('')
      await mutate()
    }
  }

  return (
    <section className="panel stack">
      <h2>فحص الحسابات المحددة</h2>
      <p className="muted">يتحقق النظام من إعداد الحساب، ثم ينتظر موافقتك من الإجراءات المعلقة قبل إضافة الفحص إلى قائمة الانتظار.</p>
      {error && <p className="error" role="alert">{error.message}</p>}
      {message && <p role="status">{message}</p>}
      <div className="actions">
        {(targets || [
          { key: 'ZETA_MCFAPP', label: 'ZETA MCFAPP', configured: false },
          { key: 'ZMCF_PAYROLL', label: 'ZMCF PAYROLL', configured: false }
        ]).map((target) => (
          <form key={target.key} onSubmit={(event) => scan(event, target)}>
            <button className="big-button" disabled={!target.configured || Boolean(busy)}>
              <strong>{target.label}</strong>
              <span>{busy === target.key ? 'جارٍ الإرسال…' : target.configured ? 'طلب فحص هذا الحساب' : 'الحساب غير موجود في SAPAuto3'}</span>
            </button>
          </form>
        ))}
      </div>
    </section>
  )
}
