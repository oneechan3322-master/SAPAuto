'use strict'

function displayText(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  const text = value.replace(/\s+/g, ' ').trim()
  return text || fallback
}

module.exports = { displayText }
