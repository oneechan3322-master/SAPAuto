'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useState, useMemo, useCallback } from 'react'
import {
  AlertTriangle, Clock, CheckCircle, Calendar, XCircle,
  MessageSquare, ArrowRight, ShieldAlert, PhoneCall,
  Radio, Building2, CreditCard, ClipboardList
} from 'lucide-react'

const REFRESH_INTERVAL_MS = 5000

const fetcher = async (url) => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Secretary fetch failed: ${response.status}`)
  }
  return response.json()
}

/**
 * Compute years overdue relative to a reference date.
 * @param {string} dateStr - ISO date string e.g. '2018-12-31'
 * @param {string} refDateStr - ISO reference e.g. '2026-10-16'
 * @returns {number} integer years overdue (0 if not overdue)
 */
function getOverdueYears(dateStr, refDateStr) {
  if (!dateStr || typeof dateStr !== 'string') return 0
  const due = new Date(dateStr)
  if (Number.isNaN(due.getTime())) return 0
  const ref = refDateStr ? new Date(refDateStr) : new Date()
  if (Number.isNaN(ref.getTime())) return 0
  const diffMs = ref.getTime() - due.getTime()
  if (diffMs <= 0) return 0
  return Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000))
}

function getOverdueDays(dateStr, refDateStr) {
  if (!dateStr || typeof dateStr !== 'string') return 0
  const due = new Date(dateStr)
  if (Number.isNaN(due.getTime())) return 0
  const ref = refDateStr ? new Date(refDateStr) : new Date()
  if (Number.isNaN(ref.getTime())) return 0
  const diffMs = ref.getTime() - due.getTime()
  if (diffMs <= 0) return 0
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

/** Format a date for display using Cairo timezone. */
function formatDateCairo(dateStr) {
  if (!dateStr) return ''
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00Z` : dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      dateStyle: 'medium',
      timeZone: 'Africa/Cairo'
    }).format(date)
  } catch {
    return dateStr
  }
}

export default function SecretaryPanel() {
  const { data, error, isLoading } = useSWR('/api/status', fetcher, {
    refreshInterval: REFRESH_INTERVAL_MS
  })
  const [aiLogs, setAiLogs] = useState([
    'Secretary AI initialized: Live sync active.',
    'Scanning attention queue for critical items...'
  ])
  const [activeIdx, setActiveIdx] = useState(0)
  const [dismissedBlocks, setDismissedBlocks] = useState(new Set())

  const logAction = useCallback((message) => {
    if (!message || typeof message !== 'string') return
    const timestamp = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' })
    setAiLogs((prev) => [`[${timestamp}] ${message}`, ...prev.slice(0, 99)])
  }, [])

  const currentTime = data?.currentTime || new Date().toISOString()
  const refDate = currentTime.slice(0, 10)

  // Build actionable items from live attention + payment data
  const actionableItems = useMemo(() => {
    if (!data?.attention) return []
    return data.attention.map((item, idx) => {
      const overdueYears = getOverdueYears(item.dueDate || '', refDate)
      const overdueDays = getOverdueDays(item.dueDate || '', refDate)
      return {
        ...item,
        idx,
        overdueYears,
        overdueDays,
        blockId: `block-${idx}`,
        blockCleared: dismissedBlocks.has(`block-${idx}`)
      }
    })
  }, [data?.attention, refDate, dismissedBlocks])

  const current = actionableItems[activeIdx] || null

  const clearBlock = useCallback((blockId) => {
    if (!blockId || typeof blockId !== 'string') return
    setDismissedBlocks((prev) => new Set(prev).add(blockId))
    logAction('Pre-requisite task cleared. Processing pathway unlocked.')
  }, [logAction])

  const handleAction = useCallback((actionType) => {
    if (!current) return
    if (!current.blockCleared) {
      logAction(`⚠️ BLOCKED: Cannot "${actionType}" until the pre-requisite task is finished!`)
      return
    }
    const MAX_IDX = actionableItems.length - 1
    switch (actionType) {
      case 'done':
        logAction(`✅ Marked "${current.companyName || current.title}" as reconciled in ledger.`)
        break
      case 'sunday':
        logAction('📅 Rescheduled. AI alert set for Sunday morning 09:00 AM (Africa/Cairo).')
        break
      case 'ignore':
        logAction('🗑️ Dismissed notice. Logged under temporary ignore state.')
        break
      default:
        logAction(`Unknown action type: ${actionType}`)
        return
    }
    if (activeIdx < MAX_IDX) {
      setActiveIdx((prev) => prev + 1)
    }
  }, [current, activeIdx, actionableItems.length, logAction])

  const counts = data?.counts || {}
  const today = formatDateCairo(currentTime)

  return (
    <div className="w-full max-w-5xl mx-auto p-6 bg-slate-900 text-slate-100 rounded-xl shadow-2xl font-sans border border-slate-800">
      {/* Top Banner */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-emerald-400 tracking-wide flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
            SapAuto Secretary OS v8
          </h1>
          <p className="text-xs text-slate-400 mt-1">{today} · 24/7 Live Sync · No Login Required</p>
        </div>
        <div className="text-right flex items-center gap-2">
          <span className="bg-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-md font-mono border border-slate-700">
            {data ? `${counts.openAttention ?? 0} open items` : 'Connecting...'}
          </span>
          <span className={`h-2.5 w-2.5 rounded-full ${data ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/50 border border-rose-500/50 rounded-lg p-3 mb-4 text-sm text-rose-300">
          <AlertTriangle size={14} className="inline mr-1" />
          {error.message || 'Connection error'}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-3 p-8 justify-center text-slate-400">
          <span className="h-4 w-4 rounded-full bg-emerald-500 animate-pulse" />
          جارٍ المزامنة مع مساحة العمل...
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Active item + Supervisor + Actions */}
          <div className="lg:col-span-2 space-y-5">

            {/* Summary Strip */}
            <div className="grid grid-cols-3 gap-2">
              <SummaryCell icon={Building2} label="شركات" value={counts.companies} accent="var(--accent, #6ee7b7)" />
              <SummaryCell icon={CreditCard} label="مدفوعات مفتوحة" value={counts.openPayments} accent="var(--overdue, #f87171)" />
              <SummaryCell icon={ClipboardList} label="مهام" value={counts.openTasks} accent="var(--info, #60a5fa)" />
            </div>

            {/* Current Analyzing Entry */}
            {current ? (
              <>
                <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 block mb-2">
                    Currently Analyzing Entry {activeIdx + 1} / {actionableItems.length}
                  </span>
                  <div className="flex justify-between items-start gap-4 flex-wrap">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-200 break-words">{current.companyName || 'اسم غير مسجّل'}</h3>
                      <div className="flex gap-3 mt-2 text-xs flex-wrap">
                        <span className="text-amber-400 font-mono">&quot;{current.title}&quot;</span>
                        {current.details && (
                          <>
                            <span className="text-slate-400">|</span>
                            <span className="text-slate-300 font-medium">{current.details}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs block text-slate-400">Tone</span>
                      <span className={`text-sm font-mono font-bold ${current.tone === 'urgent' ? 'text-rose-400' : 'text-amber-400'}`}>
                        {current.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tax Supervisor Intervention */}
                {current.tone === 'urgent' && (
                  <div className="bg-rose-950/40 border-2 border-rose-500/60 rounded-xl p-5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 bg-rose-500 text-slate-950 text-[10px] uppercase tracking-wider font-extrabold px-3 py-1 rounded-bl-lg flex items-center gap-1">
                      <ShieldAlert size={12} /> Live Tax Audit Overlay
                    </div>
                    <div className="flex items-start gap-4 mt-2">
                      <div className="p-3 bg-rose-500/20 text-rose-400 rounded-lg shrink-0">
                        <AlertTriangle size={28} />
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-rose-300">
                          Tax Supervisor Intervention
                        </h4>
                        <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                          The item <span className="underline decoration-rose-400 font-semibold text-white">&quot;{current.title}&quot;</span>
                          {current.overdueYears > 0 && (
                            <> has been delinquent for over <span className="text-rose-400 font-bold underline font-mono">{current.overdueYears} years</span>! </>
                          )}
                          {current.overdueDays > 0 && current.overdueYears === 0 && (
                            <> is overdue by <span className="text-rose-400 font-bold font-mono">{current.overdueDays} days</span>. </>
                          )}
                          This is a critical corporate liability risk. Standard automated workflows are overridden.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Blocking Pre-requisite */}
                <div className={`p-5 rounded-xl border transition-all duration-300 ${
                  current.blockCleared
                    ? 'bg-emerald-950/20 border-emerald-800/60 opacity-75'
                    : 'bg-amber-950/30 border-amber-600/60'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <Clock size={14} /> Mandatory Pre-requisite
                    </span>
                    {current.blockCleared ? (
                      <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <CheckCircle size={12} /> Unlocked
                      </span>
                    ) : (
                      <span className="bg-amber-500/20 text-amber-400 text-xs px-2 py-0.5 rounded-full font-medium">
                        Blocking Actions
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${current.blockCleared ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {current.type === 'payment' ? <CreditCard size={18} /> : <Calendar size={18} />}
                      </div>
                      <p className={`text-sm break-words ${current.blockCleared ? 'line-through text-slate-400' : 'text-slate-100 font-medium'}`}>
                        Review and verify this item before taking action
                      </p>
                    </div>
                    {!current.blockCleared && (
                      <button
                        onClick={() => clearBlock(current.blockId)}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-lg transition shrink-0 shadow-md cursor-pointer"
                        type="button"
                      >
                        Mark as Reviewed
                      </button>
                    )}
                  </div>
                </div>

                {/* Action Dispatcher */}
                <div className="bg-slate-950 p-6 rounded-xl border border-slate-800">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Secretary Action Dispatcher</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <ActionButton
                      icon={CheckCircle}
                      label="It's Done"
                      sublabel="Reconcile Ledger"
                      onClick={() => handleAction('done')}
                      disabled={!current.blockCleared}
                      hoverBorder="hover:border-emerald-500/50"
                      hoverBg="hover:bg-emerald-950/20"
                    />
                    <ActionButton
                      icon={Calendar}
                      label="Remind Me Sunday"
                      sublabel="Snooze Alert Cycle"
                      onClick={() => handleAction('sunday')}
                      disabled={!current.blockCleared}
                      hoverBorder="hover:border-blue-500/50"
                      hoverBg="hover:bg-blue-950/20"
                    />
                    <ActionButton
                      icon={XCircle}
                      label="Ignore"
                      sublabel="Mute Notification"
                      onClick={() => handleAction('ignore')}
                      disabled={!current.blockCleared}
                      hoverBorder="hover:border-slate-600"
                      hoverBg="hover:bg-slate-800"
                    />
                  </div>
                  {!current.blockCleared && (
                    <p className="text-xs text-amber-400/80 mt-3 text-center">
                      🔒 Quick action keys locked until pre-requisite obligations are finished.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-slate-950 p-8 rounded-lg border border-slate-800 text-center">
                <CheckCircle size={32} className="text-emerald-400 mx-auto mb-3" />
                <p className="text-slate-300 font-medium">لا توجد تنبيهات تحتاج انتباهك الآن</p>
                <p className="text-slate-500 text-xs mt-1">Secretary AI is monitoring. You&apos;ll be notified when action is needed.</p>
              </div>
            )}
          </div>

          {/* Right Column: AI Logs + Item Navigation */}
          <div className="space-y-5">
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 max-h-[420px] overflow-y-auto">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MessageSquare size={12} /> Secretary LLM Runtime Logs
              </h4>
              {aiLogs.map((log, idx) => (
                <p key={`log-${idx}`} className="text-[11px] font-mono text-slate-400 border-b border-slate-800/50 py-1.5 leading-relaxed">
                  {log}
                </p>
              ))}
            </div>

            {actionableItems.length > 1 && (
              <div className="bg-slate-950 rounded-xl border border-slate-800 p-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Navigation</h4>
                <div className="flex gap-2 flex-wrap">
                  {actionableItems.map((_, index) => (
                    <button
                      key={`nav-${index}`}
                      onClick={() => setActiveIdx(index)}
                      type="button"
                      className={`text-xs py-1.5 px-3 rounded font-medium transition cursor-pointer ${
                        activeIdx === index
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      #{index + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Links */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 space-y-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Quick Links</h4>
              <QuickLink href="/payments" label="المدفوعات" count={counts.openPayments} />
              <QuickLink href="/tasks" label="المهام" count={counts.openTasks} />
              <QuickLink href="/companies" label="الشركات" count={counts.companies} />
              <QuickLink href="/obligations" label="الالتزامات" count={counts.openObligations} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCell({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center" style={{ '--cell-accent': accent }}>
      <Icon size={16} className="mx-auto mb-1 text-slate-400" />
      <div className="text-lg font-bold text-slate-100">{value ?? '–'}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
    </div>
  )
}

function ActionButton({ icon: Icon, label, sublabel, onClick, disabled, hoverBorder, hoverBg }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      className={`flex flex-col items-center justify-center p-4 bg-slate-900 border border-slate-800 ${hoverBorder} ${hoverBg} disabled:opacity-40 disabled:hover:bg-slate-900 disabled:hover:border-slate-800 text-slate-200 rounded-xl transition text-center cursor-pointer`}
    >
      <Icon size={22} className="mb-2" />
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-[10px] text-slate-400 mt-0.5">{sublabel}</span>
    </button>
  )
}

function QuickLink({ href, label, count }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between text-sm text-slate-300 hover:text-emerald-400 transition py-1.5 px-2 rounded hover:bg-slate-800/50"
    >
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-slate-500">{count ?? 0}</span>
        <ArrowRight size={12} />
      </span>
    </Link>
  )
}
