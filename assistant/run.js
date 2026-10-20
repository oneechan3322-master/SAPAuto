'use strict'

const { getDatabase } = require('../db/connect')
const { audit, id, now } = require('../db/queries/shared')
const { chat } = require('./model')
const { definitions, execute, authorizeTool, WRITE_TOOLS, IMMEDIATE_TOOLS } = require('./tools')
const { createConfirmation } = require('./confirmations')
const { isOpenCodeConfigured } = require('./code-proposals')
const { boundedToolPayload } = require('../domain/bounded-text.cjs')
const systemPrompt = require('./prompt')

function safeJson(value) {
  try { return boundedToolPayload(value, 12000) }
  catch { return '{"error":"unavailable"}' }
}

const MAX_REASONING_ROUNDS = 4
const MAX_TOOL_CALLS_PER_ROUND = 5

function closureMessages(messages) {
  return [
    { ...messages[0], content: `${messages[0].content}\n\nThe registered tools have already returned their results above. Do not call another tool or claim an action that is not present in those results. Summarize only those results for the user.` },
    ...messages.slice(1)
  ]
}

function asksToListDocuments(text) {
  const value = String(text || '').trim().toLowerCase()
  return /(?:list|show|available\s+documents)/i.test(value) ||
    /(?:إدراج|اعرض|عرض|قائمة).{0,24}(?:المستندات|الوثائق)/.test(value)
}

function formatDocumentsForOwner(result) {
  const documents = Array.isArray(result?.documents) ? result.documents : []
  const upcoming = Array.isArray(result?.upcoming) ? result.upcoming : []
  const overdue = Array.isArray(result?.overdue) ? result.overdue : []
  const lines = [`المستندات المتاحة حالياً: ${documents.length}`]
  if (!documents.length) lines.push('لا توجد مستندات مفتوحة في السجل المحلي حالياً.')
  for (const [index, document] of documents.entries()) {
    const identity = document.doc_number || document.id || `مستند ${index + 1}`
    const title = document.title || 'بدون عنوان صادر من المصدر'
    const deadline = document.deadline ? ` — الموعد: ${document.deadline}` : ' — الموعد غير مسجل'
    const pdf = document.has_pdf ? ' — PDF متاح' : ' — لا يوجد PDF محفوظ'
    lines.push(`${index + 1}. ${identity}: ${title}${deadline}${pdf}`)
  }
  if (upcoming.length) lines.push(`التزامات قادمة مسجلة: ${upcoming.length}`)
  if (overdue.length) lines.push(`التزامات تجاوزت الموعد المسجل: ${overdue.length}`)
  return lines.join('\n')
}

async function runAssistant({ userId, role, text }) {
  if (!userId || !role || typeof text !== 'string' || !text.trim() || text.length > 4000) {
    throw new Error('A signed-in user and message of 1–4000 characters are required')
  }
  const context = { userId, role }
  const db = getDatabase()
  audit(db, { actorId: userId, action: 'assistant.message.started', entityType: 'assistant', details: { role } })
  // This is a read-only office command. Do not depend on a generative model to
  // decide whether it should fetch the list: the owner asked for an exact,
  // auditable result from the local record.
  if (asksToListDocuments(text)) {
    const result = await execute('list_documents', {}, context)
    audit(db, { actorId: userId, action: 'assistant.tool.called', entityType: 'assistant_tool', details: { round: 0, toolCount: 1 } })
    audit(db, { actorId: userId, action: 'assistant.message.completed', entityType: 'assistant', entityId: id('message'), details: { toolCount: 1, at: now() } })
    return { reply: formatDocumentsForOwner(result), tools: ['list_documents'], pendingConfirmations: [] }
  }
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: text.trim() }]
  const codeProposalEnabled = role === 'Owner' &&
    db.prepare("SELECT value FROM settings WHERE key='opencode_proposals_enabled'").get()?.value === 'true' &&
    isOpenCodeConfigured()
  const availableTools = definitions().filter((tool) => tool.function.name !== 'request_code_upgrade' || codeProposalEnabled)
  const pendingConfirmations = []
  const calledTools = []
  let reply = ''
  let reasoning = false
  try {
    // Back-and-forth reasoning: the model may consult tools, read results,
    // call more tools, and only then answer. Written actions keep their
    // approval gate; read-only chains may run up to MAX_REASONING_ROUNDS.
    for (let round = 1; round <= MAX_REASONING_ROUNDS; round += 1) {
      const isLast = round === MAX_REASONING_ROUNDS
      const turn = await chat(closureMessages(messages), isLast ? [] : availableTools)
      if (turn.budgetExceeded) {
        reply = turn.content
        audit(db, { actorId: userId, action: 'assistant.message.completed', entityType: 'assistant', details: { toolCount: calledTools.length } })
        return { reply, tools: [...calledTools], pendingConfirmations }
      }
      if (!turn.toolCalls.length) {
        if (isLast || messages.length === 2) {
          reply = turn.content || 'لم يصل رد نصي من النموذج.'
        } else {
          const closing = await chat(closureMessages(messages), [])
          reply = closing.content || turn.content || 'لم يصل رد نصي من النموذج.'
        }
        break
      }
      messages.push({ role: 'assistant', content: turn.content || '', tool_calls: turn.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND) })
      let wrotePending = false
      for (const call of turn.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND)) {
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
            wrotePending = true
          } else {
            result = await execute(name, args, context)
          }
        } catch (error) {
          audit(db, { actorId: userId, action: 'assistant.tool.failed', entityType: 'assistant_tool', entityId: String(name || 'unknown'), details: { error: String(error.message).slice(0, 300) } })
          result = { error: error.message }
        }
        if (name) calledTools.push(name)
        messages.push({
          role: 'tool', tool_call_id: call.id, name, content: safeJson(result)
        })
      }
      audit(db, { actorId: userId, action: 'assistant.tool.called', entityType: 'assistant_tool', details: { round, toolCount: messages.filter((item) => item.role === 'tool').length } })
      reasoning = true
      if (wrotePending) {
        const closing = await chat(closureMessages(messages), [])
        reply = `${closing.content || 'تم إنشاء إجراء معلق.'}`
        break
      }
    }
    if (!reply) reply = 'لم يكتمل تفكير المساعد؛ أعد المحاولة.'
  } catch (error) {
    if (!reasoning && calledTools.length === 0) throw error
    reply = `تعذر إكمال المعالجة: ${error.message}`
  }
  audit(db, { actorId: userId, action: 'assistant.message.completed', entityType: 'assistant', entityId: id('message'), details: { toolCount: calledTools.length, at: now() } })
  const approvalNotice = pendingConfirmations.length
    ? '\n\nتم إنشاء إجراء معلق؛ راجعه ووافق عليه من لوحة SAPAuto قبل التنفيذ.'
    : ''
  return {
    reply: `${reply}${approvalNotice}`,
    tools: [...calledTools],
    pendingConfirmations
  }
}

module.exports = { runAssistant }
