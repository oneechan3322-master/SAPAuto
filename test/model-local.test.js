'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const previousDbPath = process.env.V8_DB_PATH
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-model-'))
process.env.V8_DB_PATH = path.join(testDirectory, 'model.db')
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const runtimeDb = getDatabase()
runMigrations(runtimeDb)
const {
  chat, gemmaMessages, localNovaUrl
} = require('../assistant/model')

function setRuntimeSetting(key, value) {
  runtimeDb.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString())
}

test.after(() => {
  runtimeDb.close()
  fs.rmSync(testDirectory, { recursive: true, force: true })
  if (previousDbPath === undefined) delete process.env.V8_DB_PATH
  else process.env.V8_DB_PATH = previousDbPath
})

test('the local Gemma endpoint is constrained to loopback addresses', () => {
  assert.equal(localNovaUrl('http://127.0.0.1:7799/'), 'http://127.0.0.1:7799/v1/chat/completions')
  assert.equal(localNovaUrl('http://[::1]:7799'), 'http://[::1]:7799/v1/chat/completions')
  assert.throws(() => localNovaUrl('https://ai.example.com'), /loopback IP/)
  assert.throws(() => localNovaUrl('http://127.0.0.1:7799?redirect=1'), /loopback IP/)
})

test('unknown AI providers fail closed without making a network request', async (t) => {
  const previousFetch = global.fetch
  let requests = 0
  setRuntimeSetting('ai_provider', 'unknown')
  global.fetch = async () => { requests += 1; throw new Error('unexpected network request') }
  t.after(() => { global.fetch = previousFetch })

  await assert.rejects(chat([]), /Unsupported AI provider/)
  assert.equal(requests, 0)
})

test('a paused local assistant refuses work and never falls back to the cloud', async (t) => {
  const previousFetch = global.fetch
  let requests = 0
  global.fetch = async () => { requests += 1; throw new Error('unexpected network request') }
  setRuntimeSetting('ai_provider', 'gemma4')
  setRuntimeSetting('ai_allow_cloud', 'true')
  runtimeDb.prepare('UPDATE ai_provider_state SET paused=1 WHERE capability=?').run('local_assistant')
  t.after(() => {
    runtimeDb.prepare('UPDATE ai_provider_state SET paused=0 WHERE capability=?').run('local_assistant')
    global.fetch = previousFetch
  })

  await assert.rejects(chat([{ role: 'user', content: 'مرحبا' }]), /LOCAL_ASSISTANT_UNAVAILABLE/)
  assert.equal(requests, 0, 'a stopped local assistant makes no request at all')
})

test('local Gemma requests disable redirects', async (t) => {
  const previousFetch = global.fetch
  let options
  setRuntimeSetting('ai_provider', 'gemma4')
  global.fetch = async (_url, requestOptions) => {
    options = requestOptions
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'local response' } }] }) }
  }
  t.after(() => { global.fetch = previousFetch })

  assert.deepEqual(await chat([]), { content: 'local response', toolCalls: [] })
  assert.equal(options.redirect, 'error')
})

test('Mistral requires explicit cloud consent and an API key before network access', async (t) => {
  const previous = {
    provider: process.env.AI_PROVIDER,
    allowCloud: process.env.AI_ALLOW_CLOUD,
    apiKey: process.env.MISTRAL_API_KEY
  }
  const previousFetch = global.fetch
  let requests = 0
  process.env.AI_PROVIDER = 'mistral'
  setRuntimeSetting('ai_provider', 'mistral')
  setRuntimeSetting('ai_allow_cloud', 'false')
  delete process.env.AI_ALLOW_CLOUD
  delete process.env.MISTRAL_API_KEY
  global.fetch = async () => { requests += 1; throw new Error('unexpected network request') }
  t.after(() => {
    for (const [key, value] of Object.entries({
      AI_PROVIDER: previous.provider,
      AI_ALLOW_CLOUD: previous.allowCloud,
      MISTRAL_API_KEY: previous.apiKey
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    global.fetch = previousFetch
  })

  await assert.rejects(chat([]), /AI_ALLOW_CLOUD=true/)
  process.env.AI_ALLOW_CLOUD = 'true'
  setRuntimeSetting('ai_allow_cloud', 'true')
  await assert.rejects(chat([]), /MISTRAL_API_KEY is required/)
  assert.equal(requests, 0)
})

test('Mistral uses a fixed endpoint, disables redirects, and normalizes tool calls', async (t) => {
  const previous = {
    provider: process.env.AI_PROVIDER,
    allowCloud: process.env.AI_ALLOW_CLOUD,
    apiKey: process.env.MISTRAL_API_KEY,
    model: process.env.MISTRAL_MODEL
  }
  const previousFetch = global.fetch
  let request
  process.env.AI_PROVIDER = 'mistral'
  setRuntimeSetting('ai_provider', 'mistral')
  setRuntimeSetting('ai_allow_cloud', 'true')
  process.env.AI_ALLOW_CLOUD = 'true'
  process.env.MISTRAL_API_KEY = 'test-key'
  process.env.MISTRAL_MODEL = 'mistral-small-latest'
  global.fetch = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: {
        content: '',
        tool_calls: [{ id: 'call-1', function: { name: 'status', arguments: { scope: 'today' } } }]
      } }] })
    }
  }
  t.after(() => {
    for (const [key, value] of Object.entries({
      AI_PROVIDER: previous.provider,
      AI_ALLOW_CLOUD: previous.allowCloud,
      MISTRAL_API_KEY: previous.apiKey,
      MISTRAL_MODEL: previous.model
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    global.fetch = previousFetch
  })

  const result = await chat([{ role: 'user', content: 'status' }], [{ type: 'function' }])
  assert.equal(request.url, 'https://api.mistral.ai/v1/chat/completions')
  assert.equal(request.options.headers.authorization, 'Bearer test-key')
  assert.equal(request.options.redirect, 'error')
  assert.equal(result.toolCalls[0].function.arguments, '{"scope":"today"}')
})

test('OpenCode is not a runtime assistant lane and fails closed', async (t) => {
  const previousFetch = global.fetch
  let requests = 0
  setRuntimeSetting('ai_provider', 'opencode')
  global.fetch = async () => { requests += 1; throw new Error('unexpected network request') }
  t.after(() => { global.fetch = previousFetch })

  await assert.rejects(chat([{ role: 'user', content: 'synthetic prompt' }]), /engineering adviser, not a runtime assistant/)
  assert.equal(requests, 0)
})

test('Gemma service URL is numeric-loopback only', () => {
  assert.equal(localNovaUrl('http://127.0.0.1:7799'), 'http://127.0.0.1:7799/v1/chat/completions')
  assert.throws(() => localNovaUrl('http://example.com:7799'), /loopback-only/)
})

test('Gemma provider sends context only to the fixed loopback service', async (t) => {
  const previous = {
    provider: process.env.AI_PROVIDER,
    url: process.env.V8_LOCAL_AI_URL,
    token: process.env.V8_LOCAL_AI_TOKEN
  }
  const previousFetch = global.fetch
  let request
  process.env.AI_PROVIDER = 'gemma4'
  setRuntimeSetting('ai_provider', 'gemma4')
  process.env.V8_LOCAL_AI_URL = 'http://127.0.0.1:7799'
  process.env.V8_LOCAL_AI_TOKEN = 'local-test-token'
  global.fetch = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'local response', tool_calls: [] } }] })
    }
  }
  t.after(() => {
    for (const [key, value] of Object.entries({
      AI_PROVIDER: previous.provider,
      V8_LOCAL_AI_URL: previous.url,
      V8_LOCAL_AI_TOKEN: previous.token
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    global.fetch = previousFetch
  })

  assert.deepEqual(await chat([{ role: 'user', content: 'local prompt' }]), {
    content: 'local response',
    toolCalls: []
  })
  assert.equal(request.url, 'http://127.0.0.1:7799/v1/chat/completions')
  assert.equal(request.options.headers.authorization, 'Bearer local-test-token')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.body.includes('local prompt'), true)
})

test('Gemma provider normalizes function calls returned by the local runtime', async (t) => {
  const previous = process.env.AI_PROVIDER
  const previousFetch = global.fetch
  process.env.AI_PROVIDER = 'gemma4'
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: {
      content: '',
      tool_calls: [{ id: 'gemma-call', function: { name: 'status', arguments: {} } }]
    } }] })
  })
  t.after(() => {
    if (previous === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = previous
    global.fetch = previousFetch
  })

  assert.deepEqual(await chat([{ role: 'user', content: 'status' }]), {
    content: '',
    toolCalls: [{
      id: 'gemma-call',
      type: 'function',
      function: { name: 'status', arguments: '{}' }
    }]
  })
})

test('Gemma serializes prior V8 tool arguments in the GGUF runtime format', () => {
  const messages = gemmaMessages([{
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'call-1', function: { name: 'status', arguments: '{"scope":"today"}' } }]
  }])
  assert.deepEqual(messages[0].tool_calls[0].function.arguments, { scope: 'today' })
  assert.throws(() => gemmaMessages([{
    role: 'assistant',
    tool_calls: [{ function: { name: 'status', arguments: 'not-json' } }]
  }]), /invalid serialized tool arguments/)
})
