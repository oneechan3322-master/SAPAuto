/**
 * Crash-safe JSON register replace.
 *
 * A write lands in `<file>.<pid>.tmp`, is fsynced, then renamed over the target.
 * `writeFileSync` alone can return before the bytes are on disk, so a power
 * loss between the write and the rename can destroy both the temp and, on some
 * platforms, the file it was about to replace. The rename is retried: Windows
 * throws EPERM while another handle still has the destination open.
 *
 * A temp left beside a *missing* target is never adopted. A partial register is
 * worse than no register, so the load logs and throws.
 *
 * Adheres to RULE 3 (NO SILENT FAILURES), RULE 5 (RESOURCE CLEANUP),
 * RULE 7 (FAIL-SAFE DEFAULTS).
 */

const fs = require('fs');
const path = require('path');
const { StorageError } = require('../common/errors');
const { defaultLogger } = require('../common/logger');

const RETRYABLE_RENAME = new Set(['EPERM', 'EACCES', 'EBUSY']);
const DEFAULT_RENAME_ATTEMPTS = 8;
const DEFAULT_RENAME_BASE_MS = 20;

/**
 * `<file>.<pid>.tmp` and the older `<file>.tmp.<pid-or-stamp>` names.
 * Backup files (`*.bak-*`) are deliberately not temps.
 * @param {string} filePath
 * @returns {string[]}
 */
function findPartialTemps(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\.(?:\\d+\\.tmp|tmp\\.\\d+)$`);
  const found = [];
  for (const name of names) {
    if (pattern.test(name)) found.push(path.join(dir, name));
  }
  return found;
}

function tempPathFor(filePath, pid = process.pid) {
  return `${filePath}.${pid}.tmp`;
}

/**
 * @param {number} ms
 */
function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Load guard. Throws when the register file is gone but a temp survived.
 * When the register itself is present, leftover temps are logged and ignored.
 * @param {string} filePath
 */
function guardRegisterLoad(filePath) {
  const leftovers = findPartialTemps(filePath);
  if (fs.existsSync(filePath)) {
    if (leftovers.length > 0) {
      defaultLogger.warn(
        `Ignoring ${leftovers.length} partial temp file(s) beside ${filePath}; the existing register was not replaced.`,
        { filePath, leftovers }
      );
    }
    return;
  }
  if (leftovers.length === 0) return;

  const message =
    `Refusing to load ${filePath}: the register file is missing and a partial temp remains ` +
    `(${leftovers.join(', ')}). A partial register is worse than no register, so it was not adopted.`;
  defaultLogger.error(message, { filePath, leftovers });
  throw new StorageError(message, {
    filePath,
    leftovers,
    reason: 'ORPHAN_TEMP'
  });
}

/**
 * Writes `value` durably and replaces `filePath`.
 *
 * @param {string} filePath
 * @param {unknown} value JSON-serialisable value
 * @param {Object} [options]
 * @param {number} [options.pid]
 * @param {number} [options.renameAttempts]
 * @param {number} [options.renameBaseMs]
 * @param {(from: string, to: string) => void} [options.renameImpl]
 * @param {(tempPath: string) => void} [options.beforeRename] Runs after fsync and before rename. Used to abort a crash test.
 * @returns {{ filePath: string, tempPath: string, attempts: number }}
 */
function writeJsonAtomic(filePath, value, options = {}) {
  const opts = (options && typeof options === 'object') ? options : {};
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new StorageError(`Failed to create register directory ${dir}`, { dir }, err);
  }

  const pid = Number.isInteger(opts.pid) && opts.pid > 0 ? opts.pid : process.pid;
  const tempPath = tempPathFor(filePath, pid);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const attempts = Number.isInteger(opts.renameAttempts) && opts.renameAttempts > 0
    ? opts.renameAttempts
    : DEFAULT_RENAME_ATTEMPTS;
  const baseMs = Number.isInteger(opts.renameBaseMs) && opts.renameBaseMs >= 0
    ? opts.renameBaseMs
    : DEFAULT_RENAME_BASE_MS;
  const renameImpl = typeof opts.renameImpl === 'function' ? opts.renameImpl : fs.renameSync;

  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'w');
    fs.writeFileSync(fd, serialized, 'utf8');
    fs.fsyncSync(fd);
  } catch (err) {
    throw new StorageError(
      `Failed to write register temp ${tempPath}`,
      { filePath, tempPath },
      err
    );
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeErr) {
        defaultLogger.error('Failed to close register temp file', { tempPath }, closeErr);
      }
    }
  }

  if (typeof opts.beforeRename === 'function') {
    opts.beforeRename(tempPath);
  }

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      renameImpl(tempPath, filePath);
      return { filePath, tempPath, attempts: attempt };
    } catch (err) {
      lastError = err;
      const retryable = Boolean(err && RETRYABLE_RENAME.has(err.code));
      if (!retryable || attempt === attempts) break;
      sleepMs(baseMs * (2 ** (attempt - 1)));
    }
  }

  const code = lastError && lastError.code ? lastError.code : 'UNKNOWN';
  throw new StorageError(
    `Failed to replace ${filePath} after ${attempts} attempt(s) (${code}). The previous register was left in place.`,
    { filePath, tempPath, code, attempts },
    lastError instanceof Error ? lastError : null
  );
}

module.exports = {
  RETRYABLE_RENAME,
  DEFAULT_RENAME_ATTEMPTS,
  DEFAULT_RENAME_BASE_MS,
  findPartialTemps,
  tempPathFor,
  guardRegisterLoad,
  writeJsonAtomic
};
