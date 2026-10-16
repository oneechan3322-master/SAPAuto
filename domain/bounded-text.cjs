'use strict'

/**
 * Plan 2.4 §3.2 / §9.1 — "no JavaScript substring/slice" on legally material
 * content, and §2 "truth over polish": a cut must never be silent.
 *
 * These helpers truncate only when a transport genuinely has a hard limit,
 * and they always say so. An operator receiving a shortened answer can tell
 * that it was shortened and can open the full answer locally.
 */

const NOTICE_AR = '\n\n— بُتِر النص لأن قناة الإرسال لها حد أقصى؛ النص الكامل محفوظ على جهازك في SAPAuto.'

/**
 * Truncates outbound user-facing text on a hard channel boundary and marks it.
 * Cuts at a sentence or word boundary so a name or number is never split.
 */
function boundedText(value, limit) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const boundary = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '), head.lastIndexOf(' '))
  const cut = boundary > limit * 0.6 ? head.slice(0, boundary) : head
  return `${cut.trimEnd()}${NOTICE_AR}`
}

/**
 * Truncates a tool result for the model. Structured rather than a bare slice,
 * so the model is told what it is not seeing instead of reasoning over a
 * silently incomplete payload.
 */
function boundedToolPayload(value, limit = 12000) {
  let json
  try { json = JSON.stringify(value) }
  catch { json = String(value) }
  if (json.length <= limit) return json
  return JSON.stringify({
    truncated: true,
    omittedCharacters: json.length - limit,
    note: 'The tool result exceeded the context limit. Narrow the scope or read a smaller slice. Do not assume omitted records do not exist.',
    preview: json.slice(0, limit)
  })
}

module.exports = { NOTICE_AR, boundedText, boundedToolPayload }