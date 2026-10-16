import { cookies } from 'next/headers'

const DIGITS_COOKIE = 'sapauto_digits'

/**
 * Display preference only — no stored record is touched.
 * Western digits (0-9) are the default; `arab` (٠-٩) is opt-in.
 */
export async function displayDigits() {
  const store = await cookies()
  return store.get(DIGITS_COOKIE)?.value === 'arab' ? 'arab' : 'latn'
}

export async function numberLocale() {
  return (await displayDigits()) === 'arab' ? 'ar-EG' : 'ar-EG-u-nu-latn'
}

export async function formatNumber(value, options) {
  return new Intl.NumberFormat(await numberLocale(), options).format(value)
}

export async function formatDateTime(value, options = {}) {
  return new Intl.DateTimeFormat(await numberLocale(), {
    timeZone: 'Africa/Cairo',
    ...options
  }).format(new Date(value))
}

export { DIGITS_COOKIE }