'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')

function baseDirectory() {
  const v8Root = process.env.V8_ROOT || path.resolve(__dirname, '..')
  return path.resolve(v8Root, process.env.V8_BASE_DIR || '../SAPAuto3')
}

function safeChildEnvironment() {
  const allowed = [
    'PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
    'APPDATA', 'LOCALAPPDATA', 'NODE_EXTRA_CA_CERTS'
  ]
  return Object.fromEntries(allowed
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]))
}

function runLegacy(args, timeoutMs = 15 * 60 * 1000) {
  const root = baseDirectory()
  const entry = path.join(root, 'src', 'orchestrator.js')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--use-system-ca', '--env-file=.env', entry, ...args], {
      cwd: root,
      env: safeChildEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`SAPAuto3 process exceeded ${Math.round(timeoutMs / 1000)} seconds`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-200000) })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-12000) })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Could not start SAPAuto3: ${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`SAPAuto3 exited with ${code}: ${stderr.trim().slice(-2000)}`))
      resolve({ stdout, stderr })
    })
  })
}

async function listAccounts() {
  const { stdout } = await runLegacy(['--list-accounts'], 30000)
  const line = stdout.split(/\r?\n/).find((item) => item.startsWith('SAPAUTO_V8_ACCOUNTS '))
  if (!line) throw new Error('SAPAuto3 returned no account list')
  const accounts = JSON.parse(line.slice('SAPAUTO_V8_ACCOUNTS '.length))
  if (!Array.isArray(accounts)) throw new Error('SAPAuto3 account list has an invalid shape')
  return accounts
}

module.exports = { baseDirectory, listAccounts, runLegacy }
