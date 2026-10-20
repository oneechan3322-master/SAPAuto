'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Mail, Send, Check, AlertCircle, Trash2, Edit3, Save } from 'lucide-react'

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export default function ApiKeysManager() {
  const [form, setForm] = useState({
    resendKeys: '',
    recipientEmail: 'ramygalal235@gmail.com',
    senderEmail: 'onboarding@resend.dev',
    mistralKeys: '',
    mistralModel: 'mistral-small-latest'
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch('/api/settings/keys')
      setForm(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(e) {
    if (e) e.preventDefault()
    setError('')
    setNotice('')
    setSaving(true)
    try {
      await apiFetch('/api/settings/keys', {
        method: 'PUT',
        body: JSON.stringify(form)
      })
      setNotice('تم حفظ وتحديث مفاتيح API وإعدادات البريد بنجاح')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSendTest() {
    setError('')
    setNotice('')
    setSending(true)
    try {
      const res = await apiFetch('/api/settings/keys', {
        method: 'POST',
        body: JSON.stringify({ to: form.recipientEmail })
      })
      setNotice(`تم إرسال التقرير فوراً إلى ${form.recipientEmail} بنجاح! معرف الرسالة: ${res.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function handleClearKey(field) {
    setForm(prev => ({ ...prev, [field]: '' }))
  }

  return (
    <section className="settings-section panel" dir="rtl" style={{ marginBlockEnd: 'var(--s-4)' }}>
      <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <span className="section-index">06</span>
          <div>
            <h2 style={{ margin: 0 }}>مفاتيح الربط السحابي والبريد (API Keys)</h2>
            <p className="muted" style={{ margin: 0 }}>
              إدارة مفاتيح Resend و Mistral ومستلمي التقارير مع إمكانية التعديل والإرسال الفوري
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSendTest}
          disabled={sending || saving || !form.resendKeys}
          style={styles.btnSend}
          title="إرسال تقرير فوري إلى البريد المسجل"
        >
          <Send size={15} />
          <span>{sending ? 'جارٍ الإرسال…' : 'إرسال تقرير تجريبي'}</span>
        </button>
      </div>

      {notice && (
        <div className="notice-success" role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="notice-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSave} style={{ display: 'grid', gap: 'var(--s-4)', marginTop: 8 }}>
        <div style={styles.grid}>
          {/* Resend Keys */}
          <div style={styles.card}>
            <div style={styles.cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={16} color="var(--accent)" />
                <strong>مفاتيح Resend API</strong>
              </div>
              {form.resendKeys && (
                <button
                  type="button"
                  onClick={() => handleClearKey('resendKeys')}
                  style={styles.clearBtn}
                  title="مسح المفاتيح"
                >
                  <Trash2 size={13} />
                  <span>مسح</span>
                </button>
              )}
            </div>
            <textarea
              style={styles.textarea}
              rows={2}
              value={form.resendKeys}
              onChange={(e) => setForm(p => ({ ...p, resendKeys: e.target.value }))}
              placeholder="re_xxxxxxxxxxxxxx (يمكن إضافة أكثر من مفتاح مفصولين بفاصلة)"
              disabled={saving}
            />
            <span style={styles.hint}>يدعم مفتاحاً واحداً أو عدة مفاتيح للتبديل التلقائي في حال الفشل.</span>
          </div>

          {/* Email Recipients */}
          <div style={styles.card}>
            <div style={styles.cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={16} color="var(--info)" />
                <strong>إعدادات البريد المستلم والمرسل</strong>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>البريد المستلم:</span>
                <input
                  style={styles.input}
                  value={form.recipientEmail}
                  onChange={(e) => setForm(p => ({ ...p, recipientEmail: e.target.value }))}
                  placeholder="ramygalal235@gmail.com"
                  disabled={saving}
                />
              </label>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>البريد المرسل (From):</span>
                <input
                  style={styles.input}
                  value={form.senderEmail}
                  onChange={(e) => setForm(p => ({ ...p, senderEmail: e.target.value }))}
                  placeholder="onboarding@resend.dev"
                  disabled={saving}
                />
              </label>
            </div>
          </div>

          {/* Mistral Keys */}
          <div style={{ ...styles.card, gridColumn: '1 / -1' }}>
            <div style={styles.cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={16} color="var(--soon)" />
                <strong>مفاتيح Mistral API (احتياطي فقط)</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 'var(--t-2xs)', color: 'var(--text-3)' }}>
                  النموذج: <code style={styles.code}>{form.mistralModel}</code>
                </span>
                {form.mistralKeys && (
                  <button
                    type="button"
                    onClick={() => handleClearKey('mistralKeys')}
                    style={styles.clearBtn}
                    title="مسح المفاتيح"
                  >
                    <Trash2 size={13} />
                    <span>مسح</span>
                  </button>
                )}
              </div>
            </div>
            <textarea
              style={styles.textarea}
              rows={2}
              value={form.mistralKeys}
              onChange={(e) => setForm(p => ({ ...p, mistralKeys: e.target.value }))}
              placeholder="mstrl_xxxxxxxx (مفصولة بفاصلة للتبديل التلقائي)"
              disabled={saving}
            />
            <span style={styles.hint}>تُستخدم فقط كمراجع احتياطي سحابي ولا تخرج إليها أي أسرار أو بيانات بوابة.</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="submit" disabled={saving || loading} style={styles.btnSave}>
            <Save size={15} />
            <span>{saving ? 'جارٍ الحفظ…' : 'حفظ وتحديث الإعدادات'}</span>
          </button>
        </div>
      </form>
    </section>
  )
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 'var(--s-3)'
  },
  card: {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--r-md)',
    padding: 'var(--s-3)'
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)',
    padding: '8px 12px',
    color: 'var(--text)',
    fontSize: 'var(--t-xs)',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    resize: 'vertical'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)',
    padding: '6px 10px',
    color: 'var(--text)',
    fontSize: 'var(--t-xs)',
    outline: 'none'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4
  },
  fieldLabel: {
    fontSize: 'var(--t-2xs)',
    color: 'var(--text-3)',
    fontWeight: 600
  },
  hint: {
    display: 'block',
    fontSize: 'var(--t-2xs)',
    color: 'var(--text-4)',
    marginTop: 4
  },
  code: {
    fontFamily: 'var(--font-mono)',
    background: 'var(--surface-3)',
    padding: '2px 6px',
    borderRadius: 'var(--r-xs)',
    color: 'var(--text-2)'
  },
  clearBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: 'none',
    color: 'var(--overdue)',
    fontSize: 'var(--t-2xs)',
    cursor: 'pointer',
    padding: '2px 4px'
  },
  btnSave: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    border: 'none',
    borderRadius: 'var(--r-sm)',
    padding: '8px 18px',
    fontSize: 'var(--t-sm)',
    fontWeight: 700,
    cursor: 'pointer'
  },
  btnSend: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--surface-2)',
    color: 'var(--accent)',
    border: '1px solid var(--accent-line)',
    borderRadius: 'var(--r-sm)',
    padding: '6px 14px',
    fontSize: 'var(--t-xs)',
    fontWeight: 700,
    cursor: 'pointer'
  }
}
