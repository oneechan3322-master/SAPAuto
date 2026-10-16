'use client'

import useSWR from 'swr'
import { useState } from 'react'

const fetcher = async (url) => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error((await response.json()).error || 'تعذر تحميل طلبات التأكيد')
  return response.json()
}

const labels = {
  scan_now: 'طلب فحص',
  save_note: 'حفظ ملاحظة',
  add_task: 'إضافة مهمة',
  add_reminder: 'إضافة تذكير',
  mark_obligation_done: 'تحديث حالة التزام',
  send_report: 'إرسال تقرير',
  request_code_upgrade: 'إرسال طلب تطوير برمجي إلى OpenCode'
}

export default function PendingConfirmations() {
  const { data, error, mutate } = useSWR('/api/assistant/confirmations', fetcher, {
    refreshInterval: 5000,
    shouldRetryOnError: false
  })
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  if (error?.message?.includes('Authentication required')) return null
  if (error || !data?.length) return null

  async function decide(action, confirm) {
    setBusy(action.id)
    setNotice('')
    try {
      const response = await fetch(`/api/assistant/confirmations/${encodeURIComponent(action.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر تنفيذ القرار')
      setNotice(confirm ? `تم تنفيذ ${labels[action.tool_name] || action.tool_name}.` : 'تم رفض الطلب.')
      await mutate()
    } catch (caught) {
      setNotice(caught.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="panel stack" aria-live="polite">
      <div className="between"><h2>طلبات تنتظر موافقتك</h2><span className="tag">{data.length}</span></div>
      {data.map((action) => (
        <div className="between" key={action.id}>
          <div><strong>{labels[action.tool_name] || action.tool_name}</strong><p className="muted">{JSON.stringify(action.args)}</p><small>تنتهي: {action.expires_at}</small></div>
          <div className="row">
            <button disabled={Boolean(busy)} onClick={() => decide(action, false)}>رفض</button>
            <button disabled={Boolean(busy)} onClick={() => decide(action, true)}>{busy === action.id ? 'جارٍ التنفيذ…' : 'تأكيد'}</button>
          </div>
        </div>
      ))}
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
