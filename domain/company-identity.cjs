'use strict'

const UNREGISTERED_COMPANY_NAME = 'اسم غير مسجّل'

function looksLikeIdentifier(value, accountKey = '') {
  const name = typeof value === 'string' ? value.trim() : ''
  return !name || name === String(accountKey || '') ||
    /^\d{6,}$/.test(name) || /^[a-z0-9_-]{10,}$/i.test(name)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * A company name is "usable" when it is real text: not blank, not the account
 * key, not a bare number/handle, and never the placeholder shown for an
 * unknown company. Nothing here invents a name.
 */
function isUsableCompanyName(value, accountKey = '') {
  const name = text(value)
  if (!name || name === UNREGISTERED_COMPANY_NAME) return false
  return !looksLikeIdentifier(name, accountKey)
}

/**
 * A manually entered name is not silently trusted when it conflicts with the
 * latest portal name. Old stored aliases remain visible as candidates but are
 * not treated as verified identity.
 */
function resolveCompanyIdentity(company) {
  const accountKey = company?.account_key || ''
  const stored = text(company?.name)
  const manual = company?.name_source === 'manual' ? stored : ''
  const portal = text(company?.portal_name)
  let origin = ''
  let name = ''
  if (isUsableCompanyName(manual, accountKey)) {
    name = manual
    origin = isUsableCompanyName(portal, accountKey) && portal !== manual
      ? 'conflict'
      : 'manual_verified'
  } else if (isUsableCompanyName(portal, accountKey)) {
    name = portal
    origin = 'portal_verified'
  } else if (isUsableCompanyName(stored, accountKey)) {
    name = stored
    origin = 'unverified_mapping'
  }
  return {
    id: company?.id || '',
    name: name || UNREGISTERED_COMPANY_NAME,
    englishName: origin === 'manual_verified' || origin === 'conflict'
      ? text(company?.english_name)
      : origin === 'portal_verified' ? text(company?.portal_name_english) : '',
    taxRegistrationNumber: (origin === 'manual_verified' || origin === 'conflict')
      && typeof company?.tax_registration_number === 'string'
      ? company.tax_registration_number
      : '',
    known: Boolean(name) && origin !== 'conflict',
    origin,
    manualName: origin === 'conflict' || origin === 'manual_verified' ? manual : '',
    portalName: isUsableCompanyName(portal, accountKey) ? portal : ''
  }
}

/**
 * Badge text for a company card. Returns '' for an unnamed company so the UI
 * can render a building icon instead of letters lifted from a placeholder.
 */
function companyInitials(value, accountKey = '') {
  if (!isUsableCompanyName(value, accountKey)) return ''
  const words = text(value).split(/\s+/).filter(Boolean)
  const letters = words.length > 1
    ? words.slice(0, 2).map((word) => word[0])
    : [words[0].slice(0, 2)]
  return letters.join('').replace(/[^؀-ۿA-Za-z]/g, '').toLocaleUpperCase('ar-EG')
}

function validateCompanyIdentity(value, accountKey = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'بيانات الشركة غير صالحة.' }
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const englishName = typeof value.englishName === 'string' ? value.englishName.trim() : ''
  const taxRegistrationNumber = typeof value.taxRegistrationNumber === 'string'
    ? value.taxRegistrationNumber.trim()
    : ''

  if (name.length < 2 || name.length > 160 || looksLikeIdentifier(name, accountKey)) {
    return { error: 'أدخل اسم الشركة الحقيقي، لا رقم الحساب أو معرّفه.' }
  }
  if (englishName.length > 160) return { error: 'يجب ألا يتجاوز الاسم الإنجليزي 160 حرفًا.' }
  if (taxRegistrationNumber && !/^\d{1,30}$/.test(taxRegistrationNumber)) {
    return { error: 'أدخل رقم التسجيل الضريبي بالأرقام فقط، مع الحفاظ على الأصفار في بدايته.' }
  }
  return { value: { name, englishName, taxRegistrationNumber } }
}

/**
 * Picks the real company name out of a portal scan payload. Record payloads
 * carry the legal name the portal rendered (tasks/obligations/payments/
 * messages); the account label is the last resort. Identifiers are rejected so
 * an account key can never become a company name.
 */
function portalCompanyName(result, accountKey = '') {
  const sources = [
    [result?.tasks, ['company', 'companyName']],
    [result?.obligations, ['company', 'companyName']],
    [result?.payments, ['companyName', 'company']],
    [result?.messages, ['company', 'companyName']]
  ]
  for (const [rows, keys] of sources) {
    for (const row of Array.isArray(rows) ? rows : []) {
      for (const key of keys) {
        if (isUsableCompanyName(row?.[key], accountKey)) return text(row[key])
      }
    }
  }
  const label = text(result?.account?.label)
  return isUsableCompanyName(label, accountKey) ? label : ''
}

function portalCompanyNameEnglish(result) {
  const sources = [
    result?.tasks, result?.obligations, result?.payments, result?.messages
  ]
  for (const rows of sources) {
    for (const row of Array.isArray(rows) ? rows : []) {
      for (const key of ['companyNameEnglish', 'companyEnglishName', 'englishName', 'companyNameEn']) {
        const value = text(row?.[key])
        if (value && value.length <= 160) return value
      }
    }
  }
  const label = text(result?.account?.labelEnglish)
  return label && label.length <= 160 ? label : ''
}

module.exports = {
  UNREGISTERED_COMPANY_NAME,
  companyInitials,
  isUsableCompanyName,
  looksLikeIdentifier,
  portalCompanyName,
  portalCompanyNameEnglish,
  resolveCompanyIdentity,
  validateCompanyIdentity
}