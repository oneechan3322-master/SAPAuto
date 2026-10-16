'use strict'

const { getDatabase } = require('../db/connect')
const { audit, id, now } = require('../db/queries/shared')
const { chat } = require('./model')
const { definitions, execute, authorizeTool, WRITE_TOOLS } = require('./tools')
const { createConfirmation } = require('./confirmations')
const { isOpenCodeConfigured } = require('./code-proposals')
const { boundedToolPayload } = require('../domain/bounded-text.cjs')
const systemPrompt = require('./prompt')

function safeJson(value) {
  try { return boundedToolPayload(value, 12000) }
  catch { return '{"error":"unavailable"}' }
}

async function runAssistant({ userId, role, text }) {
  if (!userId || !role || typeof text !== 'string' || !text.trim() || text.length > 4000) {
    throw new Error('A signed-in user and message of 1–4000 characters are required')
  }
  const context = { userId, role }
  const db = getDatabase()
  audit(db, { actorId: userId, action: 'assistant.message.started', entityType: 'assistant', details: { role } })
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: text.trim() }]
  const codeProposalEnabled = role === 'Owner' &&
    db.prepare("SELECT value FROM settings WHERE key='opencode_proposals_enabled'").get()?.value === 'true' &&
    isOpenCodeConfigured()
  const availableTools = definitions().filter((tool) => tool.function.name !== 'request_code_upgrade' || codeProposalEnabled)
  const first = await chat(messages, availableTools)
  if (first.budgetExceeded) return { reply: first.content, tools: [] }
  if (!first.toolCalls.length) {
    audit(db, { actorId: userId, action: 'assistant.message.completed', entityType: 'assistant', details: { toolCount: 0 } })
    return { reply: first.content || 'لم يصل رد نصي من النموذج.', tools: [] }
  }
  const results = []
  const pendingConfirmations = []
  for (const call of first.toolCalls.slice(0, 5)) {
    const name = call.function && call.function.name
    let args
    try { args = JSON.parse(call.function.arguments || '{}') }
    catch { throw new Error(`Model returned invalid arguments for ${name || 'tool'}`) }
    let result
    try {
      if (!availableTools.some((tool) => tool.function.name === name)) {
        throw new Error('Assistant requested an unavailable tool')
      } else if (WRITE_TOOLS.has(name)) {
        authorizeTool(name, role)
        const confirmationId = createConfirmation({ userId, toolName: name, args, db })
        result = { confirmationRequired: true, confirmationId, tool: name }
        pendingConfirmations.push({ id: confirmationId, toolName: name })
      } else {
        result = await execute(name, args, context)
        audit(db, { actorId: userId, action: 'assistant.tool.called', entityType: 'assistant_tool', entityId: name, details: { argumentKeys: Object.keys(args) } })
      }
    } catch (error) {
      audit(db, { actorId: userId, action: 'assistant.tool.failed', entityType: 'assistant_tool', entityId: String(name || 'unknown'), details: { error: String(error.message).slice(0, 300) } })
      result = { error: error.message }
    }
    results.push({ id: call.id, name, result })
  }
  messages.push({ role: 'assistant', content: first.content || '', tool_calls: first.toolCalls.slice(0, results.length) })
  for (const result of results) messages.push({
    role: 'tool', tool_call_id: result.id, name: result.name, content: safeJson(result.result)
  })
  messages[0] = {
    ...messages[0],
    content: `${messages[0].content}\n\nThe registered tools have already returned their results above. Do not call another tool or claim an action that is not present in those results. Summarize only those results for the user.`
  }
  const final = await chat(messages, [])
  audit(db, { actorId: userId, action: 'assistant.message.completed', entityType: 'assistant', entityId: id('message'), details: { toolCount: results.length, at: now() } })
  const approvalNotice = pendingConfirmations.length
    ? '\n\nتم إنشاء إجراء معلق؛ راجعه ووافق عليه من لوحة SAPAuto قبل التنفيذ.'
    : ''
  return {
    reply: `${final.content || results.map((item) => safeJson(item.result)).join('\n')}${approvalNotice}`,
    tools: results.map(({ name }) => name),
    pendingConfirmations
  }
}

module.exports = { runAssistant }
