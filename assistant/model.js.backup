'use strict'

const { isIP } = require('node:net')
const { getDatabase } = require('../db/connect')
const capabilities = require('../domain/ai-capabilities.cjs')

function runtimeSetting(key, fallback) {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key=?').get(key)
  return row ? row.value : fallback
}

function isPaused(capability) {
  const row = getDatabase()
    .prepare('SELECT paused FROM ai_provider_state WHERE capability=?')
    .get(capability)
  return row ? Boolean(row.paused) : false
}

function localNovaUrl(value = process.env.V8_LOCAL_AI_URL || 'http://127.0.0.1:7799') {
  let base
  try { base = new URL(value) }
  catch { throw new Error('V8_LOCAL_AI_URL must be a valid loopback URL') }
  const hostname = base.hostname.replace(/^\[|\]$/g, '')
  const ipv4Loopback = isIP(hostname) === 4 && Number(hostname.split('.')[0]) === 127
  const ipv6Loopback = isIP(hostname) === 6 && hostname === '::1'
  if (!['http:', 'https:'].includes(base.protocol) ||
      !(ipv4Loopback || ipv6Loopback) ||
      base.username || base.password || base.search || base.hash) {
    throw new Error('Local Gemma inference is loopback-only; V8_LOCAL_AI_URL must use a loopback IP without credentials, query, or fragment')
  }
  return `${base.toString().replace(/\/+$/, '')}/v1/chat/completions`
}

function normalizeToolCalls(toolCalls) {
  return (toolCalls || []).map((call, index) => {
    if (!call || !call.function || typeof call.function.name !== 'string') {
      throw new Error('AI provider returned a malformed tool call')
    }
    return {
      ...call,
      id: call.id || `call-${index + 1}`,
      type: 'function',
      function: {
        ...call.function,
        arguments: typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments || {})
      }
    }
  })
}

function gemmaMessages(messages) {
  return messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) return message
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => {
        let args = call.function.arguments
        if (typeof args === 'string') {
          try { args = JSON.parse(args) }
          catch { throw new Error('Local Gemma received invalid serialized tool arguments') }
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error('Local Gemma tool arguments must be a JSON object')
        }
        return { ...call, function: { ...call.function, arguments: args } }
      })
    }
  })
}

async function chatGemma(messages, tools) {
  if (isPaused('local_assistant')) {
    throw new Error('LOCAL_ASSISTANT_UNAVAILABLE: تم إيقاف المساعد المحلي من مركز التحكم؛ أعد تشغيله من هناك')
  }
  const headers = { 'content-type': 'application/json' }
  if (process.env.V8_LOCAL_AI_TOKEN) headers.authorization = `Bearer ${process.env.V8_LOCAL_AI_TOKEN}`
  const response = await fetch(localNovaUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gemma4-local',
      messages: gemmaMessages(messages),
      tools,
      stream: false
    }),
    signal: AbortSignal.timeout(180000),
    redirect: 'error'
  })
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.json()).error?.message || '' }
    catch { detail = '' }
    throw new Error(`Local Gemma service returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  const result = await response.json()
  const message = result.choices && result.choices[0] && result.choices[0].message
  if (!message || typeof message.content !== 'string') throw new Error('Local Gemma service returned an invalid chat response')
  return { content: message.content, toolCalls: normalizeToolCalls(message.tool_calls) }
}

async function chatMistral(messages, tools) {
  if (isPaused('cloud_reviewer')) {
    throw new Error('AI_POLICY_BLOCKED: المراجعات السحابية متوقفة من مركز التحكم')
  }
  if (runtimeSetting('ai_allow_cloud', 'false') !== 'true') {
    throw new Error('Mistral is disabled; set AI_ALLOW_CLOUD=true only after accepting that prompts and selected SAPAuto context are sent to Mistral')
  }
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY is required when AI_PROVIDER=mistral')

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
      messages,
      tools,
      ...(tools.length ? { tool_choice: 'auto' } : {})
    }),
    signal: AbortSignal.timeout(120000),
    redirect: 'error'
  })
  if (!response.ok) throw new Error(`Mistral returned HTTP ${response.status}`)
  const result = await response.json()
  const message = result.choices && result.choices[0] && result.choices[0].message
  if (!message) throw new Error('Mistral returned an invalid chat response')
  return { content: message.content || '', toolCalls: normalizeToolCalls(message.tool_calls) }
}

/**
 * Exactly two runtime assistant lanes (plan 2.0 §1.3). There is no third
 * provider, no fallback path, and no silent cloud substitution: if the local
 * lane is down the request fails here and never reaches the cloud lane.
 */
async function chat(messages, tools = []) {
  const provider = runtimeSetting('ai_provider', 'gemma4').toLowerCase()
  if (provider === 'gemma4') return chatGemma(messages, tools)
  if (provider === 'mistral') return chatMistral(messages, tools)
  if (provider === 'opencode') {
    throw new Error('OpenCode is an engineering adviser, not a runtime assistant; use Gemma 4 or explicitly consent to Mistral cloud inference')
  }
  throw new Error(`Unsupported AI provider: ${capabilities.unsupportedProviderMessage(provider)}`)
}

module.exports = {
  chat,
  isPaused,
  localNovaUrl,
  normalizeToolCalls,
  gemmaMessages
}
