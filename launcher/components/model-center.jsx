'use client'

import { useEffect, useState } from 'react'

async function post(action, payload = {}) {
  const res = await fetch('/api/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل تنفيذ الإجراء.')
  return data
}

export default function ModelCenter() {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [dlUrl, setDlUrl] = useState('')
  const [dlName, setDlName] = useState('')

  const load = () => {
    fetch('/api/models').then(async (r) => {
      const data = await r.json()
      if (r.ok) setState(data)
      else setError(data.error || 'تعذر تحميل حالة النماذج.')
    }).catch((e) => setError(String(e.message || e)))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [])

  const run = async (action, payload, label) => {
    setBusy(action); setError(''); setNotice('')
    try {
      const result = await post(action, payload)
      setNotice(label || 'تم.')
      if (result?.error) setError(result.error)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy('')
      load()
    }
  }

  if (!state) {
    return <div style={{ padding: 24, color: '#9fb4c7', direction: 'rtl' }}>
      {error || 'جارٍ تحميل مركز النماذج…'}
    </div>
  }

  const bar = state.progress && state.progress.state === 'running'
    ? `${state.progress.pct}%`
    : null

  return (
    <div style={{ direction: 'rtl', padding: '24px', maxWidth: 900, margin: '0 auto', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4, color: '#e8eef4' }}>مركز النماذج</h1>
      <p style={{ color: '#9fb4c7', fontSize: 13, marginBottom: 18 }}>
        اختر النموذج النشط، طبّق، أو نزّل ترقية جديدة — كل شيء من هنا بدون أي تعديل ملفات.
      </p>

      <div style={{ fontSize: 12, color: '#9fb4c7', marginBottom: 14 }}>
        مجلد النماذج: <code style={{ color: '#c9d6e2' }}>{state.modelHome}</code><br />
        llama.cpp (llama-server.exe): {state.llamaServerPresent
          ? <span style={{ color: '#7bd88f' }}>متوفر ✓</span>
          : <span>غير مثبّت بعد — القياس وترقية llama.cpp تُعدّل الأرقام لاحقاً</span>}
        {state.heartbeat ? <> — حالة خدمة النموذج: <b style={{ color: '#7bd88f' }}>{state.heartbeat.status}</b></> : null}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {state.models.map((m) => (
          <div key={m.key}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              border: m.selected ? '1px solid #7bd88f' : '1px solid #2b3a47',
              borderRadius: 10, padding: '12px 14px', background: m.selected ? 'rgba(123,216,143,.06)' : 'rgba(20,28,36,.5)'
            }}>
            <div>
              <div style={{ fontWeight: 700, color: m.selected ? '#7bd88f' : '#e8eef4' }}>
                {m.label}{m.serverPc ? ' (لجهاز الخادم)' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#9fb4c7' }}>
                {m.present ? `موجود — ${m.sizeGB} جيجابايت` : 'غير موجود على هذا الجهاز بعد'}
                {m.manual ? ' (ملف يدوي)' : ''} · {m.file}
              </div>
            </div>
            {m.present && !m.selected && (
              <button
                onClick={() => run('select', { file: m.file }, 'تم الاختيار — يصبح نشطاً بعد الضغط على «تطبيق».')}
                disabled={busy === 'select'}
                style={{ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid #2b3a47', background: '#18222c', color: '#e8eef4' }}>
                اختيار
              </button>
            )}
            {m.selected && <span style={{ color: '#7bd88f', fontWeight: 700 }}>النموذج النشط</span>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => run('apply', {}, 'تم تطبيق النموذج — إعادة تشغيل خدمة النموذج جارية…')}
          disabled={Boolean(busy)}
          style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #7bd88f', background: '#12261a', color: '#7bd88f', fontWeight: 700, cursor: 'pointer' }}>
          {busy === 'apply' ? '…جارٍ التطبيق' : 'تطبيق (إعادة تشغيل خدمة النموذج)'}
        </button>
        <button
          onClick={() => run('bench', {}, 'القياس يعمل في الخلفية — النتائج ستظهر أسفل الصفحة إن توفر llama.cpp والذاكرة.')}
          disabled={Boolean(busy)}
          style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #2b3a47', background: '#18222c', color: '#e8eef4', cursor: 'pointer' }}>
          {busy === 'bench' ? '…جارٍ القياس' : 'تشغيل قياس الأداء'}
        </button>
      </div>

      <div style={{ marginTop: 20, border: '1px solid #2b3a47', borderRadius: 10, padding: 14, background: 'rgba(20,28,36,.5)' }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: '#e8eef4' }}>ترقية نموذج جديد (تحميل من رابط)</div>
        <div style={{ fontSize: 12, color: '#9fb4c7', marginBottom: 10 }}>
          الصق رابط https مباشر لملف GGUF واسم الملف — يُحمّل بالخلفية مع شريط تقدم، ويُرفض أي ملف أصغر من جيجابايت.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={dlUrl} onChange={(e) => setDlUrl(e.target.value)} placeholder="https://…/model.gguf"
            style={{ flex: 2, minWidth: 260, padding: 8, borderRadius: 8, border: '1px solid #2b3a47', background: '#101820', color: '#e8eef4' }} />
          <input value={dlName} onChange={(e) => setDlName(e.target.value)} placeholder="اسم الملف.gguf"
            style={{ flex: 1, minWidth: 170, padding: 8, borderRadius: 8, border: '1px solid #2b3a47', background: '#101820', color: '#e8eef4' }} />
          <button
            onClick={() => run('download', { url: dlUrl, file: dlName }, 'بدأ التحميل — العدّاد أدناه.')}
            disabled={busy === 'download' || !dlUrl || !dlName}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #2b3a47', background: '#18222c', color: '#e8eef4', cursor: 'pointer' }}>
            تحميل
          </button>
        </div>
        {state.progress && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#9fb4c7' }}>
            {state.progress.state === 'running' && <>
              <div style={{ background: '#101820', borderRadius: 6, height: 12, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ width: `${state.progress.pct || 0}%`, height: '100%', background: '#7bd88f' }} />
              </div>
              {state.progress.pct}% — {(state.progress.received / 1073741824).toFixed(2)} / {state.progress.total ? (state.progress.total / 1073741824).toFixed(2) + ' جيجا' : 'الحجم غير معروف'}
              <button onClick={() => run('cancel-download', {}, 'طلبت الإلغاء — سيتوقف عند التدفق التالي.')}
                disabled={busy === 'cancel-download'}
                style={{ marginRight: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid #b26b6b', background: 'transparent', color: '#e79d9d', cursor: 'pointer' }}>
                إلغاء
              </button>
            </>}
            {state.progress.state === 'done' && <span style={{ color: '#7bd88f' }}>اكتمل تحميل {state.progress.file} — بقي اختياره والضغط على «تطبيق».</span>}
            {state.progress.state === 'error' && <span style={{ color: '#e79d9d' }}>فشل: {state.progress.error}</span>}
            {state.progress.state === 'cancelled' && <span>أُلغي التحميل.</span>}
            {state.progress.state === 'starting' && <span>…يبدأ التحميل</span>}
          </div>
        )}
      </div>

      {state.bench.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#e8eef4' }}>آخر قياسات الأداء</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#c9d6e2' }}>
            <thead><tr style={{ color: '#9fb4c7' }}>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>النموذج</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>الخيوط</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>استيعاب (كلمة/ث)</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>توليد (كلمة/ث)</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>التاريخ</th>
            </tr></thead>
            <tbody>
              {state.bench.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #22303c' }}>
                  <td style={{ padding: '4px 8px' }}>{String(r.model).replace('.gguf', '')}</td>
                  <td style={{ padding: '4px 8px' }}>{r.threads}</td>
                  <td style={{ padding: '4px 8px' }}>{r.prompt_tok_per_s}</td>
                  <td style={{ padding: '4px 8px' }}>{r.gen_tok_per_s}</td>
                  <td style={{ padding: '4px 8px', direction: 'ltr' }}>{String(r.measured_at).slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notice && <div style={{ marginTop: 14, color: '#7bd88f', fontSize: 13 }}>{notice}</div>}
      {error && <div style={{ marginTop: 8, color: '#e79d9d', fontSize: 13 }}>{error}</div>}
    </div>
  )
}
