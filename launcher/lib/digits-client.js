'use client'

/**
 * Client-side mirror of the display preference. The cookie is the single
 * source of truth; the server reads the same cookie so the first paint and
 * the hydrated render agree.
 */
export function digitsFromCookie() {
  if (typeof document === 'undefined') return 'latn'
  const match = document.cookie.match(/(?:^|;\s*)sapauto_digits=(\w+)/)
  return match?.[1] === 'arab' ? 'arab' : 'latn'
}

export function numberLocaleFromCookie() {
  return digitsFromCookie() === 'arab' ? 'ar-EG' : 'ar-EG-u-nu-latn'
}

export function formatNumberWith(value, options) {
  const safe = Number(value)
  return new Intl.NumberFormat(numberLocaleFromCookie(), options).format(Number.isFinite(safe) ? safe : 0)
}

export function formatDateWith(value, options = {}) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(numberLocaleFromCookie(), { timeZone: 'Africa/Cairo', ...options }).format(date)
}