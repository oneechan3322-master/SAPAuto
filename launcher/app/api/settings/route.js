import { createRequire } from 'node:module'
import { db } from '../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'
import { audit, now } from '../../../../db/queries/shared.js'
import sharedRecordCounts from '../../../../domain/record-counts.cjs'
import aiCapabilities from '../../../../domain/ai-capabilities.cjs'
import capabilityService from '../../../../assistant/capabilities.js'
import proposals from '../../../../assistant/code-proposals.js'

const require = createRequire(import.meta.url)
const { listAccounts } = require('../../../../harness/source.js')
const { createCommand } = require('../../../../db/queries/commands.js')
const secureStore = require('../../../../channels/secure-store.js')

const DEFAULTS = {
  cycle_interval_min: '120',
  quiet_hours: '01:00-06:00',
  automation_enabled: 'false',
  assistant_manager_enabled: 'true',
  assistant_manager_interval_ms: process.env.V8_ASSISTANT_MANAGER_INTERVAL_MS || '30000',
  message_mode: 'dry-run',
  ai_provider: 'gemma4',
  ai_allow_cloud: 'false',
  opencode_proposals_enabled: 'false'
}

const EDITABLE = new Set(Object.keys(DEFAULTS))

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? DEFAULTS[key]
}

function boolSetting(key) {
  return getSetting(key) === 'true'
}

function capabilities() {
  const telegram = secureStore.hasStoredCredentials('telegram') || Boolean(process.env.TELEGRAM_BOT_TOKEN)
  const gmail = secureStore.hasStoredCredentials('gmail') || Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
  const linkedChannels = db.prepare(`SELECT COUNT(*) AS n FROM user_channels c
    JOIN users u ON u.id=c.user_id WHERE u.disabled=0 AND c.verified_at IS NOT NULL`).get().n
  const deliveryProviders = [telegram, gmail].filter(Boolean).length
  return {
    // Plan 2.4 §3.3 — only channels that can genuinely be used are advertised.
    channels: [
      { id: 'email', name: 'Gmail', configured: gmail, description: gmail ? 'جاهز لاستقبال التنبيهات' : 'اربط بريدك لاستقبال التنبيهات' },
      { id: 'telegram', name: 'Telegram', configured: telegram, description: telegram ? 'جاهز لاستقبال التنبيهات' : 'اربط بوتك لاستقبال التنبيهات' }
    ],
    linkedChannels,
    liveDeliveryReady: linkedChannels > 0 && deliveryProviders > 0,
    providerCount: deliveryProviders,
    aiCredentials: {
      gemma4: true,
      mistral: Boolean(process.env.MISTRAL_API_KEY)
    }
  }
}

function recordCounts() {
  return sharedRecordCounts.getRecordCounts(db)
}

function validationError(key, value, updates) {
  if (['automation_enabled', 'assistant_manager_enabled', 'ai_allow_cloud', 'opencode_proposals_enabled'].includes(key) &&
      ![true, false, 'true', 'false'].includes(value)) {
    return `${key} must be boolean`
  }
  if (key === 'cycle_interval_min' && (!/^\d+$/.test(String(value)) || Number(value) < 5 || Number(value) > 1440)) {
    return 'Cycle interval must be 5–1440 minutes'
  }
  if (key === 'assistant_manager_interval_ms' &&
      (!/^\d+$/.test(String(value)) || Number(value) < 5000 || Number(value) > 300000)) {
    return 'Assistant interval must be 5000–300000 milliseconds'
  }
  if (key === 'quiet_hours' &&
      (!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value)) ||
        String(value).slice(0, 5) === String(value).slice(-5))) {
    return 'Quiet hours must use different HH:MM-HH:MM times'
  }
  if (key === 'message_mode' && !['dry-run', 'live'].includes(value)) {
    return 'message_mode must be dry-run or live'
  }
  if (key === 'ai_provider' && ![...aiCapabilities.RUNTIME_PROVIDERS].includes(value)) {
    return `اختر ${aiCapabilities.RUNTIME_PROVIDERS.map((id) => (id === 'gemma4' ? 'Gemma 4' : 'Mistral')).join(' أو ')} فقط`
  }
  if (key === 'ai_allow_cloud' && (value === true || value === 'true') &&
      !(process.env.MISTRAL_API_KEY && (updates.ai_provider || getSetting('ai_provider')) === 'mistral')) {
    return 'Configure MISTRAL_API_KEY and select Mistral before enabling cloud inference'
  }
  if (key === 'ai_provider' && value === 'mistral' &&
      !(process.env.MISTRAL_API_KEY && (updates.ai_allow_cloud === true || updates.ai_allow_cloud === 'true' ||
        (updates.ai_allow_cloud === undefined && boolSetting('ai_allow_cloud'))))) {
    return 'Mistral requires a configured API key and explicit cloud consent'
  }
  if (key === 'opencode_proposals_enabled' && (value === true || value === 'true') &&
      !proposals.isOpenCodeConfigured()) {
    return 'Configure the OpenCode CLI, model, and sign-in before enabling proposals'
  }
  return null
}

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response

  let source
  try {
    const accounts = await listAccounts()
    source = { ready: accounts.length > 0, accountCount: accounts.length, error: '' }
  } catch (error) {
    source = { ready: false, accountCount: 0, error: String(error.message || error).slice(0, 300) }
  }

  const status = db.prepare(`SELECT state,current_account,account_index,account_total,last_heartbeat,next_cycle_at,paused
    FROM harness_status WHERE id=1`).get()
  const manager = db.prepare('SELECT state,last_run_at,last_error,updated_at FROM assistant_manager_status WHERE id=1').get()
  const lastCycle = db.prepare(`SELECT id,started_at,finished_at,state,accounts_total,accounts_processed,accounts_failed
    FROM automation_cycles ORDER BY started_at DESC LIMIT 1`).get() || null
  const settings = Object.fromEntries([...EDITABLE].map((key) => [key, getSetting(key)]))
  const aiProvider = settings.ai_provider.toLowerCase()
  const scanTargets = db.prepare('SELECT name,account_key FROM companies ORDER BY name').all()

  return Response.json({
    settings,
    source,
    status,
    manager,
    lastCycle,
    scanTargets,
    counts: recordCounts(),
    capabilities: {
      ...capabilities(),
      aiProvider,
      aiReady: aiProvider === 'mistral'
        ? Boolean(process.env.MISTRAL_API_KEY && boolSetting('ai_allow_cloud'))
        : aiProvider === 'gemma4',
      aiCloudTransfer: aiProvider === 'mistral' && boolSetting('ai_allow_cloud'),
      codeProposalsAvailable: proposals.isOpenCodeConfigured(),
      ai: capabilityService.readiness()
    },
    readOnlyGuarantees: {
      portalWrites: false,
      payrollSubmission: false,
      paymentExecution: false
    }
  })
}

export async function PUT(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Settings must be a JSON object' }, { status: 400 })
  }
  const { confirm_live_delivery: confirmLiveDelivery, ...settingsBody } = body
  if (confirmLiveDelivery !== undefined && typeof confirmLiveDelivery !== 'boolean') {
    return Response.json({ error: 'تأكيد الإرسال غير صالح.' }, { status: 400 })
  }
  const updates = Object.entries(settingsBody)
  if (!updates.length || updates.some(([key]) => !EDITABLE.has(key))) {
    return Response.json({ error: 'One or more settings are unsupported' }, { status: 400 })
  }
  if (settingsBody.message_mode === 'live' && confirmLiveDelivery !== true) {
    return Response.json({ error: 'يجب تأكيد إرسال التنبيهات قبل تفعيله.' }, { status: 409 })
  }
  for (const [key, value] of updates) {
    const problem = validationError(key, value, settingsBody)
    if (problem) return Response.json({ error: problem }, { status: 400 })
  }
  const normalized = updates.map(([key, value]) => [key, String(value)])
  if (settingsBody.automation_enabled === true || settingsBody.automation_enabled === 'true') {
    try {
      if ((await listAccounts()).length === 0) {
        return Response.json({ error: 'لا يمكن تفعيل الفحص المجدول قبل إعداد حساب قراءة واحد على الأقل.' }, { status: 409 })
      }
    } catch (error) {
      return Response.json({ error: `تعذر التحقق من مصدر الحسابات: ${String(error.message || error).slice(0, 250)}` }, { status: 409 })
    }
  }
  if (settingsBody.message_mode === 'live' && !capabilities().liveDeliveryReady) {
    return Response.json({
      error: capabilities().linkedChannels === 0
        ? 'الإرسال الحقيقي غير متاح حتى يتم إعداد مستلم قناة فعّال. لا توجد حسابات مستخدمين أو مستلمون مرتبطون.'
        : 'الإرسال الحقيقي غير متاح حتى تهيئة موفر رسائل واحد على الأقل.'
    }, { status: 409 })
  }
  if (body.ai_allow_cloud === true || body.ai_allow_cloud === 'true') {
    if (!process.env.MISTRAL_API_KEY) {
      return Response.json({ error: 'لا يمكن تفعيل Mistral قبل إعداد MISTRAL_API_KEY في ملف البيئة.' }, { status: 409 })
    }
  }

  if ((body.ai_allow_cloud === false || body.ai_allow_cloud === 'false') &&
      body.ai_provider === undefined && getSetting('ai_provider') === 'mistral') {
    normalized.push(['ai_provider', 'gemma4'])
  }
  const update = db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
  db.transaction(() => {
    for (const [key, value] of normalized) update.run(key, value, now())
    if (Object.hasOwn(body, 'automation_enabled')) {
      db.prepare('UPDATE harness_status SET paused=?,updated_at=? WHERE id=1')
        .run(body.automation_enabled === true || body.automation_enabled === 'true' ? 0 : 1, now())
    }
    audit(db, {
      actorId: authz.session.user.id,
      action: 'settings.updated',
      entityType: 'settings',
      details: { keys: normalized.map(([key]) => key) }
    })
  })()
  return Response.json({ saved: true, settings: Object.fromEntries(normalized) })
}

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }

  // Plan 2.0 §17.3 — capability pause/resume and synthetic health probes.
  if (body?.action === 'pause_capability' || body?.action === 'resume_capability' ||
      body?.action === 'probe_capability') {
    const capability = typeof body.capability === 'string' ? body.capability : ''
    if (!aiCapabilities.CAPABILITY_IDS.includes(capability)) {
      return Response.json({ error: 'قدرة غير معروفة.', code: 'AI_POLICY_BLOCKED' }, { status: 400 })
    }
    try {
      if (body.action === 'probe_capability') {
        return Response.json(await capabilityService.probe(capability, undefined, authz.session.user.id))
      }
      const paused = body.action === 'pause_capability'
      if (capability === 'cloud_reviewer' && paused) {
        // Global stop for every cloud review (plan 2.0 §3.2B).
        db.transaction(() => {
          db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('ai_allow_cloud','false',?)
            ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`).run(now())
        })()
      }
      const result = capabilityService.setPaused(capability, paused, {
        actorId: authz.session.user.id,
        reason: typeof body.reason === 'string' ? body.reason : ''
      })
      return Response.json({ ...result, ai: capabilityService.readiness() })
    } catch (error) {
      return Response.json({ error: 'تعذر تنفيذ الطلب على هذه القدرة.', code: 'AI_POLICY_BLOCKED' }, { status: 409 })
    }
  }

  if (!['pause', 'resume', 'scan_now'].includes(body?.action)) {
    return Response.json({ error: 'Unsupported local action' }, { status: 400 })
  }
  if (body.action === 'scan_now') {
    let accounts
    try { accounts = await listAccounts() }
    catch (error) {
      return Response.json({ error: `تعذر الوصول إلى مصدر الحسابات: ${String(error.message || error).slice(0, 250)}` }, { status: 409 })
    }
    if (!accounts.length) return Response.json({ error: 'لا توجد حسابات قراءة مهيأة للفحص.' }, { status: 409 })
    const account = typeof body.account === 'string' ? body.account.trim() : ''
    if (account && !accounts.some((item) => item.username.toLowerCase() === account.toLowerCase())) {
      return Response.json({ error: 'الحساب المحدد غير موجود في مصدر الحسابات المهيأ.' }, { status: 400 })
    }
    const commandId = createCommand('scan_now', { account }, authz.session.user.id, db)
    db.transaction(() => {
      db.prepare('UPDATE harness_status SET paused=0,updated_at=? WHERE id=1').run(now())
      audit(db, {
        actorId: authz.session.user.id,
        action: 'scan.read_only.requested',
        entityType: 'automation',
        entityId: commandId,
        details: { accountCount: account ? 1 : accounts.length, account: account || 'all' }
      })
    })()
    return Response.json({ queued: true, commandId, accountCount: account ? 1 : accounts.length })
  }

  const paused = body.action === 'pause' ? 1 : 0
  db.transaction(() => {
    db.prepare('UPDATE harness_status SET paused=?,updated_at=? WHERE id=1').run(paused, now())
    audit(db, {
      actorId: authz.session.user.id,
      action: `harness.${body.action}d`,
      entityType: 'automation'
    })
  })()
  return Response.json({ saved: true, paused: Boolean(paused) })
}
