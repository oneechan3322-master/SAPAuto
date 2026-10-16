'use strict'

const http = require('node:http')
const { randomUUID, timingSafeEqual } = require('node:crypto')
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { execute, authorizeTool, WRITE_TOOLS } = require('../assistant/tools')
const { createConfirmation } = require('../assistant/confirmations')

function tokenMatches(header, secret) {
  if (!secret || typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const provided = Buffer.from(header.slice(7))
  const expected = Buffer.from(secret)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1024 * 1024) {
        reject(new Error('MCP request body exceeds 1 MB'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try { resolve(JSON.parse(raw)) }
      catch { reject(new Error('MCP request must contain valid JSON')) }
    })
    request.on('error', reject)
  })
}

function createMcpServer(userId, db, modules) {
  const server = new modules.McpServer({ name: 'sapauto-v8', version: '8.0.0' })
  const { z } = modules
  const schemas = {
    status: z.object({}),
    summarize: z.object({ scope: z.enum(['all', 'tasks', 'obligations', 'payments']).optional(), period: z.enum(['today', 'week', 'month']).optional() }),
    list_failures: z.object({ since: z.number().int().min(1).max(365).optional() }),
    save_note: z.object({ target_type: z.enum(['company', 'task', 'obligation', 'payment']), target_id: z.string().min(1).max(200), text: z.string().min(1).max(4000) }),
    add_task: z.object({ company: z.string().min(1), title: z.string().min(1).max(300), deadline: z.string().optional(), assignee: z.string().optional() }),
    add_reminder: z.object({ target: z.string().optional(), when: z.string(), channel: z.enum(['launcher', 'telegram', 'whatsapp', 'email']).optional() }),
    mark_obligation_done: z.object({ obligation_id: z.string().min(1), evidence: z.string().max(2000).optional() }),
    send_report: z.object({ channel: z.enum(['telegram', 'whatsapp', 'email']), recipients: z.union([z.string(), z.array(z.string())]).optional() }),
    scan_now: z.object({ account: z.string().max(150).optional() })
  }
  const names = Object.keys(schemas)
  for (const name of names) {
    server.registerTool(name, {
      description: `SAPAuto V8 ${name}. Changes, scans, and sends require explicit approval in the authenticated V8 launcher.`,
      inputSchema: schemas[name]
    }, async (args) => {
      const user = db.prepare('SELECT role,disabled FROM users WHERE id=?').get(userId)
      if (!user || user.disabled) throw new Error('Configured MCP user is missing or disabled')
      if (WRITE_TOOLS.has(name)) {
        authorizeTool(name, user.role)
        const confirmationId = createConfirmation({ userId, toolName: name, args, db })
        return { content: [{ type: 'text', text: JSON.stringify({ confirmationRequired: true, confirmationId, tool: name }) }] }
      }
      const result = await execute(name, args, { userId, role: user.role })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    })
  }
  return server
}

async function startMcpServer({ db = getDatabase(), host = process.env.V8_MCP_HOST || '127.0.0.1', port = Number(process.env.V8_MCP_PORT || 3101), token = process.env.V8_MCP_BEARER_TOKEN, userId = process.env.V8_MCP_USER_ID } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('V8_MCP_PORT must be 1024–65535')
  if (Boolean(token) !== Boolean(userId)) throw new Error('Configure both V8_MCP_BEARER_TOKEN and V8_MCP_USER_ID, or leave both empty')
  if (userId && !db.prepare('SELECT id FROM users WHERE id=? AND disabled=0').get(userId)) {
    throw new Error('V8_MCP_USER_ID must identify an active V8 user')
  }
  const modules = {
    McpServer: (await import('@modelcontextprotocol/sdk/server/mcp.js')).McpServer,
    StreamableHTTPServerTransport: (await import('@modelcontextprotocol/sdk/server/streamableHttp.js')).StreamableHTTPServerTransport,
    isInitializeRequest: (await import('@modelcontextprotocol/sdk/types.js')).isInitializeRequest,
    z: await import('zod/v4')
  }
  const sessions = new Map()
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    if (url.pathname !== '/mcp' || !token || !tokenMatches(request.headers.authorization, token)) {
      response.writeHead(token ? 401 : 503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: token ? 'Unauthorized' : 'MCP is not configured' }))
      return
    }
    try {
      let body
      if (request.method === 'POST') body = await readBody(request)
      const sessionId = request.headers['mcp-session-id']
      let session = sessionId ? sessions.get(sessionId) : null
      if (!session && request.method === 'POST' && modules.isInitializeRequest(body)) {
        if (sessions.size >= 50) throw new Error('MCP session limit reached')
        const mcpServer = createMcpServer(userId, db, modules)
        let transport
        transport = new modules.StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newId) => sessions.set(newId, { transport, server: mcpServer, lastUsedAt: Date.now() })
        })
        session = { transport, server: mcpServer, lastUsedAt: Date.now() }
        transport.onclose = () => sessions.delete(transport.sessionId)
        await mcpServer.connect(transport)
        await transport.handleRequest(request, response, body)
        return
      }
      if (!session) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'MCP session not found' }))
        return
      }
      session.lastUsedAt = Date.now()
      await session.transport.handleRequest(request, response, body)
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(error.message.includes('limit') ? 503 : 400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: error.message }))
      } else response.destroy(error)
    }
  })
  const cleanup = setInterval(() => {
    const expiry = Date.now() - 30 * 60 * 1000
    for (const [key, session] of sessions) {
      if (session.lastUsedAt < expiry) {
        sessions.delete(key)
        void session.transport.close()
      }
    }
  }, 60000).unref()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return {
    server,
    close: async () => {
      clearInterval(cleanup)
      await Promise.allSettled([...sessions.values()].map(({ transport }) => transport.close()))
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
}

async function main() {
  require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
  const db = getDatabase()
  runMigrations(db)
  const instance = await startMcpServer({ db })
  console.log(`SAPAuto MCP listening on ${process.env.V8_MCP_HOST || '127.0.0.1'}:${process.env.V8_MCP_PORT || 3101}`)
  const shutdown = () => instance.close().then(() => db.close()).catch((error) => {
    console.error(`MCP shutdown failed: ${error.message}`)
    process.exitCode = 1
  })
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

if (require.main === module) main().catch((error) => {
  console.error(`MCP server failed: ${error.stack || error}`)
  process.exitCode = 1
})

module.exports = { startMcpServer, tokenMatches }
