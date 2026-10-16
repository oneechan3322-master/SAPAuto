'use client'

import { useState } from 'react'

export default function AssistantChat() {
  const [text, setText] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setReply(data.reply)
      setText('')
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }
  return <section className="panel stack">
    <p className="muted">المساعد يقرأ سجلات V8 وينفّذ الأدوات المصرح بها فقط. يستطيع Owner طلب مقترح تطوير برمجي عبر OpenCode عند تفعيل الميزة؛ يلزم تأكيد مستقل قبل الإرسال، ولا تُرسل بيانات الحسابات. راجع التغييرات قبل اعتمادها.</p>
    <form className="stack" onSubmit={submit}>
      <label>رسالتك<textarea value={text} onChange={(event) => setText(event.target.value)} rows="4" maxLength="4000" required /></label>
      <button disabled={busy}>{busy ? 'جارٍ التفكير…' : 'إرسال'}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {reply && <div className="panel" aria-live="polite">{reply}</div>}
  </section>
}
