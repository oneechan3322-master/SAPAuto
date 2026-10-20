'use strict';

/**
 * Executive Tax Secretary Domain Rules (نظام سكرتير المكتب التنفيذي - مستوحى من V6).
 *
 * Implements authoritative mapping of ETA / SAP document types to:
 * 1. Required document (المستند المطلوب)
 * 2. Statutory deadline & legal window under Law 206/2020 (المهلة القانونية)
 * 3. Immediate executive action for the office (الإجراء التنفيذي)
 * 4. Assigned office role (المسؤول المكلف)
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 10: Defensive redundancy
 */

const { cairoDayOf, addCalendarDays, daysBetweenCairo, formatArabicDays, deadlineTone } = require('./legal-deadlines.cjs');

/**
 * Authoritative document type rules for Egyptian Tax Authority (ETA).
 */
const SECRETARY_DOCUMENT_RULES = Object.freeze([
  {
    key: 'DOC_PREPARATION',
    matchKeys: ['إخطار تجهيز مستندات', 'اخطار تجهيز', 'تجهيز مستندات', '180000'],
    docName: 'دفاتر وسجلات ومستندات الفحص الضريبي (دفاتر اليومية، الفواتير الإلكترونية، كشوف المرتبات)',
    deadlineDays: 15,
    basis: 'قانون الإجراءات الضريبية الموحد 206/2020 (المواد 7 و11 و42) — مهلة 15 يوماً من تاريخ الإخطار، وتتدرج الغرامة الإدارية من 3,000 إلى 50,000 ج.م وتتضاعف بعد 60 يوماً من التأخر.',
    requiredAction: 'تجهيز وحصر الدفاتر المحاسبية وفواتير المبيعات والمشتريات الإلكترونية المعتمدة وتسليمها رسمياً للمأمورية قبل انتهاء الميعاد واستلام إيصال مختوم.',
    assignedRole: 'مدير المكتب',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/filing_obligations'
  },
  {
    key: 'FORM_19_STAMP',
    matchKeys: ['نموذج ١٩', 'نموذج 19', 'دمغة', '١٩ دمغة', 'ربط ضريبي'],
    docName: 'نموذج 19 ومذكرة الدفاع والطعن القانوني والمستندات المؤيدة',
    deadlineDays: 30,
    basis: 'قانون الإجراءات الضريبية الموحد 206/2020 (المادتان 55 و61) — ميعاد طعن حاسم 30 يوماً من تاريخ استلام الإخطار، وفوات الميعاد يجعل التقدير نهائياً وواجب الأداء الجبري.',
    requiredAction: 'دراسة بنود التقدير ومطابقتها مع الإقرارات، وصياغة مذكرة الدفاع والطعن القانوني، وإيداعها رسمياً لدى لجنة الطعن أو المأمورية المختصة وتحديد جلسة.',
    assignedRole: 'المستشار الضريبي',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/forms'
  },
  {
    key: 'FORM_15_AUDIT',
    matchKeys: ['نموذج رقم (15) فحص', 'نموذج 15', 'فحص ضريبي'],
    docName: 'دفاتر الحسابات المنتظمة، القوائم المالية، وتحليلات الحسابات المعتمدة',
    deadlineDays: 15,
    basis: 'قانون 206/2020 (المادة 11) — مهلة 15 يوماً من تاريخ الإخطار لتحديد وتجهيز مكان ومستندات الفحص الضريبي الميداني.',
    requiredAction: 'التنسيق العاجل مع مأمور الفحص المختص، وتجهيز الملف الضريبي الشامل ومطابقة فواتير المنظومة الإلكترونية مع الدفاتر الورقية.',
    assignedRole: 'مدير المكتب',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/filing_obligations'
  },
  {
    key: 'RECEIPT_CONFIRMATION',
    matchKeys: ['تأكيد استلام', 'تاكيد إستلام', 'تاكيد استلام', 'إشعار استلام'],
    docName: 'إشعار تأكيد الاستلام والمرفقات والمستندات الثبوتية التكميلية',
    deadlineDays: 10,
    basis: 'قانون 206/2020 — مهلة 10 أيام لتأكيد الاستلام واستيفاء المتطلبات المرفقة وتأكيد صحة المراسلات الإلكترونية.',
    requiredAction: 'تأكيد الاستلام عبر بوابة مصلحة الضرائب الرسمية، وتدقيق المستندات المطلوبة وإرفاق الرد الرسمي المعتمد.',
    assignedRole: 'مدير المكتب',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/forms'
  },
  {
    key: 'REJECTION_REASONS',
    matchKeys: ['اسباب الرفض', 'أسباب الرفض', 'رفض إقرار', 'رفض مستند'],
    docName: 'المستندات والفواتير المصححة ومذكرة معالجة أسباب الرفض',
    deadlineDays: 15,
    basis: 'قانون 206/2020 — مهلة 15 يوماً من تاريخ إخطار الرفض لاستيفاء النواقص أو تصحيح الأخطاء وإعادة الرفع لتجنب اعتبار المستند كأن لم يكن.',
    requiredAction: 'فحص تقرير أسباب الرفض الصادر من المنظومة، وتصحيح بنود الفواتير أو الإقرارات المرفوضة وإعادة رفعها فوراً للمأمورية.',
    assignedRole: 'مسؤول الحسابات',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/forms'
  },
  {
    key: 'ACCEPTANCE_NOTES',
    matchKeys: ['ملاحظات قبول', 'إشعار قبول', 'قبول مشروط'],
    docName: 'إيصال سداد الرسوم أو الغرامات التكميلية وإنهاء شروط القبول',
    deadlineDays: 7,
    basis: 'قانون 206/2020 — مهلة 7 أيام لاستيفاء شروط وملاحظات القبول وسداد فروق التسويات للحصول على الاعتماد النهائي.',
    requiredAction: 'مراجعة شروط وملاحظات القبول وسداد الرسوم المقررة عبر منظومة السداد الإلكتروني، وطباعة إشعار القبول النهائي.',
    assignedRole: 'مسؤول الحسابات',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/filing_obligations'
  },
  {
    key: 'HEARING_SESSION',
    matchKeys: ['الحضور لجلسة', 'جلسة نظر الطعن', 'لجنة داخلية', 'لجنة الطعن'],
    docName: 'ملف الدفاع الكامل، التوكيل الرسمي، ومذكرة أوجه الدفاع الختامية',
    deadlineDays: 5,
    basis: 'قانون 206/2020 (المادتان 62 و65) — وجوب الحضور أو تقديم مذكرة الدفاع قبل موعد الجلسة المحددة بـ 5 أيام على الأقل.',
    requiredAction: 'إعداد ملف الطعن وحضور الجلسة المحددة بمقر اللجنة الضريبية، وتقديم الدفوع القانونية والمستندات الثبوتية.',
    assignedRole: 'المحامي / المفوض',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/forms'
  },
  {
    key: 'OPNA_FORM',
    matchKeys: ['OPNA', 'نموذج OPNA'],
    docName: 'نموذج OPNA واعتماده ومطابقة البيانات الضريبية المقيدة',
    deadlineDays: 15,
    basis: 'قانون 206/2020 — مراجعة نموذج OPNA ومطابقته مع السجلات في مهلة 15 يوماً.',
    requiredAction: 'مراجعة نموذج OPNA واعتماده ومطابقة البيانات بالحسابات المنتظمة للمنشأة.',
    assignedRole: 'مدير الحسابات',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/forms'
  },
  {
    key: 'TAX_CARD',
    matchKeys: ['بطاقة ضريبية', 'سارية', 'تجديد بطاقة'],
    docName: 'بطاقة تعريف ضريبية سارية ومستندات التجديد الرسمية',
    deadlineDays: 15,
    basis: 'قانون الإجراءات الضريبية الموحد 206/2020 (المادة 21) — وجوب إخطار المصلحة بأي تغيير وتجديد البطاقة قبل انتهاء صلاحيتها.',
    requiredAction: 'استخراج مستخرج حديث من السجل التجاري وتقديم طلب تجديد البطاقة الضريبية بالمأمورية قبل انتهاء الصلاحية.',
    assignedRole: 'مسؤول الحسابات',
    portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/filing_obligations'
  }
]);

const DEFAULT_SECRETARY_RULE = Object.freeze({
  key: 'GENERAL_NOTICE',
  docName: 'مستند أو إخطار رسمي صادر عن مصلحة الضرائب المصرية',
  deadlineDays: 15,
  basis: 'قانون الإجراءات الضريبية الموحد 206/2020 — مهلة عامة 15 يوماً للرد على إخطارات ومكاتبات المصلحة الرسمية تجنباً للغرامات.',
  requiredAction: 'مراجعة نص الإخطار أو المستند المرفق ومطابقة السجلات الضريبية وإعداد الرد القانوني قبل فوات الميعاد.',
  assignedRole: 'مدير المكتب',
  portalUrl: 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/filing_obligations'
});

/**
 * Matches free-text (title, doc_number, body) to the most specific secretary rule.
 * @param {string} text
 * @returns {Object}
 */
function matchSecretaryRule(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return DEFAULT_SECRETARY_RULE;
  }
  const clean = text.replace(/[\u200e\u200f\u061c]/g, '').trim();

  let bestRule = null;
  let bestMatchLen = 0;

  for (const rule of SECRETARY_DOCUMENT_RULES) {
    for (const matchKey of rule.matchKeys) {
      if (clean.includes(matchKey)) {
        if (matchKey.length > bestMatchLen) {
          bestMatchLen = matchKey.length;
          bestRule = rule;
        }
      }
    }
  }

  return bestRule || DEFAULT_SECRETARY_RULE;
}

/**
 * Builds deterministic secretary memo text.
 * Used as high-fidelity fallback or baseline for AI enrichment.
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string} [params.noticeDate] - 'YYYY-MM-DD'
 * @param {string} [params.deadlineDate] - 'YYYY-MM-DD'
 * @param {string} [params.companyName]
 * @param {Object} [params.rule]
 * @returns {string}
 */
function buildSecretaryMemo({ title, noticeDate, deadlineDate, companyName, rule: customRule }) {
  const rule = customRule || matchSecretaryRule(title || '');
  const noticeDay = noticeDate ? cairoDayOf(noticeDate) : cairoDayOf(new Date());
  const finalDeadline = deadlineDate || (rule.deadlineDays ? addCalendarDays(noticeDay, rule.deadlineDays) : '');

  const lines = [
    `📋 المستند المطلوب: ${rule.docName}`,
    `⏳ المهلة القانونية: ${rule.deadlineDays} يوماً من تاريخ الإخطار${finalDeadline ? ` (تنتهي في ${finalDeadline})` : ''} — ${rule.basis}`,
    `⚡ الإجراء التنفيذي: ${rule.requiredAction}`,
    `👤 المسؤول المكلف: ${rule.assignedRole}`
  ];

  return lines.join('\n');
}

/**
 * Parses a 4-part secretary memo text into structured fields.
 * @param {string} text
 * @returns {{requiredDoc: string, legalDeadline: string, executiveAction: string, assignedRole: string}}
 */
function parseSecretaryMemo(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { requiredDoc: '', legalDeadline: '', executiveAction: '', assignedRole: '' };
  }

  const result = {
    requiredDoc: '',
    legalDeadline: '',
    executiveAction: '',
    assignedRole: ''
  };

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('المستند المطلوب') || trimmed.includes('📋')) {
      result.requiredDoc = trimmed.replace(/^.*?المستند المطلوب[:\s-]*/, '').trim();
    } else if (trimmed.includes('المهلة القانونية') || trimmed.includes('⏳')) {
      result.legalDeadline = trimmed.replace(/^.*?المهلة القانونية[:\s-]*/, '').trim();
    } else if (trimmed.includes('الإجراء التنفيذي') || trimmed.includes('⚡')) {
      result.executiveAction = trimmed.replace(/^.*?الإجراء التنفيذي[:\s-]*/, '').trim();
    } else if (trimmed.includes('المسؤول المكلف') || trimmed.includes('👤')) {
      result.assignedRole = trimmed.replace(/^.*?المسؤول المكلف[:\s-]*/, '').trim();
    }
  }

  return result;
}

module.exports = {
  SECRETARY_DOCUMENT_RULES,
  DEFAULT_SECRETARY_RULE,
  matchSecretaryRule,
  buildSecretaryMemo,
  parseSecretaryMemo
};
