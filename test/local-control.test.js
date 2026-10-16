'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

test('local control accepts loopback requests and same-origin mutations only', async () => {
  const { localControlError } = await import('../launcher/lib/local-control.js')
  const localRead = new Request('http://localhost:3000/api/settings', {
    headers: { host: 'localhost:3000' }
  })
  assert.equal(localControlError(localRead), null)

  const localMutation = new Request('http://127.0.0.1:3000/api/settings', {
    method: 'PUT',
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }
  })
  assert.equal(localControlError(localMutation, { mutation: true }), null)

  const crossOrigin = new Request('http://localhost:3000/api/settings', {
    method: 'PUT',
    headers: { host: 'localhost:3000', origin: 'https://example.com' }
  })
  assert.equal(localControlError(crossOrigin, { mutation: true }).status, 403)

  const remoteHost = new Request('http://example.com/api/settings', {
    headers: { host: 'example.com' }
  })
  assert.equal(localControlError(remoteHost).status, 403)

  const missingOrigin = new Request('http://localhost:3000/api/settings', {
    method: 'PUT',
    headers: { host: 'localhost:3000' }
  })
  assert.equal(localControlError(missingOrigin, { mutation: true }).status, 403)
})
