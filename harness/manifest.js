'use strict'

const { createHash } = require('node:crypto')
const { listAccounts } = require('./source')

const EXPECTED_ACCOUNT_COUNT = 26

/**
 * Plan 2.1 Stage 1 / §5.1 — source and account preflight.
 *
 * This reads the configured account source and nothing else. It does not open
 * a portal session, does not authenticate, and does not touch the database.
 * Its only job is to refuse a cycle that does not match the agreed scope.
 */

function normalizeAccounts(accounts) {
  if (!Array.isArray(accounts)) return []
  return accounts
    .map((account) => ({
      position: Number(account?.position ?? 0) || 0,
      id: String(account?.username ?? '').trim().toLowerCase(),
      label: String(account?.label ?? '').trim()
    }))
    .filter((account) => account.id)
}

function manifestFingerprint(entries) {
  const canonical = entries.map((entry) => entry.id).sort().join('\n')
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * @param {{expected?: number}} options
 * @returns {Promise<{ok: boolean, problems: string[], count: number,
 *   unique: number, duplicates: string[], fingerprint: string, runId: string,
 *   accounts: Array<{position: number, id: string}>}>}
 */
async function buildManifest({ expected = EXPECTED_ACCOUNT_COUNT } = {}) {
  const runId = `run_${Date.now().toString(36)}`
  let raw = []
  let sourceError = ''
  try {
    raw = await listAccounts()
  } catch (error) {
    sourceError = String(error.message || error).slice(0, 200)
  }

  const entries = normalizeAccounts(raw).map((entry, index) => ({ ...entry, position: index + 1 }))
  const seen = new Map()
  const duplicates = []
  for (const entry of entries) {
    if (seen.has(entry.id)) duplicates.push(entry.id)
    else seen.set(entry.id, entry)
  }

  const problems = []
  if (sourceError) problems.push(`تعذّر قراءة مصدر الحسابات: ${sourceError}`)
  if (entries.length !== expected) {
    problems.push(`عدد الحسابات المهيأة ${entries.length}، والمتوقع ${expected}. لن تبدأ دورة بغير هذا العدد.`)
  }
  if (duplicates.length) {
    problems.push(`معرّفات مكرّرة بعد التطبيع إلى الأحرف الصغيرة: ${[...new Set(duplicates)].join(', ')}`)
  }

  return {
    ok: problems.length === 0,
    problems,
    count: entries.length,
    unique: seen.size,
    duplicates: [...new Set(duplicates)],
    fingerprint: manifestFingerprint(entries),
    runId,
    // Identifiers only. No labels, credentials, or paths are carried forward.
    accounts: entries.map((entry) => ({ position: entry.position, id: entry.id }))
  }
}

if (require.main === module) {
  buildManifest().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.ok ? 0 : 1
  })
}

module.exports = { EXPECTED_ACCOUNT_COUNT, buildManifest, manifestFingerprint, normalizeAccounts }