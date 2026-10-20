'use client'

import { useCallback, useEffect, useState } from 'react'
import ChannelCenter from './channel-center.jsx'
import CapabilityCenter, { useCapabilityCenter } from './capability-center.jsx'
import AccountsManager from './accounts-manager.jsx'
import ApiKeysManager from './api-keys-manager.jsx'

async function readJson(response) {
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'تعذر إكمال الطلب')
  return value
}

function Switch({ checked, disabled, label, onChange }) {
  return (
    <button
      type="button"
      className={`setting-switch ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function StatePill({ healthy, tone, children }) {
  const resolved = tone || (healthy ? 'good' : 'muted')
  return <span className={`state-pill state-${resolved}`}><i />{children}</span>
}

/* Plan 4.1 §3: raw harness states must never reach the screen in English.
   `interrupted` covers both a mid-cycle pause and a process that died with the
   cycle still open — the two ways a scan stops without finishing. */
const CYCLE_STATE_LABELS = {
  running: { label: 'قيد الفحص', tone: 'busy' },
  done: { label: 'مكتملة', tone: 'good' },
  interrupted: { label: 'متوقفة', tone: 'muted' },
  aborted: { label: 'متوقفة', tone: 'muted' },
  failed: { label: 'فشلت', tone: 'bad' }
}

function cycleStateView(state) {
  return CYCLE_STATE_LABELS[state] || { label: 'غير معروفة', tone: 'muted' }
}

function SettingRow({ title, description, value, disabled, label, onChange, danger = false }) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <div className="setting-title">{title}</div>
        <div className="muted">{description}</div>
        {danger && <span className="warning-note">يحتاج تأكيدًا قبل التفعيل</span>}
      </div>
      <Switch checked={value} disabled={disabled} label={label || title} onChange={onChange} />
    </div>
  )
}

export default function SettingsForm() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [interval, setIntervalValue] = useState('120')
  const [quietHours, setQuietHours] = useState('01:00-06:00')
  const [managerInterval, setManagerInterval] = useState('30000')
  const [provider, setProvider] = useState('gemma4')
  const [scanTarget, setScanTarget] = useState('')
  const capabilities = useCapabilityCenter()

  const refresh = useCallback(async () => {
    const result = await readJson(await fetch('/api/settings', { cache: 'no-store' }))
    setData(result)
    setIntervalValue(result.settings.cycle_interval_min)
    setQuietHours(result.settings.quiet_hours)
    setManagerInterval(result.settings.assistant_manager_interval_ms)
    setProvider(result.settings.ai_provider)
  }, [])

  useEffect(() => {
    refresh().catch((caught) => setError(caught.message))
  }, [refresh])

  async function update(values, successMessage) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await readJson(await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values)
      }))
      await refresh()
      setNotice(successMessage || 'تم حفظ الإعداد')
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function action(name, confirmation, successMessage) {
    if (!window.confirm(confirmation)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await readJson(await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: name })
      }))
      await refresh()
      setNotice(successMessage)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function scanNow() {
    if (!scanTarget) {
      setError('اختر حسابًا واحدًا أو جميع الحسابات قبل طلب الفحص.')
      return
    }
    const allAccounts = scanTarget === '*'
    const count = allAccounts ? data?.source.accountCount || 0 : 1
    const selectedCompany = data?.scanTargets.find((target) => target.account_key === scanTarget)
    const scope = allAccounts ? `كل الحسابات المهيأة وعددها ${count}` : selectedCompany?.name || 'الحساب المحدد'
    if (!window.confirm(
      `سيبدأ فحصًا للقراءة فقط لنطاق: ${scope}. سيتنقل لعرض البيانات دون تعديل أو تقديم أو دفع، وقد يستغرق وقتًا. هل تريد المتابعة؟`
    )) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await readJson(await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'scan_now', account: allAccounts ? '' : scanTarget })
      }))
      await refresh()
      setNotice(`تم وضع فحص القراءة فقط في قائمة الانتظار (${result.accountCount} حساب).`)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function changeAutomation(enabled) {
    if (enabled && !window.confirm(
      `سيُفعّل الفحص المجدول كل ${interval} دقيقة خلال ساعات العمل المحددة. يقرأ النظام البوابة فقط ولا يرسل تقديمات أو ينفذ مدفوعات. هل تريد التفعيل؟`
    )) return
    await update({ automation_enabled: enabled }, enabled ? 'تم تفعيل الفحص المجدول' : 'تم إيقاف الفحص المجدول')
  }

  async function changeManager(enabled) {
    if (!enabled && !window.confirm('سيتم إيقاف المراقبة المحلية والتنبيهات الاستباقية حتى تعيد تفعيلها. هل تريد المتابعة؟')) return
    await update({ assistant_manager_enabled: enabled }, enabled ? 'تم تفعيل مدير المساعد' : 'تم إيقاف مدير المساعد')
  }

  async function changeProvider(nextProvider) {
    if (nextProvider === 'mistral' && !window.confirm(
      'تنبيه خصوصية: ستُرسل رسائلك والسياق المحلي الذي يختاره المساعد إلى Mistral عبر الإنترنت. لا تُرسل كلمات المرور أو مفاتيح الدخول. هل توافق وتريد التفعيل؟'
    )) return
    if (nextProvider === 'mistral') {
      await update({ ai_provider: 'mistral', ai_allow_cloud: true }, 'تم تفعيل Mistral بعد موافقتك على نقل سياق المحادثة')
      return
    }
    await update({ ai_provider: nextProvider, ai_allow_cloud: false }, 'تم اختيار Gemma 4 المحلي')
  }

  async function capabilityRequest(action, capability, confirmation, successMessage) {
    if (confirmation && !window.confirm(confirmation)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await readJson(await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, capability })
      }))
      await Promise.all([refresh(), capabilities.refresh()])
      setNotice(result.message || successMessage)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  function toggleCapability(capability, paused) {
    const title = {
      local_assistant: 'المساعد المحلي (Gemma 4)',
      cloud_reviewer: 'المراجع السحابي (Mistral)',
      system_adviser: 'مستشار النظام (OpenCode)'
    }[capability] || capability
    const confirmation = paused
      ? `سيُوقَف «${title}» فورًا. لن يتم أي طلب منه حتى تعيد تشغيله، ولن يتحول إلى بديل سحابي.`
      : `سيُستأنف «${title}». سيبقى الإرسال السحابي متوقفًا حتى موافقة صريحة على كل حالة.`
    return capabilityRequest(
      paused ? 'pause_capability' : 'resume_capability',
      capability,
      confirmation,
      paused ? `تم إيقاف ${title}` : `تم استئناف ${title}`
    )
  }

  function probeCapability(capability) {
    return capabilityRequest(
      'probe_capability',
      capability,
      null,
      `تم فحص «${capability}» برسالة اصطناعية لا تحتوي أي بيانات مكتب.`
    )
  }

  function toggleProposals(enabled) {
    if (enabled && !window.confirm(
      'سيتيح هذا للمالك فقط طلب مقترح هندسي. يُرسل ملف مصدر مُنقّى إلى OpenCode، ولا تصل إليه قاعدة البيانات أو شركة أو دفعة أو مستند أو بوابة أو سر، ولا تُعدَّل الملفات تلقائيًا. هل تريد التفعيل؟'
    )) return
    return update(
      { opencode_proposals_enabled: enabled },
      enabled ? 'تم تفعيل طلبات المقترحات الهندسية' : 'تم إيقاف طلبات المقترحات الهندسية'
    )
  }

  async function changeMessageMode(enabled) {
    if (!enabled) {
      await update({ message_mode: 'dry-run' }, 'الإرسال الخارجي متوقف؛ الرسائل تسجل محليًا فقط')
      return
    }
    if (!data?.capabilities.liveDeliveryReady) return
    await update({ message_mode: 'live', confirm_live_delivery: true }, 'تم تفعيل الإرسال الحقيقي بعد التأكيد')
  }

  async function saveSchedule(event) {
    event.preventDefault()
    await update({
      cycle_interval_min: interval,
      quiet_hours: quietHours,
      assistant_manager_interval_ms: managerInterval
    }, 'تم حفظ مواعيد التشغيل')
  }

  if (error && !data) return <div className="panel error" role="alert">{error}</div>
  if (!data) return <div className="panel loading-state"><span className="loading-mark" />جارٍ تحميل حالة الإعدادات المحلية…</div>

  const status = data.status || {}
  const managerOnline = data.manager?.state === 'online'
  const automationOn = data.settings.automation_enabled === 'true'
  const managerOn = data.settings.assistant_manager_enabled !== 'false'
  const liveOn = data.settings.message_mode === 'live'
  const startPaused = Boolean(status.paused)
  const localCapability = capabilities.report?.capabilities.find((item) => item.id === 'local_assistant')

  return (
    <div className="settings-page stack">
      <div className="page-heading between">
        <div>
          <div className="eyebrow">مركز التحكم المحلي</div>
          <h1>الإعدادات</h1>
          <p className="muted">كل مفتاح يوضح أثره الفعلي وحالة تكوينه. لا نعرض الأسرار ولا ننشئ مستخدمين.</p>
        </div>
        <span className="local-badge"><i /> يعمل على هذا الجهاز</span>
      </div>

      {(error || notice) && <div className={error ? 'notice-error' : 'notice-success'} role={error ? 'alert' : 'status'}>{error || notice}</div>}

      <section className="settings-health grid">
        <article className="health-card">
          <div className="health-icon icon-teal">◉</div>
          <div className="health-label">محرك الفحص</div>
          <strong>{status.state || 'غير معروف'}</strong>
          <span className="muted">{status.last_heartbeat ? `آخر نبض ${formatDate(status.last_heartbeat)}` : 'لم يصل نبض بعد'}</span>
        </article>
        <article className="health-card">
          <div className="health-icon icon-blue">✦</div>
          <div className="health-label">مدير المساعد</div>
          <strong>{managerOn ? data.manager?.state || 'يبدأ' : 'متوقف من الإعدادات'}</strong>
          <span className="muted">{data.manager?.last_run_at ? `آخر مراجعة ${formatDate(data.manager.last_run_at)}` : 'لم يبدأ بعد'}</span>
        </article>
        <article className="health-card">
          <div className="health-icon icon-amber">⌁</div>
          <div className="health-label">المساعد المحلي</div>
          <strong>{localCapability?.label || 'Gemma 4'}</strong>
          <StatePill healthy={localCapability?.tone === 'good'}>
            {localCapability?.paused ? 'متوقف من مركز التحكم' : localCapability?.tone === 'bad' ? 'غير متاح' : 'يعمل على هذا الجهاز'}
          </StatePill>
        </article>
        <article className="health-card">
          <div className="health-icon icon-violet">↗</div>
          <div className="health-label">تسليم الرسائل</div>
          <strong>{liveOn ? 'إرسال حقيقي' : 'تجربة محلية فقط'}</strong>
          <StatePill healthy={!liveOn}>{liveOn ? 'تأكد من المستلمين' : 'لا يخرج شيء'}</StatePill>
        </article>
      </section>

      <section className="settings-section panel">
        <div className="section-heading">
          <span className="section-index">01</span>
          <div><h2>الفحص والمتابعة</h2><p className="muted">تحكم في الرصد المجدول والفحص اليدوي، مع الحفاظ على حدود القراءة فقط.</p></div>
        </div>
        <SettingRow
          title="الفحص المجدول"
          description={automationOn ? `نشط كل ${data.settings.cycle_interval_min} دقيقة خارج ساعات الهدوء.` : 'متوقف. لن يبدأ فحص تلقائي.'}
          value={automationOn}
          disabled={busy || (!automationOn && !data.source.ready)}
          danger
          onChange={changeAutomation}
        />
        {!data.source.ready && (
          <p className="inline-alert">
            {data.source.error ? `مصدر الحسابات غير جاهز: ${data.source.error}` : 'لا توجد حسابات مهيأة للفحص. لم تتم إضافة أي حساب أو إنشاء أي مستخدم.'}
          </p>
        )}
        <form className="schedule-grid" onSubmit={saveSchedule}>
          <label>الفاصل بين الفحوصات
            <span className="input-with-unit"><input type="number" min="5" max="1440" value={interval} onChange={(event) => setIntervalValue(event.target.value)} /><span>دقيقة</span></span>
          </label>
          <label>ساعات الهدوء — توقيت القاهرة
            <input value={quietHours} onChange={(event) => setQuietHours(event.target.value)} placeholder="01:00-06:00" />
          </label>
          <label>مراجعة مدير المساعد كل
            <span className="input-with-unit"><input type="number" min="5" max="300" value={Math.round(Number(managerInterval) / 1000)} onChange={(event) => setManagerInterval(String(Number(event.target.value) * 1000))} /><span>ثانية</span></span>
          </label>
          <button className="button-secondary" disabled={busy}>حفظ الجدول</button>
        </form>
        <SettingRow
          title="مدير المساعد الاستباقي"
          description="يراجع الالتزامات والتنبيهات المحلية ويحدّث قائمة ما يحتاج الانتباه."
          value={managerOn}
          disabled={busy}
          onChange={changeManager}
        />
        <div className="action-strip">
          <div>
            <strong>حالة المحرك: {startPaused ? 'متوقف مؤقتًا' : status.state || 'غير معروف'}</strong>
            <p className="muted">الحساب الجاري: {status.current_account || 'لا يوجد'} · الدورة التالية: {formatDate(status.next_cycle_at)}</p>
          </div>
          <label className="scan-scope">نطاق الفحص
            <select value={scanTarget} onChange={(event) => setScanTarget(event.target.value)} disabled={busy || !data.source.ready}>
              <option value="">اختر النطاق</option>
              {data.scanTargets.map((target) => <option key={target.account_key} value={target.account_key}>{target.name} — {target.account_key}</option>)}
              <option value="*">كل حسابات V8 المسجّلة مسبقًا ({data.source.accountCount})</option>
            </select>
          </label>
          {startPaused
            ? <button className="button-secondary" disabled={busy} onClick={() => action('resume', 'سيُستأنف المحرك. إذا كان الفحص المجدول مفعّلًا فقد يبدأ فحص قراءة فقط. هل تريد المتابعة؟', 'تم استئناف المحرك.')}>استئناف المحرك</button>
            : <button className="button-secondary" disabled={busy} onClick={() => action('pause', 'سيتم إيقاف الفحوصات القادمة مؤقتًا. قد ينتهي فحص الحساب الجاري أولًا. هل تريد المتابعة؟', 'تم إيقاف المحرك مؤقتًا.')}>إيقاف مؤقت</button>}
          <button className="button-primary" disabled={busy || !data.source.ready || !scanTarget} onClick={scanNow}>فحص الآن — قراءة فقط</button>
        </div>
      </section>

      <section className="settings-section panel">
        <div className="section-heading">
          <span className="section-index">02</span>
          <div>
            <h2>مركز القدرات والخصوصية</h2>
            <p className="muted">ثلاث قدرات منفصلة لا تُستبدل одна بأخرى. المساعد المحلي هو الافتراضي، ولا تنتقل المحادثات إلى السحابة إلا بموافقة صريحة على كل حالة.</p>
          </div>
        </div>
        <CapabilityCenter
          report={capabilities.report}
          busy={capabilities.busy}
          proposalsEnabled={data.settings.opencode_proposals_enabled === 'true'}
          onToggleProposals={toggleProposals}
          onPause={toggleCapability}
          onProbe={probeCapability}
        />
      </section>

      <section className="settings-section panel">
        <ChannelCenter
          channels={data.capabilities.channels}
          linkedRecipients={data.capabilities.linkedChannels}
          liveDeliveryReady={data.capabilities.liveDeliveryReady}
          liveOn={liveOn}
          busy={busy}
          onModeChange={changeMessageMode}
          onConnected={refresh}
        />
      </section>

      <section className="settings-section panel">
        <div className="section-heading">
          <span className="section-index">04</span>
          <div><h2>البيانات وسجل العمل</h2><p className="muted">أعداد فعلية من قاعدة البيانات المحلية؛ لا توجد بيانات تجريبية أو مستوردة تلقائيًا.</p></div>
        </div>
        <div className="record-count-grid">
          {[
            ['الشركات', data.counts.companies], ['المهام المفتوحة', data.counts.tasks],
            ['الالتزامات المفتوحة', data.counts.obligations],
            ['حالة الالتزام غير محددة', data.counts.unknownObligations],
            ['المدفوعات المسجلة', data.counts.payments],
            ['الرسائل', data.counts.messages], ['غير المقروءة', data.counts.unreadMessages],
            ['الإخفاقات المفتوحة', data.counts.openFailures], ['ما يحتاج الانتباه', data.counts.openAttention]
          ].map(([name, count]) => <div className="record-count" key={name}><span>{name}</span><strong>{count}</strong></div>)}
        </div>
        <div className="source-status between">
          <div><strong>مصدر الحسابات المحلي</strong><p className="muted">{data.source.ready ? `${data.source.accountCount} حسابًا مسجلًا في قاعدة بيانات V8؛ لم تتم إضافتها أو فحصها بفتح هذه الصفحة.` : data.source.error || 'لا توجد حسابات مهيأة'}</p></div>
          <StatePill healthy={data.source.ready}>{data.source.ready ? 'جاهز للفحص اليدوي' : 'غير جاهز'}</StatePill>
        </div>
        {data.lastCycle && (() => {
          const cycleView = cycleStateView(data.lastCycle.state)
          return (
            <div className="source-status between">
              <div>
                <strong>آخر دورة فحص</strong>
                <p className="muted">
                  {formatDate(data.lastCycle.started_at)} · {data.lastCycle.accounts_processed}/{data.lastCycle.accounts_total} تمت · {data.lastCycle.accounts_failed} إخفاق
                </p>
              </div>
              <StatePill tone={cycleView.tone}>{cycleView.label}</StatePill>
            </div>
          )
        })()}
      </section>

      <AccountsManager />

      <ApiKeysManager />

      <section className="guardrail-card">
        <span className="guardrail-symbol">✓</span>
        <div><strong>حدود ثابتة لا يمكن تغييرها من الإعدادات</strong>
          <p>النظام يتنقل ويقرأ فقط. لا يقدم كشوف الرواتب، لا يعدّل بيانات البوابة، ولا ينشئ أو يؤكد مدفوعات.</p>
        </div>
        <span className="tag">حماية مدمجة</span>
      </section>
      <p className="settings-footnote">تُحفظ إعداداتك على هذا الجهاز، وتبقى بيانات الربط مخفية عن الشاشة.</p>
    </div>
  )
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo'
    }).format(date)
}
