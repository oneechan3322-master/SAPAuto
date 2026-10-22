'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..', 'launcher', 'app', 'api')
const VALID_ROLES = new Set(['Viewer', 'Operator', 'Owner'])

function routeFiles(directory = ROOT, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) routeFiles(path.join(directory, entry.name), result)
    else if (entry.name.endsWith('route.js')) result.push(path.join(directory, entry.name))
  }
  return result
}

test('S1: every requireRole minimum is a real role (no-op "Admin" is banned)', () => {
  const offenders = []
  for (const file of routeFiles()) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/requireRole\(\s*(?:request|new Request[^)]*)\s*,\s*'([^']+)'/g)) {
      if (!VALID_ROLES.has(match[1])) offenders.push(`${file}: '${match[1]}'`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('S1: "Admin" is not a launcher role anywhere', () => {
  for (const file of routeFiles()) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /'Admin'/, `${file} references the no-op role`)
  }
})

test('S1: account write routes require Owner (a Viewer gets 403 via the guard)', () => {
  const ownerRoute = fs.readFileSync(path.join(ROOT, 'accounts', 'route.js'), 'utf8')
  const verifyRoute = fs.readFileSync(path.join(ROOT, 'accounts', 'verify', 'route.js'), 'utf8')
  assert.equal((ownerRoute.match(/requireRole\(request, 'Owner'\)/g) || []).length, 3)
  assert.match(verifyRoute, /requireRole\(request, 'Owner'\)/)
  // The guard must deny a Viewer at Owner level: ROLE_LEVEL['Viewer']=0 < 2.
  const guard = fs.readFileSync(path.resolve(__dirname, '..', 'launcher', 'lib', 'guard.js'), 'utf8')
  assert.match(guard, /Viewer:\s*0/)
  assert.match(guard, /Operator:\s*1/)
  assert.match(guard, /Owner:\s*2/)
  assert.match(guard, /ROLE_LEVEL\[session\.user\.role\] \?\? -1\) < ROLE_LEVEL\[minimum\]/)
})
