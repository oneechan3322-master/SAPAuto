'use strict'

const tools = {
  status: { minimumRole: 'Viewer', run: require('./status'), parameters: { type: 'object', properties: {}, additionalProperties: false } },
  summarize: { minimumRole: 'Viewer', run: require('./summarize'), parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['all', 'tasks', 'obligations', 'payments'] }, period: { type: 'string', enum: ['today', 'week', 'month'] } }, additionalProperties: false } },
  list_failures: { minimumRole: 'Viewer', run: require('./list-failures'), parameters: { type: 'object', properties: { since: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false } },
  save_note: { minimumRole: 'Operator', run: require('./save-note'), parameters: { type: 'object', properties: { target_type: { type: 'string', enum: ['company', 'task', 'obligation', 'payment'] }, target_id: { type: 'string' }, text: { type: 'string' } }, required: ['target_type', 'target_id', 'text'], additionalProperties: false } },
  add_task: { minimumRole: 'Operator', run: require('./add-task'), parameters: { type: 'object', properties: { company: { type: 'string' }, title: { type: 'string' }, deadline: { type: 'string' }, assignee: { type: 'string' } }, required: ['company', 'title'], additionalProperties: false } },
  add_reminder: { minimumRole: 'Operator', run: require('./add-reminder'), parameters: { type: 'object', properties: { description: { type: 'string', maxLength: 300 }, target: { type: 'string', maxLength: 200 }, target_type: { type: 'string', enum: ['general', 'task', 'obligation', 'payment'] }, when: { type: 'string' }, channel: { type: 'string', enum: ['launcher', 'telegram', 'whatsapp', 'email'] } }, required: ['when'], additionalProperties: false } },
  mark_obligation_done: { minimumRole: 'Operator', run: require('./mark-obligation-done'), parameters: { type: 'object', properties: { obligation_id: { type: 'string' }, evidence: { type: 'string' } }, required: ['obligation_id'], additionalProperties: false } },
  send_report: { minimumRole: 'Operator', run: require('./send-report'), parameters: { type: 'object', properties: { channel: { type: 'string', enum: ['telegram', 'whatsapp', 'email'] }, recipients: { type: ['string', 'array'] } }, required: ['channel'], additionalProperties: false } },
  scan_now: { minimumRole: 'Operator', run: require('./scan-now'), parameters: { type: 'object', properties: { account: { type: 'string' } }, additionalProperties: false } },
  request_code_upgrade: { minimumRole: 'Owner', run: require('./request-code-upgrade'), parameters: { type: 'object', properties: { request: { type: 'string', minLength: 1, maxLength: 1500 } }, required: ['request'], additionalProperties: false } }
}

const WRITE_TOOLS = new Set([
  'save_note', 'add_task', 'add_reminder', 'mark_obligation_done', 'send_report', 'scan_now', 'request_code_upgrade'
])

function definitions() {
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: { name, description: `SAPAuto V8 ${name} action`, parameters: tool.parameters }
  }))
}

async function execute(name, args, context) {
  const item = tools[name]
  if (!item) throw new Error('Unknown assistant tool')
  authorizeTool(name, context.role)
  return item.run(args, context)
}

function authorizeTool(name, role) {
  const item = tools[name]
  if (!item) throw new Error('Unknown assistant tool')
  const levels = { Viewer: 0, Operator: 1, Owner: 2 }
  if ((levels[role] ?? -1) < levels[item.minimumRole]) throw new Error('Insufficient role for this assistant action')
}

module.exports = { tools, definitions, execute, authorizeTool, WRITE_TOOLS }
