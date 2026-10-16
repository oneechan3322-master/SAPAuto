'use client'

import useSWR from 'swr'
import { useState } from 'react'

const fetcher = async (url) => {
  const response = await fetch(url, { cache: 'no-store' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'تعذر تحميل مقترحات الترقية')
  return result
}

export default function CodeUpgradeProposals() {
  const { data, error, mutate } = useSWR('/api/code-proposals', fetcher, {
    refreshInterval: 15000,
    shouldRetryOnError: false
  })
  const [requestText, setRequestText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('')

  if (error) return <p className="error" role="alert">{error.message}</p>
  if (!data) return <p className="muted">جارٍ تحميل مقترحات الترقية…</p>

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setProblem('')
    setNotice('')
    try {
      const response = await fetch('/api/code-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: requestText })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر إنشاء المقترح')
      setRequestText('')
      setNotice('تم إنشاء المقترح؛ راجعه أدناه قبل اعتماد أي تغيير.')
      await mutate()
    } catch (caught) {
      setProblem(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function decide(proposal, decision) {
    setBusy(true)
    setProblem('')
    setNotice('')
    try {
      const response = await fetch(`/api/code-proposals/${encodeURIComponent(proposal.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر حفظ القرار')
      setNotice(decision === 'approved' ? 'تم اعتماد المقترح للمراجعة والتنفيذ اليدوي.' : 'تم رفض المقترح.')
      await mutate()
    } catch (caught) {
      setProblem(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel stack">
      <h2>مقترحات تطوير V8 عبر OpenCode</h2>
      <p className="muted">
        أرسل طلبات تطوير برمجية فقط. سيطّلع النموذج الخارجي على لقطة من ملفات المصدر البرمجية في V8 وطلبك؛
        لا تضع بيانات حسابات أو رواتب أو مستندات أو أسرار هنا. لا يستطيع OpenCode تعديل الملفات أو تشغيل أدوات.
        اعتماد المقترح لا يطبّق التغييرات تلقائياً؛ راجعها وطبّقها يدوياً.
      </p>
      {!data.available && <p className="error" role="status">إعداد OpenCode غير مكتمل؛ راجع OPENCODE_BIN وV8_OPENCODE_MODEL وتسجيل الدخول إلى OpenCode.</p>}
      {!data.enabled && <p className="muted">المقترحات متوقفة. يستطيع Owner تفعيلها من الإعدادات بعد مراجعة تنبيه الخصوصية.</p>}
      {data.enabled && data.available && <form className="form" onSubmit={submit}>
        <label>طلب تطوير برمجي<textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} rows="4" maxLength="1500" required /></label>
        <button disabled={busy || !requestText.trim()}>{busy ? 'جارٍ طلب المقترح…' : 'طلب مقترح من OpenCode'}</button>
      </form>}
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {data.proposals.map((proposal) => (
        <article className="panel stack" key={proposal.id}>
          <div className="between">
            <strong>{proposal.status === 'pending' ? 'بانتظار مراجعة Owner' : proposal.status === 'approved' ? 'معتمد للمراجعة اليدوية' : 'مرفوض'}</strong>
            <small>{proposal.created_at}</small>
          </div>
          <p><strong>الطلب:</strong> {proposal.request}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{proposal.proposal}</pre>
          {proposal.status === 'pending' && <div className="row">
            <button disabled={busy} onClick={() => decide(proposal, 'rejected')}>رفض المقترح</button>
            <button disabled={busy} onClick={() => decide(proposal, 'approved')}>اعتماد للمراجعة اليدوية</button>
          </div>}
        </article>
      ))}
    </section>
  )
}
