'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  LayoutGrid,
  Scale,
  ShieldAlert,
  Table as TableIcon
} from 'lucide-react'
import CopyCompanyName from './copy-company-name.jsx'
import SyncMeta from './sync-meta.jsx'
import legalDeadlines from '../../domain/legal-deadlines.cjs'
import { TAX_TYPES } from '../../domain/tax-classifier.cjs'

const DEADLINE_TONE_COLORS = {
  calm: { background: 'var(--done-soft)', text: 'var(--done)', edge: 'var(--done-line)' },
  attention: { background: 'var(--soon-soft)', text: 'var(--soon)', edge: 'var(--soon-line)' },
  urgent: { background: 'var(--overdue-soft)', text: 'var(--overdue)', edge: 'var(--overdue-line)' }
}

const TAX_FILTER_TABS = [
  { id: 'all', label: 'كافة الالتزامات' },
  { id: 'overdue', label: '🚨 المتأخرة فقط' },
  { id: 'vat', label: 'ضريبة القيمة المضافة' },
  { id: 'payroll', label: 'المرتبات وكسب العمل' },
  { id: 'withholding', label: 'الخصم والتحصيل (نموذج 41)' },
  { id: 'disputes', label: 'فحص وطعون ضريبية' },
  { id: 'corporate_stamp', label: 'أرباح الشركات والدمغة' }
]

function matchesTaxFilter(row, filter) {
  if (filter === 'all') return true
  const isOverdue = row.status === 'overdue' || (typeof row.days_left === 'number' && row.days_left < 0)
  if (filter === 'overdue') return isOverdue

  const taxKey = row.tax?.type?.key || 'general'
  if (filter === 'vat') return taxKey === 'vat'
  if (filter === 'payroll') return taxKey === 'payroll'
  if (filter === 'withholding') return taxKey === 'withholding'
  if (filter === 'disputes') return taxKey === 'disputes'
  if (filter === 'corporate_stamp') return taxKey === 'corporate' || taxKey === 'stamp' || taxKey === 'income'
  return true
}

function presentPeriod(value) {
  if (typeof value === 'string' && value.trim() && value.trim() !== '[object Object]') return value.trim()
  if (value && typeof value === 'object') {
    for (const key of ['label', 'name', 'period', 'value', 'display']) {
      if (typeof value[key] === 'string' && value[key].trim() && value[key].trim() !== '[object Object]') return value[key].trim()
    }
    const from = typeof value.from === 'string' ? value.from : ''
    const to = typeof value.to === 'string' ? value.to : ''
    if (from || to) return [from, to].filter(Boolean).join(' — ')
  }
  return 'غير محددة'
}

function portalDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : ''
}

function observedAt(value, locale) {
  if (!value) return 'غير مسجل'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo'
  }).format(date)
}

export default function TaxObligationsView({ rows = [], companyOptions = [], locale = 'ar-EG-u-nu-latn' }) {
  const [taxFilter, setTaxFilter] = useState('all')
  const [viewMode, setViewMode] = useState('table') // 'table' or 'cards'
  const [expandedId, setExpandedId] = useState(null)

  // KPI Metrics
  const metrics = useMemo(() => {
    let overdue = 0
    let vat = 0
    let payroll = 0
    let withholding = 0
    let disputes = 0
    let corporate = 0

    rows.forEach((r) => {
      const isOverdue = r.status === 'overdue' || (typeof r.days_left === 'number' && r.days_left < 0)
      if (isOverdue) overdue++

      const key = r.tax?.type?.key || 'general'
      if (key === 'vat') vat++
      else if (key === 'payroll') payroll++
      else if (key === 'withholding') withholding++
      else if (key === 'disputes') disputes++
      else if (key === 'corporate' || key === 'stamp' || key === 'income') corporate++
    })

    return {
      total: rows.length,
      overdue,
      vat,
      payroll,
      withholding,
      disputes,
      corporate
    }
  }, [rows])

  const filteredRows = useMemo(
    () => rows.filter((r) => matchesTaxFilter(r, taxFilter)),
    [rows, taxFilter]
  )

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id)
  }

  return (
    <div className="tax-obligations-container stack">
      {/* 1. Tax KPI Summary Dashboard Strip */}
      <section className="tax-kpi-grid" aria-label="مؤشرات الموقف الضريبي">
        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-teal">📋</div>
          <div className="tax-kpi-label">إجمالي الالتزامات الضريبية</div>
          <strong className="tax-kpi-value">{metrics.total.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">مرصودة من بوابة الضرائب</span>
        </div>

        <div className={`tax-kpi-card ${metrics.overdue > 0 ? 'tax-kpi-card-danger' : ''}`}>
          <div className="tax-kpi-icon icon-danger">🚨</div>
          <div className="tax-kpi-label">إقرارات متأخرة (غرامات)</div>
          <strong className="tax-kpi-value text-red-600">{metrics.overdue.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">تتطلب تدخلًا فوريًا</span>
        </div>

        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-blue">👥</div>
          <div className="tax-kpi-label">المرتبات والأجور (كسب العمل)</div>
          <strong className="tax-kpi-value">{metrics.payroll.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">سداد شهري وتسويات ونموذج 4</span>
        </div>

        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-sky">🧾</div>
          <div className="tax-kpi-label">ضريبة القيمة المضافة</div>
          <strong className="tax-kpi-value">{metrics.vat.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">إقرارات نموذج 10 ض.ق.م</span>
        </div>

        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-purple">⚖️</div>
          <div className="tax-kpi-label">الخصم والتحصيل (WHT)</div>
          <strong className="tax-kpi-value">{metrics.withholding.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">إشعارات نموذج 41 ربع السنوية</span>
        </div>

        <div className="tax-kpi-card">
          <div className="tax-kpi-icon icon-rose">🏛️</div>
          <div className="tax-kpi-label">فحص وطعون ولجان</div>
          <strong className="tax-kpi-value">{metrics.disputes.toLocaleString(locale)}</strong>
          <span className="tax-kpi-hint">إخطارات رسمية وجلسات لجان</span>
        </div>
      </section>

      {/* 2. Tax Toolbar with Filters & View Mode Switcher */}
      <div className="tax-toolbar between items-center flex-wrap gap-3">
        <div className="tax-filter-tabs flex flex-wrap gap-2" role="tablist">
          {TAX_FILTER_TABS.map((tab) => {
            const count = tab.id === 'all' ? metrics.total
              : tab.id === 'overdue' ? metrics.overdue
              : tab.id === 'vat' ? metrics.vat
              : tab.id === 'payroll' ? metrics.payroll
              : tab.id === 'withholding' ? metrics.withholding
              : tab.id === 'disputes' ? metrics.disputes
              : metrics.corporate

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={taxFilter === tab.id}
                className={`tax-tab-button ${taxFilter === tab.id ? 'is-active' : ''}`}
                onClick={() => setTaxFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="tax-tab-badge">{count.toLocaleString(locale)}</span>
              </button>
            )
          })}
        </div>

        <div className="tax-view-mode-toggle flex items-center gap-1">
          <button
            type="button"
            className={`tax-mode-btn ${viewMode === 'table' ? 'is-active' : ''}`}
            onClick={() => setViewMode('table')}
            title="عرض الجدول الضريبي المتكامل"
            aria-label="عرض الجدول الضريبي المتكامل"
          >
            <TableIcon size={16} />
            <span>عرض جدول</span>
          </button>
          <button
            type="button"
            className={`tax-mode-btn ${viewMode === 'cards' ? 'is-active' : ''}`}
            onClick={() => setViewMode('cards')}
            title="عرض البطاقات التفصيلية"
            aria-label="عرض البطاقات التفصيلية"
          >
            <LayoutGrid size={16} />
            <span>عرض بطاقات</span>
          </button>
        </div>
      </div>

      {/* 3. Empty State */}
      {filteredRows.length === 0 ? (
        <div className="tax-empty-panel text-center p-12 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <FileText className="mx-auto text-slate-400 mb-3" size={40} />
          <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-100">لا توجد التزامات مطابقة لهذا التصنيف الضريبي</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
            اختر تصنيفاً آخر أو انقر على «كافة الالتزامات» لاستعراض كل السجلات المسجلة محلياً.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* 4. Professional Tax Table Grid View */
        <div className="tax-table-container overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm">
          <table className="tax-table w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <th className="py-3 px-4 font-bold">الشركة والمسجل الضريبي</th>
                <th className="py-3 px-4 font-bold">نوع الضريبة</th>
                <th className="py-3 px-4 font-bold">الإقرار / النموذج الرسمي</th>
                <th className="py-3 px-4 font-bold">الفترة الضريبية</th>
                <th className="py-3 px-4 font-bold">تاريخ الاستحقاق والمهلة</th>
                <th className="py-3 px-4 font-bold">الموقف الضريبي</th>
                <th className="py-3 px-4 font-bold">تحليل الذكاء الاصطناعي والمخاطر</th>
                <th className="py-3 px-3 text-center font-bold">تفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
              {filteredRows.map((row) => {
                const isOverdue = row.status === 'overdue' || (typeof row.days_left === 'number' && row.days_left < 0)
                const isExpanded = expandedId === row.id
                const tax = row.tax || {}
                const taxType = tax.type || TAX_TYPES.general
                const days = typeof row.days_left === 'number' ? row.days_left : null

                return (
                  <Fragment key={row.id}>
                  <tr
                    className={`tax-table-row hover:bg-slate-50/75 dark:hover:bg-slate-900/50 transition-colors ${
                      isOverdue ? 'bg-red-50/30 dark:bg-red-950/15' : ''
                    }`}
                  >
                    {/* 1. Company */}
                    <td className="py-3 px-4 align-top">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 line-clamp-1" title={row.company_name}>
                        {row.company_name || 'شركة غير مسجلة'}
                      </div>
                      {row.company_tax_registration_number && (
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          رقم التسجيل: {row.company_tax_registration_number}
                        </div>
                      )}
                      <div className="text-xs text-slate-400 mt-0.5">
                        كود الحساب: {row.company_account_key || row.account_key}
                      </div>
                    </td>

                    {/* 2. Tax Type Badge */}
                    <td className="py-3 px-4 align-top">
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
                        style={{ backgroundColor: taxType.bg, color: taxType.color }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: taxType.color }} />
                        {taxType.shortLabel}
                      </span>
                      <div className="text-[11px] text-slate-500 mt-1 font-mono">
                        {tax.frequency || 'دوري'}
                      </div>
                    </td>

                    {/* 3. Official Form & Name */}
                    <td className="py-3 px-4 align-top">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {tax.officialTitle || row.title}
                      </div>
                      <div className="inline-flex items-center gap-1.5 mt-1">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                          {tax.formCode || row.title}
                        </span>
                        {row.title && row.title !== tax.officialTitle && (
                          <span className="text-[11px] text-slate-400" title={`كود البوابة الأصلي: ${row.title}`}>
                            (بوابة: {row.title})
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 4. Tax Period */}
                    <td className="py-3 px-4 align-top whitespace-nowrap">
                      <div className="font-medium text-slate-700 dark:text-slate-300">
                        {presentPeriod(row.period)}
                      </div>
                    </td>

                    {/* 5. Due Date & Countdown */}
                    <td className="py-3 px-4 align-top whitespace-nowrap">
                      {row.deadline ? <>
                        <div className="font-mono text-slate-800 dark:text-slate-200">
                          {row.deadline.slice(0, 10)}
                        </div>
                      </> : (
                        <div className="tax-deadline-unknown">
                          <strong>غير متاح من البوابة</strong>
                          <span>{row.deadline_basis === 'portal_live_screen' ? 'لم تعرض البوابة تاريخًا لهذا السجل' : 'لا يوجد تاريخ محفوظ'}</span>
                        </div>
                      )}
                      {row.deadline && days !== null ? (
                        <div className="mt-1">
                          {days < 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">
                              <AlertTriangle size={11} />
                              متأخر {legalDeadlines.formatArabicDays(Math.abs(days))}
                            </span>
                          ) : days === 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">
                              <Clock size={11} />
                              ينتهي اليوم
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              <Clock size={11} />
                              متبقٍ {legalDeadlines.formatArabicDays(days)}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </td>

                    {/* 6. Tax Status */}
                    <td className="py-3 px-4 align-top whitespace-nowrap">
                      {isOverdue ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                          <AlertTriangle size={12} />
                          متأخر (تستوجب غرامة)
                        </span>
                      ) : row.status === 'unsubmitted' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          <Clock size={12} />
                          غير مقدم
                        </span>
                      ) : row.status === 'resolved_unconfirmed' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          <CheckCircle2 size={12} />
                          معتمد / لم يطلب مجدداً
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          <CheckCircle2 size={12} />
                          {row.status || 'سارٍ'}
                        </span>
                      )}
                    </td>

                    {/* 7. AI Risk & Legal Study */}
                    <td className="py-3 px-4 align-top max-w-xs">
                      {row.ai_risk_score ? (
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              row.ai_risk_score === 'عالية'
                                ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                : row.ai_risk_score === 'متوسطة'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            }`}
                          >
                            مخاطرة {row.ai_risk_score}
                          </span>
                        </div>
                      ) : null}
                      {row.required_doc ? (
                        <p className="text-xs text-sky-800 dark:text-sky-300 font-semibold m-0">
                          📋 {row.required_doc}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-600 dark:text-slate-300 m-0">
                          {row.tax?.subType || 'التزام ضريبي دوري'}
                        </p>
                      )}
                    </td>

                    {/* 8. Expand Details Button */}
                    <td className="py-3 px-3 align-top text-center">
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                        onClick={() => toggleExpand(row.id)}
                        aria-expanded={isExpanded}
                        aria-label="عرض التفاصيل القانونية للالتزام"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="tax-detail-row">
                      <td colSpan={8}>
                        <section className="tax-record-detail" aria-label="تفاصيل الالتزام من البوابة">
                          <div className="tax-record-detail-item">
                            <span>تاريخ الموعد الظاهر في البوابة</span>
                            <strong>{portalDate(row.deadline) || 'غير متاح من البوابة'}</strong>
                            <small>{portalDate(row.deadline) ? 'تاريخ مصدره البوابة، وليس تقديراً من النظام.' : 'لم يلتقط الجامع تاريخاً لهذا السجل.'}</small>
                          </div>
                          <div className="tax-record-detail-item">
                            <span>موعد الرد القانوني</span>
                            <strong>{portalDate(row.respond_by) || 'غير محدد'}</strong>
                            <small>{portalDate(row.respond_by) ? 'يظهر فقط عند وجود مهلة رد محفوظة.' : 'لا توجد مهلة رد قانونية محفوظة لهذا السجل.'}</small>
                          </div>
                          <div className="tax-record-detail-item">
                            <span>آخر مزامنة من البوابة</span>
                            <strong>{observedAt(row.company_last_synced_at || row.updated_at, locale)}</strong>
                            <small>{row.company_last_synced_at ? 'وقت آخر فحص للحساب.' : 'وقت آخر تحديث للسجل داخل النظام.'}</small>
                          </div>
                          <div className="tax-record-detail-item tax-record-detail-action">
                            <span>الإجراء المطلوب</span>
                            <strong>{row.required_doc || row.tax?.subType || 'مراجعة السجل في البوابة'}</strong>
                            <small>الحالة: {row.source_status || row.status || 'غير محددة'}</small>
                          </div>
                        </section>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* 5. Enhanced Card View */
        <div className="tax-cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRows.map((row) => {
            const isOverdue = row.status === 'overdue' || (typeof row.days_left === 'number' && row.days_left < 0)
            const tax = row.tax || {}
            const taxType = tax.type || TAX_TYPES.general
            const days = typeof row.days_left === 'number' ? row.days_left : null

            return (
              <article
                key={row.id}
                className={`tax-card rounded-xl p-5 border transition-all ${
                  isOverdue
                    ? 'border-red-300 bg-red-50/20 dark:border-red-900 dark:bg-red-950/10 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-slate-300'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                      style={{ backgroundColor: taxType.bg, color: taxType.color }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: taxType.color }} />
                      {taxType.label}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                      {tax.formCode || row.title}
                    </span>
                  </div>

                  {isOverdue ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                      <AlertTriangle size={12} />
                      متأخر
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {row.status || 'سارٍ'}
                    </span>
                  )}
                </div>

                {/* Formal Tax Title */}
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 mb-1 leading-snug">
                  {tax.officialTitle || row.title}
                </h3>

                {/* Period & Code */}
                <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
                  <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                    <Calendar size={13} className="text-slate-400" />
                    الفترة: {presentPeriod(row.period)}
                  </span>
                  <span>·</span>
                  <span className="font-mono">كود ساب: {row.title}</span>
                </div>

                {/* Legal Deadline / Penalty Warning */}
                {tax.legalDeadlineNotice && (
                  <div className="p-3 mb-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs">
                    <div className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mb-1">
                      <Scale size={13} className="text-teal-600" />
                      <span>السند القانوني وفق قانون 206 لسنة 2020:</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 m-0 leading-relaxed">
                      {tax.legalDeadlineNotice}
                    </p>
                    {isOverdue && tax.penaltyWarning && (
                      <p className="text-red-600 dark:text-red-400 font-semibold m-0 mt-1.5 flex items-center gap-1">
                        <AlertTriangle size={12} />
                        {tax.penaltyWarning}
                      </p>
                    )}
                  </div>
                )}

                {/* Executive Document Briefing */}
                {row.required_doc && (
                  <div className="p-3 mb-3 rounded-lg bg-sky-50/70 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sky-800 dark:text-sky-300 flex items-center gap-1">
                        📋 المستند المطلوب قانوناً:
                      </span>
                      {row.legal_days && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                          المهلة القانونية: {row.legal_days} يوماً
                        </span>
                      )}
                    </div>
                    <p className="text-slate-800 dark:text-slate-200 font-semibold m-0">
                      {row.required_doc}
                    </p>
                    {row.deadline_basis && (
                      <p className="text-slate-500 text-[11px] m-0 mt-1">
                        السند القانوني: {row.deadline_basis}
                      </p>
                    )}
                  </div>
                )}

                {/* Card Footer: Company & Sync */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                  <div className="font-semibold text-slate-700 dark:text-slate-300 line-clamp-1 max-w-[200px]" title={row.company_name}>
                    {row.company_name}
                  </div>
                  <div className="font-mono text-slate-400">
                    {row.deadline ? `الاستحقاق: ${row.deadline.slice(0, 10)}` : 'لا يوجد ميعاد'}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
