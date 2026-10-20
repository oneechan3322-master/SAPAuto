'use strict'

/**
 * Egyptian Tax Authority (مصلحة الضرائب المصرية - ETA) Classifier.
 * Standardizes SAP UI5 transaction codes (PY01, VT01, WH01, CT01, PT01, etc.)
 * into authoritative Egyptian tax vocabulary and legal categories.
 */

const TAX_TYPES = {
  vat: {
    key: 'vat',
    label: 'ضريبة القيمة المضافة',
    shortLabel: 'قيمة مضافة',
    code: 'VT',
    color: '#0284c7', // Sky Blue
    bg: 'rgba(2, 132, 199, 0.1)',
    badgeClass: 'tax-badge-vat',
    standardForm: 'نموذج 10 ض.ق.م'
  },
  payroll: {
    key: 'payroll',
    label: 'ضريبة المرتبات وما في حكمها (كسب العمل)',
    shortLabel: 'مرتبات وكسب عمل',
    code: 'PY',
    color: '#0d9488', // Teal
    bg: 'rgba(13, 148, 136, 0.1)',
    badgeClass: 'tax-badge-payroll',
    standardForm: 'نموذج 4 مرتبات / سداد شهري'
  },
  withholding: {
    key: 'withholding',
    label: 'ضريبة الخصم والتحصيل تحت حساب الضريبة',
    shortLabel: 'خصم وتحصيل',
    code: 'WH',
    color: '#7c3aed', // Purple
    bg: 'rgba(124, 58, 237, 0.1)',
    badgeClass: 'tax-badge-withholding',
    standardForm: 'نموذج 41 خصم وتحصيل'
  },
  corporate: {
    key: 'corporate',
    label: 'ضريبة أرباح الأشخاص الاعتبارية (الشركات)',
    shortLabel: 'أرباح شركات',
    code: 'CT',
    color: '#b45309', // Amber / Gold
    bg: 'rgba(180, 83, 9, 0.1)',
    badgeClass: 'tax-badge-corporate',
    standardForm: 'إقرار أرباح تجارية (نموذج 28)'
  },
  income: {
    key: 'income',
    label: 'ضريبة الدخل للأشخاص الطبيعيين',
    shortLabel: 'دخل أفراد',
    code: 'PT',
    color: '#c2410c', // Orange
    bg: 'rgba(194, 65, 12, 0.1)',
    badgeClass: 'tax-badge-income',
    standardForm: 'إقرار دخل طبيعي (نموذج 27)'
  },
  stamp: {
    key: 'stamp',
    label: 'ضريبة الدمغة والطعون النسبية',
    shortLabel: 'ضريبة دمغة',
    code: 'ST',
    color: '#db2777', // Pink
    bg: 'rgba(219, 39, 119, 0.1)',
    badgeClass: 'tax-badge-stamp',
    standardForm: 'نموذج 19 دمغة'
  },
  disputes: {
    key: 'disputes',
    label: 'إخطارات الفحص والطعون ولجان إنهاء المنازعات',
    shortLabel: 'فحص وطعون',
    code: 'DP',
    color: '#e11d48', // Rose / Red
    bg: 'rgba(225, 29, 72, 0.1)',
    badgeClass: 'tax-badge-disputes',
    standardForm: 'إخطار فحص / جلسة طعن'
  },
  general: {
    key: 'general',
    label: 'التزامات وتنظيمات ضريبية عامة',
    shortLabel: 'تنظيمات ضريبية',
    code: 'GN',
    color: '#64748b', // Slate
    bg: 'rgba(100, 116, 139, 0.1)',
    badgeClass: 'tax-badge-general',
    standardForm: 'بوابة الضرائب المصرية'
  }
}

function classifyTaxObligation(row = {}) {
  const title = String(row.title || '').trim()
  const period = String(row.period || '').trim()
  const rawJson = typeof row.raw_json === 'string' ? row.raw_json : ''
  let raw = {}
  try { if (rawJson) raw = JSON.parse(rawJson) } catch (_) {}

  const fullSearch = `${title} ${period} ${raw.formLabel || ''} ${raw.taxLabel || ''} ${raw.taxType || ''}`.toLowerCase()

  // 1. VAT
  if (title === 'VT01' || fullSearch.includes('قيمة مضافة') || fullSearch.includes('ق.م') || fullSearch.includes('vat') || fullSearch.includes('شهادة تسجيل ض')) {
    let cleanTitle = 'إقرار ضريبة القيمة المضافة (نموذج 10)'
    if (fullSearch.includes('شهادة')) cleanTitle = 'شهادة تسجيل ضريبة القيمة المضافة'
    return {
      type: TAX_TYPES.vat,
      officialTitle: cleanTitle,
      formCode: 'نموذج 10 ض.ق.م',
      frequency: 'شهري',
      legalDeadlineNotice: 'يستحق التقديم والسداد خلال الشهر التالي لانتهاء الفترة الضريبية (قانون 206/2020)',
      penaltyWarning: 'غرامة عدم تقديم الإقرار من 3,000 إلى 50,000 جنيه بالإضافة لمقابل التأخير'
    }
  }

  // 2. Payroll / Salaries
  if (title === 'PY01' || fullSearch.includes('مرتب') || fullSearch.includes('أجور') || fullSearch.includes('كسب عمل') || fullSearch.includes('payroll')) {
    const isQuarterly = fullSearch.includes('ربع سنوي') || period.includes('ربع')
    const isYearly = fullSearch.includes('تسوية') || period.includes('تسوية')
    const cleanTitle = isYearly ? 'التسوية السنوية لضريبة المرتبات (كسب العمل)'
      : isQuarterly ? 'إقرار ضريبة المرتبات الربع سنوي (نموذج 4 مرتبات)'
      : 'السداد الشهري لضريبة المرتبات والأجور'
    return {
      type: TAX_TYPES.payroll,
      officialTitle: cleanTitle,
      formCode: isYearly ? 'تسوية سنوية' : isQuarterly ? 'نموذج 4 مرتبات' : 'سداد شهري PY01',
      frequency: isYearly ? 'سنوي' : isQuarterly ? 'ربع سنوي' : 'شهري',
      legalDeadlineNotice: isQuarterly ? 'يستحق خلال شهر (يناير، أبريل، يوليو، أكتوبر)' : 'يستحق التوريد خلال الـ 15 يوماً الأولى من الشهر التالي',
      penaltyWarning: 'غرامة التأخير ومقابل التأخير القانوني بموجب المادة 31 من قانون 206/2020'
    }
  }

  // 3. Withholding
  if (title === 'WH01' || fullSearch.includes('خصم') || fullSearch.includes('تحصيل تحت حساب') || fullSearch.includes('withholding')) {
    return {
      type: TAX_TYPES.withholding,
      officialTitle: 'إشعار الخصم والتحصيل تحت حساب الضريبة (نموذج 41)',
      formCode: 'نموذج 41 خصم',
      frequency: 'ربع سنوي',
      legalDeadlineNotice: 'يستحق التقديم والتوريد خلال نهاية شهر (أبريل، يوليو، أكتوبر، يناير) عن الربع المنقضي',
      penaltyWarning: 'غرامة التأخير ومقابل التأخير المقرر قانوناً'
    }
  }

  // 4. Corporate Income Tax
  if (title === 'CT01' || fullSearch.includes('أشخاص اعتبارية') || fullSearch.includes('أرباح تجارية') || fullSearch.includes('corporate')) {
    return {
      type: TAX_TYPES.corporate,
      officialTitle: 'إقرار ضريبة أرباح الأشخاص الاعتبارية السنوي (نموذج 28)',
      formCode: 'نموذج 28 شركات',
      frequency: 'سنوي',
      legalDeadlineNotice: 'يستحق التقديم حتى 30 أبريل أو خلال 4 أشهر من انتهاء السنة المالية للشركة',
      penaltyWarning: 'غرامة عدم تقديم الإقرار وغرامات المادة 70 من قانون الإجراءات الضريبية'
    }
  }

  // 5. Personal Income Tax
  if (title === 'PT01' || fullSearch.includes('أشخاص طبيعيين') || fullSearch.includes('دخل طبيعي')) {
    return {
      type: TAX_TYPES.income,
      officialTitle: 'إقرار ضريبة الدخل للأشخاص الطبيعيين السنوي (نموذج 27)',
      formCode: 'نموذج 27 أفراد',
      frequency: 'سنوي',
      legalDeadlineNotice: 'يستحق التقديم خلال الفترة من أول يناير حتى 31 مارس من كل عام',
      penaltyWarning: 'غرامة عدم تقديم الإقرار السنوي'
    }
  }

  // 6. Stamp Tax
  if (fullSearch.includes('دمغة') || title.includes('١٩ دمغة')) {
    return {
      type: TAX_TYPES.stamp,
      officialTitle: 'نموذج 19 دمغة / 19 دمغة مكرر (ربط ضريبة الدمغة والطعن)',
      formCode: 'نموذج 19 دمغة',
      frequency: 'إجرائي / عند الربط',
      legalDeadlineNotice: 'مهلة الطعن القانونية 30 يوماً من تاريخ استلام الإخطار، وإلا يصبح الربط نهائياً',
      penaltyWarning: 'فوات الميعاد القانوني (30 يوماً) يحصّن تقدير المأمورية ويجعله واجب الأداء فوراً'
    }
  }

  // 7. Disputes, Notices, Inspections, Appeals
  if (fullSearch.includes('طعن') || fullSearch.includes('جلسة') || fullSearch.includes('رفض') || fullSearch.includes('قبول') || fullSearch.includes('تجهيز مستندات') || fullSearch.includes('appeal') || fullSearch.includes('فحص')) {
    return {
      type: TAX_TYPES.disputes,
      officialTitle: title.includes('ملاحظات قبول') ? `إشعار فحص إلكتروني: ${title}`
        : title.includes('اسباب الرفض') ? `إشعار رفض مستندات: ${title}`
        : title.includes('طعن') ? `إخطار جلسة لجنة الطعن الضريبي: ${title}`
        : title.includes('تجهيز مستندات') ? `طلب مستندات ودفاتر الفحص (المادة 11): ${title}`
        : title,
      formCode: 'إخطار رسمي',
      frequency: 'محدد بميعاد',
      legalDeadlineNotice: 'مهلة قانونية محددة بالإخطار (غالباً 15 إلى 30 يوماً)',
      penaltyWarning: 'عدم الرد يترتب عليه رفض الطعن أو تقدير جزافي من مصلحة الضرائب'
    }
  }

  return {
    type: TAX_TYPES.general,
    officialTitle: title || 'التزام ضريبي عام',
    formCode: 'بوابة الضرائب',
    frequency: 'دوري',
    legalDeadlineNotice: 'متابعة البوابة الإلكترونية لمصلحة الضرائب المصرية',
    penaltyWarning: 'الالتزام بالمواعيد الرسمية المقررة بقانون 206/2020'
  }
}

module.exports = {
  TAX_TYPES,
  classifyTaxObligation
}
