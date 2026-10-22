'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Archive, AlertTriangle, CheckCircle2, Clock, Calendar, FileText,
  Building2, Plus, RefreshCw, Search, ShieldCheck, UserCheck, Edit3, X, ExternalLink
} from 'lucide-react'

const DOC_TYPE_LABELS = {
  tax_card: 'البطاقة الضريبية',
  commercial_registry: 'السجل التجاري',
  vat_certificate: 'شهادة تسجيل القيمة المضافة',
  national_id: 'بطاقة الرقم القومي (المفوض)',
  e_signature: 'التوقيع / الختم الإلكتروني',
  portal_document: 'مستند وارد من بوابة الضرائب',
  other: 'وثيقة قانونية أخرى'
}

const STATUS_TONES = {
  urgent: { bg: 'var(--overdue-soft)', text: 'var(--overdue)', border: 'var(--overdue-line)' },
  attention: { bg: 'var(--soon-soft)', text: 'var(--soon)', border: 'var(--soon-line)' },
  calm: { bg: 'var(--done-soft)', text: 'var(--done)', border: 'var(--done-line)' },
  neutral: { bg: 'var(--surface-2)', text: 'var(--text-3)', border: 'var(--border)' }
}

export default function ArchiveView({ initialDocuments = [], companies = [], stats: initialStats = {} }) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [stats, setStats] = useState(initialStats)
  const [query, setQuery] = useState('')
  const [selectedCompany, setSelectedCompany] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [syncing, setSyncing] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    id: '',
    company_id: companies[0]?.id || '',
    doc_type: 'commercial_registry',
    doc_name: 'السجل التجاري',
    doc_number: '',
    issuer: 'مكتب السجل التجاري',
    issue_date: '',
    expiry_date: '',
    assigned_role: 'الشؤون القانونية وشؤون الشركات',
    notes: '',
    direction: 'incoming',
    custodian: '',
    registered_by: 'office user'
  })

  const openNewDocModal = () => {
    setEditingDoc(null)
    setFormError('')
    setFormData({
      id: '',
      company_id: selectedCompany || companies[0]?.id || '',
      doc_type: 'commercial_registry',
      doc_name: 'السجل التجاري',
      doc_number: '',
      issuer: 'مكتب السجل التجاري',
      issue_date: '',
      expiry_date: '',
      assigned_role: 'الشؤون القانونية وشؤون الشركات',
      notes: '',
      direction: 'incoming',
      custodian: '',
      registered_by: 'office user'
    })
    setModalOpen(true)
  }

  const openEditDocModal = (doc) => {
    setEditingDoc(doc)
    setFormError('')
    setFormData({
      id: doc.id || '',
      company_id: doc.company_id || '',
      doc_type: doc.doc_type || 'tax_card',
      doc_name: doc.doc_name || DOC_TYPE_LABELS[doc.doc_type] || '',
      doc_number: doc.doc_number || '',
      issuer: doc.issuer || '',
      issue_date: doc.issue_date || '',
      expiry_date: doc.expiry_date || '',
      assigned_role: doc.assigned_role || 'المحاسب القانوني للملف',
      notes: doc.notes || '',
      direction: doc.direction || 'incoming',
      custodian: doc.custodian || doc.assigned_role || '',
      registered_by: doc.last_resaved_by || doc.registered_by || 'office user'
    })
    setModalOpen(true)
  }

  const handleDocTypeChange = (type) => {
    let defaultIssuer = ''
    let defaultRole = 'المحاسب القانوني للملف'
    if (type === 'tax_card') {
      defaultIssuer = 'مصلحة الضرائب المصرية'
      defaultRole = 'المحاسب القانوني للملف'
    } else if (type === 'commercial_registry') {
      defaultIssuer = 'مكتب السجل التجاري - جهاز تنمية التجارة'
      defaultRole = 'الشؤون القانونية وشؤون الشركات'
    } else if (type === 'vat_certificate') {
      defaultIssuer = 'مصلحة الضرائب المصرية (قيمة مضافة)'
      defaultRole = 'المحاسب القانوني للملف'
    } else if (type === 'national_id') {
      defaultIssuer = 'قطاع الأحوال المدنية'
      defaultRole = 'المفوض بالتوقيع / المدير المسؤول'
    } else if (type === 'e_signature') {
      defaultIssuer = 'إيجيبت تراست / مصر للمقاصة'
      defaultRole = 'المدير المالي / مسؤول الفاتورة الإلكترونية'
    }
    setFormData((prev) => ({
      ...prev,
      doc_type: type,
      doc_name: DOC_TYPE_LABELS[type] || 'وثيقة قانونية',
      issuer: defaultIssuer,
      assigned_role: defaultRole
    }))
  }

  const handleSaveDoc = async (e) => {
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
      // Refresh list
      await refreshData()
      setModalOpen(false)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const refreshData = async () => {
    try {
      const res = await fetch('/api/archive')
      const data = await res.json()
      if (data.ok) {
        setDocuments(data.documents || [])
        setStats(data.stats || {})
      }
    } catch (err) {
      console.error('Failed to reload archive data', err)
    }
  }

  const handleSyncPortal = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' })
      })
      const data = await res.json()
      if (data.ok) {
        await refreshData()
      }
    } catch (err) {
      console.error('Portal sync failed', err)
    } finally {
      setSyncing(false)
    }
  }

  const handleAnalyzePdfs = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'analyze_pdfs' })
      })
      const data = await res.json()
      if (data.ok) {
        setDocuments(data.documents || [])
        setStats(data.stats || {})
      }
    } finally {
      setSyncing(false)
    }
  }

  // Filtered documents
  const filtered = documents.filter((doc) => {
    if (selectedCompany && doc.company_id !== selectedCompany) return false
    if (selectedType && doc.doc_type !== selectedType) return false
    if (selectedStatus !== 'all' && doc.status !== selectedStatus) return false
    if (!query) return true
    const q = query.toLowerCase()
    return (
      (doc.doc_name && doc.doc_name.toLowerCase().includes(q)) ||
      (doc.doc_number && doc.doc_number.toLowerCase().includes(q)) ||
      (doc.company_name && doc.company_name.toLowerCase().includes(q)) ||
      (doc.assigned_role && doc.assigned_role.toLowerCase().includes(q)) ||
      (doc.issuer && doc.issuer.toLowerCase().includes(q)) ||
      (doc.notes && doc.notes.toLowerCase().includes(q))
    )
  })

  return (
    <div className="archive-view stack">
      {/* Top Banner & KPI Stats */}
      <div className="archive-hero" style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '24px 28px',
        boxShadow: 'var(--shadow-1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Archive size={28} color="var(--accent)" />
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
                أرشيف الوثائق والسجلات القانونية والمهل الرسمية
              </h1>
            </div>
            <p style={{ margin: '8px 0 0', color: 'var(--text-3)', fontSize: '0.9rem', maxWidth: '680px' }}>
              متابعة مواعيد تجديد البطاقات الضريبية، السجلات التجارية، شهادات القيمة المضافة، بطاقات الرقم القومي، والتوقيع والختم الإلكتروني لكل شركة مع التنبيه المسبق قبل انقضاء المهل.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleSyncPortal}
              disabled={syncing}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 16px',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: '8px',
                cursor: syncing ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem'
              }}
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              <span>{syncing ? 'جاري المزامنة...' : 'مزامنة مع البوابة'}</span>
            </button>
            <button type="button" onClick={handleAnalyzePdfs} disabled={syncing} className="button-secondary" title="فحص جميع ملفات PDF واستخراج البيانات والنصوص بالذكاء الاصطناعي والأرشفة التلقائية">
              <FileText size={15} />
              <span>{syncing ? 'جارٍ فحص الـ PDF واستخراج البيانات...' : 'فحص واستيراد ملفات PDF (OCR) تلقائياً'}</span>
            </button>
            <button
              type="button"
              onClick={openNewDocModal}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 18px',
                backgroundColor: 'var(--accent)',
                border: 'none',
                color: 'var(--accent-ink)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.85rem',
                boxShadow: 'var(--shadow-1)'
              }}
            >
              <Plus size={16} />
              <span>إضافة وثيقة / سجل</span>
            </button>
          </div>
        </div>

        {/* KPI Cards Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          marginTop: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--surface-2)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border)'
          }}>
            <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>إجمالي الوثائق المقيدة</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '4px', color: 'var(--info)' }}>
              {stats.total ?? documents.length}
            </div>
          </div>

          <div style={{
            backgroundColor: 'var(--overdue-soft)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--overdue-line)'
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--overdue)' }}>منتهية الصلاحية (تحتاج تجديد) 🚨</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '4px', color: 'var(--overdue)' }}>
              {stats.expired ?? 0}
            </div>
          </div>

          <div style={{
            backgroundColor: 'var(--soon-soft)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--soon-line)'
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--soon)' }}>توشك على الانتهاء (خلال 60 يوم) ⏳</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '4px', color: 'var(--soon)' }}>
              {stats.expiringSoon ?? 0}
            </div>
          </div>

          <div style={{
            backgroundColor: 'var(--done-soft)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--done-line)'
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--done)' }}>سارية وصالحة ✅</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '4px', color: 'var(--done)' }}>
              {stats.valid ?? 0}
            </div>
          </div>

          <div style={{
            backgroundColor: 'var(--neutral-soft)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--neutral-line)'
          }}>
            <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>بانتظار تسجيل التاريخ 📋</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '4px', color: 'var(--neutral)' }}>
              {stats.noDate ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="panel stack" style={{ padding: '16px 20px', borderRadius: '10px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search box */}
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={16} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث برقم الوثيقة، اسم الشركة، نوع المستند أو المسؤول..."
              style={{
                width: '100%',
                padding: '9px 36px 9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-inset)',
                fontSize: '0.85rem'
              }}
            />
          </div>

          {/* Company selector */}
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            style={{
              padding: '9px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              fontSize: '0.85rem',
              backgroundColor: 'var(--surface-inset)',
              minWidth: '180px'
            }}
          >
            <option value="">جميع الشركات ({companies.length})</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Doc Type selector */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={{
              padding: '9px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              fontSize: '0.85rem',
              backgroundColor: 'var(--surface-inset)',
              minWidth: '180px'
            }}
          >
            <option value="">جميع أنواع المستندات</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>

        {/* Status Filter Tabs */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', borderTop: '1px solid var(--border-soft)', paddingTop: '10px' }}>
          {[
            { id: 'all', label: 'جميع الحالات' },
            { id: 'expired', label: '🚨 منتهية الصلاحية' },
            { id: 'expiring_soon', label: '⏳ توشك على الانتهاء' },
            { id: 'valid', label: '✅ سارية' },
            { id: 'no_date', label: '📋 غير مسجل التاريخ' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedStatus(tab.id)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: '1px solid',
                borderColor: selectedStatus === tab.id ? 'var(--accent-line)' : 'var(--border)',
                backgroundColor: selectedStatus === tab.id ? 'var(--accent-soft)' : 'var(--surface-2)',
                color: selectedStatus === tab.id ? 'var(--accent)' : 'var(--text-2)',
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Documents Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
        gap: '16px'
      }}>
        {filtered.length === 0 ? (
          <div className="panel" style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <FileText size={42} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <h3 style={{ margin: '0 0 6px', color: 'var(--text)' }}>لا توجد وثائق تطابق هذا التصفية</h3>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>يمكنك إضافة وثيقة جديدة أو تغيير شروط البحث.</p>
          </div>
        ) : (
          filtered.map((doc) => {
            const tone = STATUS_TONES[doc.tone] || STATUS_TONES.neutral
            return (
              <article
                key={doc.id}
                className="archive-document-card"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  borderRight: `4px solid ${tone.border}`,
                  padding: '16px 18px',
                  boxShadow: 'var(--shadow-1)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div>
                  {/* Top Bar: Doc Name & Status Badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: 'var(--text-4)',
                        display: 'block',
                        marginBottom: '2px'
                      }}>
                        {DOC_TYPE_LABELS[doc.doc_type] || 'وثيقة قانونية'}
                      </span>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
                        {doc.doc_name}
                      </h3>
                    </div>

                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: '6px',
                      backgroundColor: tone.bg,
                      color: tone.text,
                      border: `1px solid ${tone.border}`,
                      whiteSpace: 'nowrap'
                    }}>
                      {doc.countdown_label || doc.status_label}
                    </span>
                  </div>

                  {/* Company Link */}
                  <div style={{ marginTop: '8px', fontSize: '0.82rem' }}>
                    <Link
                      href={`/companies/${encodeURIComponent(doc.company_id)}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: 'var(--accent)',
                        fontWeight: 600,
                        textDecoration: 'none'
                      }}
                    >
                      <Building2 size={14} />
                      <span>{doc.company_name}</span>
                    </Link>
                  </div>

                  {/* Core Facts Checklist */}
                  <div style={{
                    marginTop: '12px',
                    backgroundColor: 'var(--surface-2)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '0.82rem'
                  }}>
                    {doc.doc_number ? (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-3)', minWidth: '85px' }}>رقم الوثيقة:</span>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{doc.doc_number}</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', color: 'var(--text-4)' }}>
                        <span style={{ minWidth: '85px' }}>رقم الوثيقة:</span>
                        <span>غير مدخل بعد</span>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-3)', minWidth: '85px' }}>تاريخ الانتهاء:</span>
                      <span style={{ fontWeight: 700, color: doc.expiry_date ? 'var(--text)' : 'var(--text-4)' }}>
                        {doc.expiry_date || 'غير محدد'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-3)', minWidth: '85px' }}>جهة الإصدار:</span>
                      <span style={{ color: 'var(--text-2)' }}>{doc.issuer || 'مصلحة الضرائب / السجل التجاري'}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--info)', minWidth: '85px' }}>👤 المسؤول:</span>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: 'var(--info-soft)',
                        color: 'var(--info)',
                        padding: '2px 8px',
                        borderRadius: '4px'
                      }}>
                        {doc.assigned_role || 'المحاسب القانوني للملف'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-3)', minWidth: '85px' }}>الحركة:</span>
                      <span style={{ color: 'var(--text-2)' }}>{doc.direction === 'outgoing' ? 'صادر من الشركة أو المكتب' : 'وارد إلى ملف الشركة'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-3)', minWidth: '85px' }}>الحفظ:</span>
                      <span style={{ color: 'var(--text-2)' }}>{doc.custodian || 'غير محدد'} · {doc.last_resaved_by || doc.registered_by || 'النظام'}</span>
                    </div>
                    {(doc.received_at || doc.sent_at || doc.last_resaved_at) && (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-3)', minWidth: '85px' }}>آخر تسجيل:</span>
                        <span style={{ color: 'var(--text-2)' }}>{doc.last_resaved_at || doc.received_at || doc.sent_at}</span>
                      </div>
                    )}
                    {doc.ocr_state && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                        {doc.ocr_state === 'text_extracted' ? 'تم استخراج نص PDF' : doc.ocr_state === 'needs_ocr' ? 'الملف مصوّر ويحتاج OCR' : doc.ocr_state === 'failed' ? 'تعذر قراءة الملف' : 'في انتظار تحليل PDF'}
                      </div>
                    )}
                    {(doc.inspection_officer || doc.books_from_year || doc.books_to_year) && (
                      <div style={{ paddingTop: '5px', borderTop: '1px solid var(--border-soft)', color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600 }}>
                        {doc.inspection_officer && `مسؤول الفحص: ${doc.inspection_officer}`} {doc.books_from_year && ` · الدفاتر: ${doc.books_from_year} إلى ${doc.books_to_year || 'غير محدد'}`}
                      </div>
                    )}

                    {(doc.source === 'portal_sync' || doc.source === 'portal_pdf') && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--accent)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ShieldCheck size={13} />
                        <span>مزامنة مباشرة مع بوابة الضرائب الرسمية</span>
                      </div>
                    )}
                  </div>

                  {doc.notes && (
                    <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--text-3)', lineHeight: 1.4 }}>
                      💡 {doc.notes}
                    </p>
                  )}
                </div>

                {/* Card Footer: Action button */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  borderTop: '1px solid var(--border-soft)',
                  paddingTop: '10px'
                }}>
                  <button
                    type="button"
                    onClick={() => openEditDocModal(doc)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 12px',
                      backgroundColor: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: 'var(--text-2)',
                      cursor: 'pointer'
                    }}
                  >
                    <Edit3 size={13} />
                    <span>تعديل السجل والمهلة</span>
                  </button>
                </div>
              </article>
            )
          })
        )}
      </div>

      {/* Modal for Add / Edit Document */}
      {modalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'color-mix(in srgb, var(--canvas) 76%, transparent)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: 'var(--surface)',
            borderRadius: '12px',
            maxWidth: '540px',
            width: '100%',
            boxShadow: 'var(--shadow-3)',
            border: '1px solid var(--border)',
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 20px',
              backgroundColor: 'var(--surface-2)',
              borderBottom: '1px solid var(--border)'
            }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
                {editingDoc ? 'تعديل بيانات الوثيقة والمهلة القانونية' : 'إضافة وثيقة / سجل جديد للأرشيف'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveDoc} style={{ padding: '20px' }} className="stack">
              {formError && (
                <div style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--overdue-soft)',
                  border: '1px solid var(--overdue-line)',
                  borderRadius: '6px',
                  color: 'var(--overdue)',
                  fontSize: '0.85rem'
                }}>
                  {formError}
                </div>
              )}

              {/* Company Selection */}
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                  الشركة التابعة لها الوثيقة:
                </label>
                <select
                  value={formData.company_id}
                  disabled={Boolean(editingDoc)}
                  onChange={(e) => setFormData((prev) => ({ ...prev, company_id: e.target.value }))}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontSize: '0.85rem'
                  }}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Document Type */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                    نوع الوثيقة:
                  </label>
                  <select
                    value={formData.doc_type}
                    onChange={(e) => handleDocTypeChange(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-2)',
                      color: 'var(--text)',
                      fontSize: '0.85rem'
                    }}
                  >
                    {Object.entries(DOC_TYPE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                    اسم المستند:
                  </label>
                  <input
                    type="text"
                    value={formData.doc_name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, doc_name: e.target.value }))}
                    required
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-2)',
                      color: 'var(--text)',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
              </div>

              {/* Document Number & Issuer */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                    رقم الوثيقة / السجل:
                  </label>
                  <input
                    type="text"
                    value={formData.doc_number}
                    placeholder="مثال: 123456"
                    onChange={(e) => setFormData((prev) => ({ ...prev, doc_number: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-2)',
                      color: 'var(--text)',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                    جهة الإصدار:
                  </label>
                  <input
                    type="text"
                    value={formData.issuer}
                    onChange={(e) => setFormData((prev) => ({ ...prev, issuer: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-2)',
                      color: 'var(--text)',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
              </div>

              {/* Expiry Date & Assigned Role */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                    تاريخ الانتهاء / التجديد:
                  </label>
                  <input
                    type="date"
                    value={formData.expiry_date}
                    onChange={(e) => setFormData((prev) => ({ ...prev, expiry_date: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-2)',
                      color: 'var(--text)',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                    👤 المسؤول المكلف بالتجديد:
                  </label>
                  <input
                    type="text"
                    value={formData.assigned_role}
                    onChange={(e) => setFormData((prev) => ({ ...prev, assigned_role: e.target.value }))}
                    placeholder="المحاسب القانوني للملف"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-2)',
                      color: 'var(--text)',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px', color: 'var(--text-2)' }}>
                  ملاحظات وموقع حفظ الأصل الورقي:
                </label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="مثال: أصل السجل محفوظ في خزينة المكتب رقم 2، نسخة رقمية مرفوعة."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              {/* Modal Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-2)',
                    color: 'var(--text-2)',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'var(--accent)',
                    color: 'var(--accent-ink)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: saving ? 'not-allowed' : 'pointer'
                  }}
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ الوثيقة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
