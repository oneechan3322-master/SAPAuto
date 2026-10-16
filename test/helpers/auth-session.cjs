'use strict'

const assert = require('node:assert/strict')

let sequence = 0

async function createAuthenticatedCookie(role = 'Operator') {
  const { auth } = await import('../../launcher/lib/auth.js')
  const email = `route-test-${Date.now()}-${sequence++}@example.test`
  const response = await auth.handler(new Request('http://localhost:3000/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Route Test',
      email,
      password: 'Route-Test-Password-123!',
      callbackURL: '/'
    })
  }))
  const result = await response.clone().json()
  assert.equal(response.ok, true, result.message || result.error)
  assert.ok(result.user?.id)

  const { getDatabase } = require('../../db/connect')
  getDatabase().prepare('UPDATE users SET role=? WHERE id=?').run(role, result.user.id)
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0])
  assert.ok(cookies.length > 0, 'sign-up should establish a session cookie')
  return cookies.join('; ')
}

module.exports = { createAuthenticatedCookie }
