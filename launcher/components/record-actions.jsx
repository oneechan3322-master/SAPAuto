'use client'

import { useState } from 'react'

export default function RecordActions({ section, id, accountKey }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(path, body) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر تنفيذ الإجراء')
      setMessage('تم')
      location.reload()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  let action = null
  if (section === 'tasks') action = () => send('/api/tasks/done', { id })
  if (section === 'obligations') action = () => send('/api/obligations/done', { id })
  if (section === 'payments') action = () => send('/api/payments/paid', { id })
  if (section === 'messages') action = () => send('/api/messages/read', { id })
  if (section === 'reports') action = () => send('/api/commands', { type: 'send_report_now', payload: { reportId: id } })
  if (section === 'failures') return <span>
    <button disabled={busy} onClick={() => send('/api/commands', { type: 'retry_account', payload: { account: accountKey } })}>إعادة المحاولة</button>{' '}
    <button disabled={busy} onClick={() => send('/api/commands', { type: 'unpark_account', payload: { account: accountKey } })}>إلغاء الإيقاف</button>
    {message && <small className="muted"> {message}</small>}
  </span>
  if (!action) return null
  return <span><button disabled={busy} onClick={action}>{busy ? 'جارٍ التنفيذ…' : 'تنفيذ'}</button>{message && <small className="muted"> {message}</small>}</span>
}
