'use strict'

/**
 * Plan 2.0 §3.2 / §12.1 — the three capabilities are deliberately distinct and
 * are never interchangeable:
 *
 *   local_assistant  Gemma 4   device-only runtime assistant (the default)
 *   cloud_reviewer   Mistral   optional second opinion, per-case approval
 *   system_adviser   OpenCode  engineering adviser, sanitised source only
 *
 * This module is pure: it reads no database, no environment, and no network,
 * so the state model can be tested on its own.
 */

const REDACTION_POLICY_VERSION = 'r1.0'

const CAPABILITIES = Object.freeze({
  local_assistant: Object.freeze({
    id: 'local_assistant',
    order: 1,
    title: 'المساعد المحلي',
    provider: 'Gemma 4',
    boundary: 'device',
    states: Object.freeze({
      ready: { label: 'جاهز', tone: 'good' },
      running: { label: 'يعمل', tone: 'good' },
      unavailable: { label: 'غير متاح', tone: 'bad' },
      paused: { label: 'متوقف مؤقتاً', tone: 'muted' },
      maintenance: { label: 'يتطلب صيانة', tone: 'warn' }
    }),
    privacy: 'لا تغادر بيانات المحادثة هذا الجهاز'
  }),
  cloud_reviewer: Object.freeze({
    id: 'cloud_reviewer',
    order: 2,
    title: 'المراجع السحابي',
    provider: 'Mistral',
    boundary: 'cloud',
    states: Object.freeze({
      unlinked: { label: 'غير مربوط', tone: 'muted' },
      ready: { label: 'جاهز للمراجعة', tone: 'good' },
      stopped: { label: 'متوقف', tone: 'muted' },
      unreachable: { label: 'تعذر الاتصال', tone: 'bad' }
    }),
    privacy: 'لا يُرسل شيء دون موافقة صريحة على هذه الحالة، والموافقة تنتهي خلال 24 ساعة أو عند تغيّر المحتوى'
  }),
  system_adviser: Object.freeze({
    id: 'system_adviser',
    order: 3,
    title: 'مستشار النظام',
    provider: 'OpenCode',
    boundary: 'source',
    states: Object.freeze({
      not_configured: { label: 'غير مهيأ', tone: 'muted' },
      ready: { label: 'جاهز للمقترحات', tone: 'good' },
      in_review: { label: 'طلب مراجعة قيد التنفيذ', tone: 'warn' },
      needs_attention: { label: 'يتطلب تدخلاً', tone: 'bad' }
    }),
    privacy: 'لا يصل إلى قاعدة بيانات الإنتاج ولا شركة ولا دفعة ولا مستند ولا بوابة ولا سر — مصدر وتشخيص فقط'
  })
})

const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITIES).sort((a, b) => CAPABILITIES[a].order - CAPABILITIES[b].order))

/** Runtime assistant lanes only. OpenCode is not one of them (plan 2.0 §1.3). */
const RUNTIME_PROVIDERS = Object.freeze(['gemma4', 'mistral'])

const ERROR_VOCABULARY = Object.freeze({
  LOCAL_ASSISTANT_UNAVAILABLE: 'المساعد المحلي غير متاح. تحقّق من خدمة Gemma 4 على هذا الجهاز ثم أعد المحاولة.',
  CLOUD_REVIEW_NOT_CONFIGURED: 'المراجعة السحابية غير مهيأة. أضف مفتاح Mistral من مركز التحكم.',
  CLOUD_CONSENT_REQUIRED: 'يلزم موافقة صريحة على هذه الحالة قبل أي إرسال سحابي.',
  CLOUD_CONSENT_EXPIRED: 'انتهت الموافقة السحابية. راجع البيانات المعتمدة ثم وافق من جديد.',
  AI_POLICY_BLOCKED: 'أوقفت السياسة هذه العملية من مركز التحكم.',
  SOURCE_DATA_INSUFFICIENT: 'لا توجد بيانات كافية للإجابة بثقة.',
  PROVIDER_BUDGET_EXCEEDED: 'تجاوز الطلب الحد المسموح اليوم.',
  OPENCODE_NOT_CONFIGURED: 'مستشار النظام غير مهيأ. أضف مسار OpenCode والموديل ثم سجّل الدخول.',
  OPENCODE_SCOPE_REJECTED: 'الطلب خارج نطاق المستشار: الشيفرة والتشخيص فقط.',
  PAYMENT_SOURCE_STATUS_UNKNOWN: 'حالة الدفع غير معروفة في المصدر؛ لن نعتبرها مسددة.'
})

const CONSENT_COPY = Object.freeze({
  heading: 'مراجعة سحابية بموافقة',
  intro: 'هذه هي البيانات الوحيدة التي ستغادر جهازك، ولماذا.',
  defaultChoice: 'الخيار الافتراضي هو الإلغاء؛ لا يُرسل شيء إلا بضغطك على «إرسال للمراجعة السحابية».',
  sendButton: 'إرسال للمراجعة السحابية',
  cancelButton: 'إلغاء',
  expires: 'تنتهي الموافقة عند أول مما يلي: تغيّر محتوى الحالة، أو إضافة مرفق جديد، أو مرور 24 ساعة.',
  neverSendTitle: 'ما لا يُرسل أبداً',
  neverSend: [
    'كلمات المرور والمفاتيح وملفات الارتباط والرموز وقيم التحقق',
    'بيانات اعتماد الحساب أو لقطات البوابة الخام',
    'تصدير كامل لسجل التدقيق',
    'بيانات اتصال لا يحتاجها السؤال',
    'مرفقات لم تختر لها استخراجًا نصيًا بعد التنقيح'
  ],
  probeNote: 'اختبار الاتصال يستخدم رسالة اصطناعية واحدة لا تحتوي أي بيانات مكتب.'
})

function unsupportedProviderMessage(provider) {
  return 'Only Gemma 4 (local) and Mistral (approved cloud review) are supported'
}

/**
 * Resolves the display state of one capability. Inputs are facts, not labels:
 * `configured`, `paused`, `health` ('unknown'|'healthy'|'unreachable'),
 * `lastSuccessAt`, and `pendingCount` for the adviser inbox.
 */
function capabilityState(id, input = {}) {
  const capability = CAPABILITIES[id]
  if (!capability) throw new Error(`Unknown capability: ${id}`)
  const { configured = false, paused = false, health = 'unknown', lastSuccessAt = null, pendingCount = 0 } = input
  let key

  if (id === 'local_assistant') {
    if (paused) key = 'paused'
    else if (health === 'healthy') key = 'running'
    else if (health === 'unreachable') key = 'unavailable'
    else key = 'ready'
  } else if (id === 'cloud_reviewer') {
    if (paused) key = 'stopped'
    else if (!configured) key = 'unlinked'
    else if (health === 'unreachable') key = 'unreachable'
    else key = 'ready'
  } else {
    if (!configured) key = 'not_configured'
    else if (health === 'unreachable') key = 'needs_attention'
    else if (pendingCount > 0) key = 'in_review'
    else key = 'ready'
  }

  const state = capability.states[key]
  return {
    id,
    key,
    label: state.label,
    tone: state.tone,
    title: capability.title,
    provider: capability.provider,
    boundary: capability.boundary,
    privacy: capability.privacy,
    paused: Boolean(paused),
    configured: Boolean(configured),
    lastSuccessAt: lastSuccessAt || null
  }
}

/** Read-only payload for GET /api/capabilities. Never carries a secret. */
function capabilityReport(inputs = {}) {
  return {
    policyVersion: REDACTION_POLICY_VERSION,
    runtimeProviders: [...RUNTIME_PROVIDERS],
    capabilities: CAPABILITY_IDS.map((id) => capabilityState(id, inputs[id] || {})),
    errorVocabulary: { ...ERROR_VOCABULARY },
    consentCopy: { ...CONSENT_COPY, neverSend: [...CONSENT_COPY.neverSend] }
  }
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_IDS,
  CONSENT_COPY,
  ERROR_VOCABULARY,
  REDACTION_POLICY_VERSION,
  RUNTIME_PROVIDERS,
  capabilityReport,
  capabilityState,
  unsupportedProviderMessage
}