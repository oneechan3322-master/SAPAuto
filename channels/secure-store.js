'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const storePath = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'SAPAuto',
  'V8',
  'channels.dpapi'
)

const powershellScript = [
  "$ErrorActionPreference = 'Stop'",
  '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  "if ($request.action -eq 'protect') {",
  '  $secure = ConvertTo-SecureString ([string]$request.value) -AsPlainText -Force',
  '  [Console]::Out.Write((ConvertFrom-SecureString $secure))',
  "} elseif ($request.action -eq 'unprotect') {",
  '  $secure = ConvertTo-SecureString ([string]$request.value)',
  '  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
  '  try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }',
  '  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }',
  "} else { throw 'Unsupported credential operation' }"
].join('\n')

function invokeProtection(action, value) {
  if (process.platform !== 'win32') {
    throw new Error('Secure channel storage requires Windows user-protected credential encryption.')
  }
  const encodedCommand = Buffer.from(powershellScript, 'utf16le').toString('base64')
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand
  ], {
    input: JSON.stringify({ action, value }),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024
  })
  if (result.error) throw new Error(`Could not access Windows credential protection: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`Windows credential protection failed: ${(result.stderr || '').trim().slice(-500)}`)
  }
  return result.stdout
}

function readAll() {
  if (!fs.existsSync(storePath)) return {}
  const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  if (stored.version !== 1 || typeof stored.cipher !== 'string') {
    throw new Error('The protected channel credential store has an unsupported format.')
  }
  const credentials = JSON.parse(invokeProtection('unprotect', stored.cipher))
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error('The protected channel credential store has an invalid format.')
  }
  return credentials
}

function writeAll(credentials) {
  const cipher = invokeProtection('protect', JSON.stringify(credentials))
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
  const temporaryPath = `${storePath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({
        version: 1,
        providers: Object.keys(credentials),
        cipher
      }), { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(temporaryPath, storePath)
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath)
  }
}

function hasStoredCredentials(provider) {
  if (!fs.existsSync(storePath)) return false
  const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  return stored.version === 1 && Array.isArray(stored.providers) && stored.providers.includes(provider)
}

module.exports = { hasStoredCredentials, readAll, writeAll }
