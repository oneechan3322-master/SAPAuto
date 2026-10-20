'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, X, AlertCircle, Eye, EyeOff, CheckCircle2, Loader2, Sparkles } from 'lucide-react'

/* ── helpers ─────────────────────────────────────────────────────────── */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

const EMPTY_FORM = { id: '', username: '', label: '', password: '' }

/* ── AccountModal ─────────────────────────────────────────────────────── */
function AccountModal({ account, onClose, onSaved }) {
  const isEdit = Boolean(account)
  const [form, setForm]   = useState(isEdit ? { id: account.id, username: account.username, label: account.label, password: account.password || '' } : { ...EMPTY_FORM })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy]   = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyNotice, setVerifyNotice] = useState('')
  const [error, setError] = useState('')

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }))

  async function verifyAndFetchName() {
    if (!form.username || !form.password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور أولاً للتحقق من البوابة')
      return
    }
    setError('')
    setVerifyNotice('')
    setVerifying(true)
    try {
      const res = await apiFetch('/api/accounts/verify', {
        method: 'POST',
        body: JSON.stringify({ username: form.username.trim(), password: form.password.trim() })
      })
      if (!res.ok) {
        throw new Error(res.error || 'تعذر التحقق من البوابة')
      }
      if (res.companyName) {
        setForm((prev) => ({
          ...prev,
          label: res.companyName,
          id: prev.id || res.companyId || prev.username
        }))
        setVerifyNotice(`تم التحقق والتعرف على: ${res.companyName}`)
      } else {
        setVerifyNotice('تم تسجيل الدخول بنجاح ولكن لم يتم العثور على اسم للمنشأة')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setVerifying(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (isEdit) {
        await apiFetch('/api/accounts', {
          method: 'PATCH',
          body: JSON.stringify({ id: form.id, username: form.username, label: form.label, password: form.password || undefined })
        })
      } else {
        await apiFetch('/api/accounts', {
          method: 'POST',
          body: JSON.stringify({
            id: (form.id || form.username).trim(),
            username: form.username.trim(),
            label: (form.label || form.username).trim(),
            password: form.password
          })
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} dir="rtl">
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{isEdit ? 'تعديل بيانات الحساب' : 'إضافة حساب جديد وتأكيده من البوابة'}</span>
          <button style={styles.iconBtn} onClick={onClose} type="button" aria-label="إغلاق"><X size={18} /></button>
        </div>

        <form onSubmit={submit} style={styles.modalBody}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>اسم المستخدم في البوابة <span style={styles.required}>*</span></span>
            <input
              style={styles.input}
              value={form.username}
              onChange={set('username')}
              placeholder="اسم المستخدم لتسجيل الدخول في بوابة الضرائب"
              required
              autoFocus={!isEdit}
              disabled={busy || verifying}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>كلمة المرور <span style={styles.required}>*</span></span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                style={{ ...styles.input, paddingInlineEnd: 42 }}
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={set('password')}
                placeholder="كلمة مرور الحساب"
                required={!isEdit}
                disabled={busy || verifying}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
                title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                aria-label={showPassword ? 'إخفاء' : 'إظهار'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {!isEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={verifyAndFetchName}
                disabled={verifying || busy || !form.username || !form.password}
                style={styles.btnVerify}
              >
                {verifying ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                <span>{verifying ? 'جارٍ التحقق وسحب الاسم من البوابة…' : 'تحقق واسحب اسم الشركة تلقائياً'}</span>
              </button>
            </div>
          )}

          {verifyNotice && (
            <div style={styles.successBar}>
              <CheckCircle2 size={16} color="var(--done)" />
              <span>{verifyNotice}</span>
            </div>
          )}

          <label style={styles.field}>
            <span style={styles.fieldLabel}>اسم المنشأة / الاسم التعريفي</span>
            <input
              style={styles.input}
              value={form.label}
              onChange={set('label')}
              placeholder="يُسحب تلقائياً من البوابة أو أدخله يدوياً"
              disabled={busy || verifying}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>معرف الحساب <span style={styles.hint}>(اختياري، يطابق اسم المستخدم افتراضياً)</span></span>
            <input
              style={styles.input}
              value={form.id}
              onChange={set('id')}
              placeholder={form.username || 'معرف الحساب'}
              disabled={isEdit || busy || verifying}
            />
          </label>

          {error && (
            <div style={styles.errorBar}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div style={styles.modalFooter}>
            <button type="button" style={styles.btnSecondary} onClick={onClose} disabled={busy || verifying}>إلغاء</button>
            <button type="submit" style={styles.btnPrimary} disabled={busy || verifying}>
              {busy ? 'جارٍ الحفظ…' : isEdit ? 'حفظ التعديلات' : 'إضافة وتثبيت الحساب'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── DeleteConfirm ─────────────────────────────────────────────────────── */
function DeleteConfirm({ account, onClose, onDeleted }) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setError('')
    setBusy(true)
    try {
      await apiFetch(`/api/accounts?key=${encodeURIComponent(account.id)}`, { method: 'DELETE' })
      onDeleted()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...styles.modal, maxWidth: 420 }} dir="rtl">
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>حذف الحساب</span>
          <button style={styles.iconBtn} onClick={onClose} type="button" aria-label="إغلاق"><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text)' }}>
            هل أنت متأكد من حذف الحساب <strong>{account.label || account.id}</strong>؟
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-3)' }}>
            سيتوقف النظام عن فحص هذا الحساب، ولن يمكن التراجع بعد الحذف.
          </p>
          {error && <div style={styles.errorBar}><AlertCircle size={16} /><span>{error}</span></div>}
          <div style={styles.modalFooter}>
            <button type="button" style={styles.btnSecondary} onClick={onClose} disabled={busy}>إلغاء</button>
            <button type="button" style={styles.btnDanger} onClick={confirm} disabled={busy}>
              {busy ? 'جارٍ الحذف…' : 'تأكيد الحذف'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── AccountsManager (main export) ────────────────────────────────────── */
export default function AccountsManager() {
  const [accounts, setAccounts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [modal,    setModal]    = useState(null)
  const [toggling, setToggling] = useState(null)
  const [revealed, setRevealed] = useState({}) // { [id]: boolean }

  const togglePasswordReveal = (id) => {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await apiFetch('/api/accounts')
      setAccounts(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleEnabled(account) {
    if (toggling) return
    setToggling(account.id)
    try {
      await apiFetch('/api/accounts', {
        method: 'PATCH',
        body: JSON.stringify({ id: account.id, enabled: account.enabled ? 0 : 1 })
      })
      setAccounts((prev) => prev.map((a) => a.id === account.id ? { ...a, enabled: a.enabled ? 0 : 1 } : a))
    } catch (err) {
      setError(err.message)
    } finally {
      setToggling(null)
    }
  }

  const enabled  = accounts.filter((a) => a.enabled)
  const disabled = accounts.filter((a) => !a.enabled)

  return (
    <section className="settings-section panel" dir="rtl" style={{ marginBlockEnd: 'var(--s-4)' }}>
      <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <span className="section-index">05</span>
          <div>
            <h2 style={{ margin: 0 }}>إدارة الحسابات وكلمات المرور</h2>
            <p className="muted" style={{ margin: 0 }}>
              {loading ? 'جارٍ التحميل…' : `${enabled.length} حساب نشط في دورات الفحص · ${disabled.length} معطل · كلمات المرور متاحة للعرض`}
            </p>
          </div>
        </div>
        <button style={styles.btnAdd} onClick={() => setModal('add')} type="button">
          <Plus size={16} />
          <span>إضافة حساب وتحقق</span>
        </button>
      </div>

      {error && (
        <div className="notice-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {!loading && accounts.length === 0 && !error && (
        <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 14, padding: '24px 0' }}>
          لا توجد حسابات مسجلة بعد.
        </p>
      )}

      {accounts.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>الاسم التعريفي (الشركة)</th>
                <th style={styles.th}>اسم المستخدم</th>
                <th style={styles.th}>كلمة المرور</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>الحالة</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc, idx) => (
                <tr key={acc.id} className="account-row" style={acc.enabled ? styles.row : styles.rowDisabled}>
                  <td style={styles.tdIndex}>{idx + 1}</td>
                  <td style={styles.tdLabel}>
                    <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{acc.label || acc.id}</strong>
                    {acc.id !== acc.label && (
                      <div style={{ fontSize: 'var(--t-2xs)', color: 'var(--text-4)', marginTop: 2 }}>
                        المعرف: {acc.id}
                      </div>
                    )}
                  </td>
                  <td style={styles.tdUsername}>
                    <code style={styles.code}>{acc.username}</code>
                  </td>
                  <td style={styles.tdPassword}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', letterSpacing: revealed[acc.id] ? 0 : 2 }}>
                        {revealed[acc.id] ? (acc.password || '—') : '••••••••'}
                      </span>
                      {acc.password && (
                        <button
                          type="button"
                          onClick={() => togglePasswordReveal(acc.id)}
                          style={styles.eyeInlineBtn}
                          title={revealed[acc.id] ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                        >
                          {revealed[acc.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <button
                      style={styles.toggleBtn}
                      onClick={() => toggleEnabled(acc)}
                      disabled={toggling === acc.id}
                      type="button"
                      title={acc.enabled ? 'إيقاف الحساب من دورة الفحص' : 'تفعيل الحساب'}
                      aria-label={acc.enabled ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                    >
                      {acc.enabled
                        ? <ToggleRight size={24} color="var(--accent)" />
                        : <ToggleLeft  size={24} color="var(--text-4)" />
                      }
                    </button>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <div style={styles.actions}>
                      <button
                        style={styles.iconBtn}
                        onClick={() => setModal({ edit: acc })}
                        type="button"
                        title="تعديل الحساب"
                        aria-label="تعديل"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        style={{ ...styles.iconBtn, color: 'var(--overdue)' }}
                        onClick={() => setModal({ del: acc })}
                        type="button"
                        title="حذف الحساب نهائياً"
                        aria-label="حذف"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'add' && (
        <AccountModal
          account={null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {modal?.edit && (
        <AccountModal
          account={modal.edit}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {modal?.del && (
        <DeleteConfirm
          account={modal.del}
          onClose={() => setModal(null)}
          onDeleted={() => { setModal(null); load() }}
        />
      )}
    </section>
  )
}

/* ── Styles using system tokens ────────────────────────────────────────── */
const styles = {
  tableWrap: {
    overflowX: 'auto',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border)',
    background: 'var(--surface)'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--t-base)'
  },
  th: {
    padding: '12px 16px',
    textAlign: 'right',
    fontWeight: 700,
    fontSize: 'var(--t-xs)',
    color: 'var(--text-2)',
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--border-strong)',
    whiteSpace: 'nowrap'
  },
  row: {
    borderBottom: '1px solid var(--border-soft)',
    background: 'transparent',
    transition: 'background .12s var(--ease)'
  },
  rowDisabled: {
    borderBottom: '1px solid var(--border-soft)',
    background: 'var(--surface-inset)',
    opacity: 0.55
  },
  td: {
    padding: '12px 16px',
    verticalAlign: 'middle'
  },
  tdIndex: {
    padding: '12px 16px',
    color: 'var(--text-3)',
    fontSize: 'var(--t-xs)',
    fontFamily: 'var(--font-mono)'
  },
  tdLabel: {
    padding: '12px 16px',
    color: 'var(--text)',
    fontSize: 'var(--t-base)',
    fontWeight: 600
  },
  tdUsername: {
    padding: '12px 16px',
    color: 'var(--text-2)',
    fontSize: 'var(--t-sm)'
  },
  tdPassword: {
    padding: '12px 16px',
    color: 'var(--text-2)',
    fontSize: 'var(--t-sm)',
    verticalAlign: 'middle'
  },
  code: {
    fontSize: 'var(--t-xs)',
    color: 'var(--accent)',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-soft)',
    padding: '3px 8px',
    borderRadius: 'var(--r-xs)',
    fontFamily: 'var(--font-mono)'
  },
  actions: {
    display: 'flex',
    gap: 6,
    justifyContent: 'center'
  },
  iconBtn: {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-soft)',
    cursor: 'pointer',
    padding: '6px 8px',
    borderRadius: 'var(--r-xs)',
    color: 'var(--text-2)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all .15s var(--ease)'
  },
  eyeBtn: {
    position: 'absolute',
    insetInlineEnd: 8,
    background: 'none',
    border: 'none',
    color: 'var(--text-3)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6
  },
  eyeInlineBtn: {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--r-xs)',
    color: 'var(--text-3)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3px 5px'
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  btnAdd: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    border: 'none',
    borderRadius: 'var(--r-sm)',
    padding: '8px 16px',
    fontSize: 'var(--t-sm)',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: 'var(--shadow-1)'
  },
  btnVerify: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--surface-3)',
    color: 'var(--accent)',
    border: '1px solid var(--accent-line)',
    borderRadius: 'var(--r-sm)',
    padding: '7px 12px',
    fontSize: 'var(--t-xs)',
    fontWeight: 600,
    cursor: 'pointer'
  },
  /* Modal */
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgb(0 0 0 / 65%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
    backdropFilter: 'blur(6px)'
  },
  modal: {
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--r-lg)',
    width: 'min(500px, 94vw)',
    boxShadow: 'var(--shadow-3)',
    color: 'var(--text)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-soft)'
  },
  modalTitle: {
    fontWeight: 700,
    fontSize: 'var(--t-md)',
    color: 'var(--text)'
  },
  modalBody: {
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  fieldLabel: {
    fontSize: 'var(--t-sm)',
    fontWeight: 600,
    color: 'var(--text)'
  },
  input: {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)',
    padding: '10px 14px',
    color: 'var(--text)',
    fontSize: 'var(--t-base)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box'
  },
  hint: {
    fontSize: 'var(--t-2xs)',
    color: 'var(--text-3)'
  },
  required: {
    color: 'var(--overdue)',
    marginInlineStart: 2
  },
  errorBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--overdue-soft)',
    color: 'var(--overdue)',
    border: '1px solid var(--overdue-line)',
    borderRadius: 'var(--r-sm)',
    padding: '8px 12px',
    fontSize: 'var(--t-xs)'
  },
  successBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--done-soft)',
    color: 'var(--done)',
    border: '1px solid var(--done-line)',
    borderRadius: 'var(--r-sm)',
    padding: '8px 12px',
    fontSize: 'var(--t-xs)'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8
  },
  btnPrimary: {
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    border: 'none',
    borderRadius: 'var(--r-sm)',
    padding: '10px 20px',
    fontSize: 'var(--t-sm)',
    fontWeight: 700,
    cursor: 'pointer'
  },
  btnSecondary: {
    background: 'var(--surface-2)',
    color: 'var(--text-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)',
    padding: '10px 18px',
    fontSize: 'var(--t-sm)',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnDanger: {
    background: 'var(--overdue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--r-sm)',
    padding: '10px 20px',
    fontSize: 'var(--t-sm)',
    fontWeight: 700,
    cursor: 'pointer'
  }
}
