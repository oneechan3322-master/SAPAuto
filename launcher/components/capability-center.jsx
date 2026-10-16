'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, CircleSlash, Cloud, Cpu, Radio, ShieldCheck, Terminal
} from 'lucide-react'

/**
 * Plan 2.0 §3.2 — the Control Center shows three capabilities that are never
 * interchangeable. Each block states what it is, what it may touch, its live
 * state, and a pause control. Nothing here exposes a key or a secret path.
 */

const ICONS = { local_assistant: Cpu, cloud_reviewer: Cloud, system_adviser: Terminal }

export default function CapabilityCenter({ report, busy, onPause, onProbe, onToggleProposals, proposalsEnabled }) {
  if (!report) return null
  return (
    <div className="capability-center">
      {report.capabilities.map((capability) => (
        <CapabilityBlock
          key={capability.id}
          capability={capability}
          policyVersion={report.policyVersion}
          busy={busy}
          onPause={onPause}
          onProbe={onProbe}
          proposalsEnabled={proposalsEnabled}
          onToggleProposals={onToggleProposals}
        />
      ))}
      <ConsentNote copy={report.consentCopy} />
    </div>
  )
}

function CapabilityBlock({ capability, policyVersion, busy, onPause, onProbe, proposalsEnabled, onToggleProposals }) {
  const Icon = ICONS[capability.id] || Cpu
  const paused = capability.paused
  const pauseLabel = capability.id === 'cloud_reviewer'
    ? (paused ? 'استئناف المراجعات السحابية' : 'إيقاف كل المراجعات السحابية')
    : (paused ? 'استئناف' : (capability.id === 'local_assistant' ? 'إيقاف المساعد المحلي' : 'إيقاف المستشار'))

  return (
    <article className={`capability-block tone-${capability.tone} ${paused ? 'is-paused' : ''}`} data-boundary={capability.boundary}>
      <header className="capability-block-head">
        <span className="capability-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.7} /></span>
        <div className="capability-heading">
          <h3>{capability.title}</h3>
          <p className="capability-provider">{capability.provider}</p>
        </div>
        <span className={`capability-state state-${capability.tone}`}>{capability.label}</span>
      </header>

      <p className="capability-privacy"><ShieldCheck size={13} aria-hidden="true" />{capability.privacy}</p>

      {capability.id === 'local_assistant' && <LocalAssistantFacts />}
      {capability.id === 'cloud_reviewer' && <CloudReviewerFacts paused={paused} />}
      {capability.id === 'system_adviser' && (
        <SystemAdviserFacts configured={capability.configured} enabled={proposalsEnabled} />
      )}

      <footer className="capability-actions">
        {capability.id === 'system_adviser' && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy || (!capability.configured && !proposalsEnabled)}
            onClick={() => onToggleProposals(!proposalsEnabled)}
          >
            {proposalsEnabled ? 'إيقاف طلبات المقترحات' : 'تفعيل طلبات المقترحات'}
          </button>
        )}
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={() => onProbe(capability.id)}
        >
          <Radio size={14} aria-hidden="true" /> فحص آمن
        </button>
        <button
          className={`button-secondary ${paused ? 'button-primary' : ''}`}
          type="button"
          disabled={busy}
          onClick={() => onPause(capability.id, !paused)}
        >
          {paused ? <CheckCircle2 size={14} aria-hidden="true" /> : <CircleSlash size={14} aria-hidden="true" />}
          {pauseLabel}
        </button>
        <span className="capability-policy">سياسة التنقيح {policyVersion}</span>
      </footer>
    </article>
  )
}

function LocalAssistantFacts() {
  return (
    <ul className="capability-facts">
      <li><span>الحدود</span><strong>هذا الجهاز فقط — لا شبكة</strong></li>
      <li><span>عند التوقف</span><strong>لا يتحول تلقائيًا إلى السحابة</strong></li>
    </ul>
  )
}

function CloudReviewerFacts({ paused }) {
  return (
    <ul className="capability-facts">
      <li><span>الترشيح</span><strong>قراءة فقط — لا يصبح بديلًا تلقائيًا</strong></li>
      <li><span>الموافقة</span><strong>لكل حالة على حدة، وتنتهي خلال 24 ساعة</strong></li>
      <li><span>الاختبار</span><strong>رسالة اصطناعية واحدة فقط</strong></li>
      {paused && <li className="is-warn"><span>الحالة</span><strong>كل المراجعات السحابية متوقفة</strong></li>}
    </ul>
  )
}

function SystemAdviserFacts({ configured, enabled }) {
  return (
    <ul className="capability-facts">
      <li><span>النطاق</span><strong>الشيفرة والتشخيص فقط</strong></li>
      <li><span>ممنوع عنه</span><strong>قاعدة البيانات، شركة، دفعة، مستند، بوابة، سر</strong></li>
      <li>
        <span>العلب</span>
        <strong>{configured ? 'مقترح جديد · قيد المراجعة · مقبول يدويًا · مرفوض' : 'غير متاح قبل التهيئة'}</strong>
      </li>
      <li>
        <span>طلبات المقترحات</span>
        <strong>{enabled ? 'مسموح للمالك فقط' : 'متوقف — أضف زر «تفعيل طلبات المقترحات» أدناه'}</strong>
      </li>
    </ul>
  )
}

function ConsentNote({ copy }) {
  return (
    <section className="consent-note" aria-labelledby="consent-title">
      <header>
        <AlertTriangle size={15} aria-hidden="true" />
        <h3 id="consent-title">{copy.heading}</h3>
      </header>
      <p className="muted">{copy.intro}</p>
      <p className="consent-default">{copy.defaultChoice}</p>
      <p className="consent-expiry">{copy.expires}</p>
      <p className="consent-never-title">{copy.neverSendTitle}</p>
      <ul className="consent-never">
        {copy.neverSend.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p className="consent-probe muted">{copy.probeNote}</p>
    </section>
  )
}

export function useCapabilityCenter() {
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const response = await fetch('/api/capabilities', { cache: 'no-store' })
    if (!response.ok) return
    setReport(await response.json())
  }, [])
  useEffect(() => { refresh().catch(() => {}) }, [refresh])
  return { report, busy, setBusy, refresh }
}