'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Archive, Edit3, ShieldCheck, Clock, FileText, CheckCircle2, AlertTriangle, X } from 'lucide-react'

const DOC_TYPE_LABELS = {
  tax_card: 'البطاقة الضريبية',
  commercial_registry: 'السجل التجاري',
  vat_certificate: 'شهادة تسجيل القيمة المضافة',
  national_id: 'بطاقة الرقم القومي (المفوض)',
  e_signature: 'التوقيع / الختم الإلكتروني',
  other: 'وثيقة قانونية أخرى'
}

const STATUS_TONES = {
  urgent: { bg: 'var(--overdue-soft)', text: 'var(--overdue)', border: 'var(--overdue-line)' },
  attention: { bg: 'var(--soon-soft)', text: 'var(--soon)', border: 'var(--soon-line)' },
  calm: { bg: 'var(--done-soft)', text: 'var(--done)', border: 'var(--done-line)' },
  neutral: { bg: 'var(--neutral-soft)', text: 'var(--neutral)', border: 'var(--neutral-line)' }
}

export default function CompanyDocumentsCard({ companyId, initialDocuments = [] }) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [formData, setFormData] = useState({
    id: '',
    company_id: companyId,
    doc_type: 'commercial_registry',
    doc_name: 'السجل التجاري',
    doc_number: '',
    issuer: '',
    issue_date: '',
    expiry_date: '',
    assigned_role: 'المحاسب القانوني للملف',
    notes: ''
  })

  const openEdit = (doc) => {
    setEditingDoc(doc)
    setFormError('')
    setFormData({
      id: doc.id || '',
      company_id: companyId,
      doc_type: doc.doc_type || 'tax_card',
      doc_name: doc.doc_name || DOC_TYPE_LABELS[doc.doc_type] || '',
      doc_number: doc.doc_number || '',
      issuer: doc.issuer || '',
      issue_date: doc.issue_date || '',
      expiry_date: doc.expiry_date || '',
      assigned_role: doc.assigned_role || 'المحاسب القانوني للملف',
      notes: doc.notes || ''
    })
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const res = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'فشل حفظ الوثيقة')
      }
      // Re-fetch
      const fetchRes = await fetch(`/api/archive?companyId=${encodeURIComponent(companyId)}`)
      const fetchData = await fetchRes.json()
      if (fetchData.ok) {
        setDocuments(fetchData.documents || [])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="stack mt-6" id="company-documents-archive">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Archive size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
            أرشيف الوثائق والسجلات والمهل الرسمية
          </h2>
        </div>
        <Link href="/archive" style={{ fontSize: '0.82rem', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
          فتح الأرشيف العام لجميع الشركات ←
        </Link>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '12px',
        marginTop: '8px'
      }}>
        {documents.map((doc) => {
          const tone = STATUS_TONES[doc.tone] || STATUS_TONES.neutral
          return (
            <div
              key={doc.id || doc.doc_type}
              className="company-document-card"
              style={{
                backgroundColor: 'var(--surface)',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border)',
                borderRight: `4px solid ${tone.border}`,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '8px'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>
                    {doc.doc_name}
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: tone.bg,
                    color: tone.text,
                    border: `1px solid ${tone.border}`,
                    whiteSpace: 'nowrap'
                  }}>
                    {doc.countdown_label || doc.status_label}
                  </span>
                </div>

                <div style={{ marginTop: '8px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span style={{ color: 'var(--text-3)', minWidth: '75px' }}>رقم الوثيقة:</span>
                    <span style={{ fontWeight: doc.doc_number ? 600 : 400, color: doc.doc_number ? 'var(--text)' : 'var(--text-4)' }}>
                      {doc.doc_number || 'غير مسجل'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span style={{ color: 'var(--text-3)', minWidth: '75px' }}>الصلاحية:</span>
                    <span style={{ fontWeight: 600, color: doc.expiry_date ? 'var(--text)' : 'var(--text-4)' }}>
                      {doc.expiry_date || 'غير محدد'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-3)', minWidth: '75px' }}>👤 المسؤول:</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--info)', background: 'var(--info-soft)', padding: '1px 6px', borderRadius: '4px' }}>
                      {doc.assigned_role || 'المحاسب القانوني'}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-soft)', paddingTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => openEdit(doc)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--text-2)',
                    cursor: 'pointer'
                  }}
                >
                  <Edit3 size={12} />
                  <span>تعديل السجل</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {modalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'color-mix(in srgb, var(--canvas) 76%, transparent)',
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '16px'
        }}>
          <div style={{
            backgroundColor: 'var(--surface)', color: 'var(--text)', borderRadius: 'var(--r-lg)', maxWidth: '500px', width: '100%',
            overflow: 'hidden', boxShadow: 'var(--shadow-3)'
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 18px', backgroundColor: 'var(--surface-2)', borderBottom: '1px solid var(--border)'
            }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                تحديث سجل {formData.doc_name}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ padding: '18px' }} className="stack">
              {formError && (
                <div style={{ padding: '8px 12px', background: 'var(--overdue-soft)', border: '1px solid var(--overdue-line)', borderRadius: '6px', color: 'var(--overdue)', fontSize: '0.8rem' }}>
                  {formError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '4px' }}>
                  رقم الوثيقة / السجل:
                </label>
                <input
                  type="text"
                  value={formData.doc_number}
                  onChange={(e) => setFormData((prev) => ({ ...prev, doc_number: e.target.value }))}
                  placeholder="رقم المستند الرسمي..."
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-inset)', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '4px' }}>
                    تاريخ الانتهاء / التجديد:
                  </label>
                  <input
                    type="date"
                    value={formData.expiry_date}
                    onChange={(e) => setFormData((prev) => ({ ...prev, expiry_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-inset)', fontSize: '0.85rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '4px' }}>
                    جهة الإصدار:
                  </label>
                  <input
                    type="text"
                    value={formData.issuer}
                    onChange={(e) => setFormData((prev) => ({ ...prev, issuer: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-inset)', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '4px' }}>
                  👤 المسؤول المكلف بالتجديد:
                </label>
                <input
                  type="text"
                  value={formData.assigned_role}
                  onChange={(e) => setFormData((prev) => ({ ...prev, assigned_role: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-inset)', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '4px' }}>
                  ملاحظات وموقع حفظ الأصل:
                </label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-inset)', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{ padding: '7px 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: '0.82rem', cursor: 'pointer' }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '7px 18px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, fontSize: '0.82rem', cursor: saving ? 'not-allowed' : 'pointer' }}
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
