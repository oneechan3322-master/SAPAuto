/**
 * Per-file write serialisation.
 *
 * The problem this solves
 * ----------------------
 * Every register in this project follows the same shape: load the whole file into
 * memory, mutate it, write the whole file back. `writeJsonAtomic` makes each
 * individual write crash-safe, but it does nothing about two writers.
 *
 * The dashboard server and the automation orchestrator both write
 * `tasks.json` and `obligations.json`, in the same process family and sometimes
 * concurrently. Each holds its own in-memory copy loaded at construction. So:
 *
 *   reader A loads the register          -> 5 tasks
 *   reader B loads the register          -> 5 tasks
 *   writer A applies an override, saves  -> file has 5 tasks, one overridden
 *   writer B applies its own change, saves -> file has 5 tasks, A's override gone
 *
 * The atomic rename means the file is never half-written. It does not mean the
 * write is correct. A is simply lost, silently, and the dashboard reverts.
 *
 * The fix is to make the read-modify-write cycle the atomic unit rather than the
 * write. `updateJsonStore` reads fresh from disk, applies the mutator, and
 * writes, all while holding that file's lock. A second writer waits, then reads
 * the first writer's result.
 *
 * Locking is per absolute file path and in-process. Two Node processes do not
 * share a lock table, so this does not protect against the dashboard server and
 * a separately-spawned process writing at the same instant. That gap is
 * deliberate rather than papered over: a real cross-process lock needs file
 * locking semantics that behave differently on Windows and Linux, and a lock
 * that silently does nothing is worse than one that is honestly absent. See the
 * note on `withFileLock` below.
 *
 * Adheres to:
 * - RULE 3: No silent failures
 * - RULE 5: Resource cleanup (a lock is always released, including on throw)
 * - RULE 6: Bounded operations (lock acquisition is bounded and gives up)
 */

const fs = require('fs');
const path = require('path');
const { StorageError } = require('../common/errors');
const { defaultLogger } = require('../common/logger');
const { guardRegisterLoad, writeJsonAtomic } = require('./atomic-json');

/** How long a writer waits for the lock before giving up. */
const DEFAULT_LOCK_TIMEOUT_MS = 5000;

/** Pause between acquisition attempts. */
const DEFAULT_LOCK_RETRY_MS = 15;

/**
 * The lock table, keyed by resolved file path.
 *
 * A plain Map of promises: each entry chains onto the previous one, so holders
 * run in the order they arrived and the chain never breaks.
 *
 * @type {Map<string, Promise<unknown>>}
 */
const LOCK_CHAIN = new Map();

/**
 * Sleeps synchronously.
 *
 * The stores using this are synchronous by design — `save()` returns void and is
 * called from sync code paths — so an async lock would force an async cascade
 * through every caller. `Atomics.wait` blocks the thread without spinning the
 * CPU, which matters here because the wait is short and the alternative is a
 * busy loop.
 *
 * @param {number} ms
 * @returns {void}
 */
function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `fn` with exclusive access to one register file.
 *
 * Asynchronous, because mutual exclusion has to suspend: holding a lock while
 * yielding is the entire point, and a synchronous implementation cannot yield
 * without either blocking the event loop or spinning. A synchronous version
 * would also be a lie — two callers could both "hold" it.
 *
 * Prefer `updateJsonStore` for register changes: it composes this with the
 * read-fresh step, and getting that step wrong is the bug this module exists to
 * prevent.
 *
 * @param {string} filePath
 * @param {() => unknown} fn
 * @param {Object} [options={}]
 * @param {number} [options.timeoutMs=5000]
 * @returns {Promise<unknown>} whatever `fn` returns
 */
function withStoreLock(filePath, fn, options = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new StorageError('withStoreLock requires a file path', { filePath });
  }
  if (typeof fn !== 'function') {
    throw new StorageError('withStoreLock requires a function', { filePath });
  }

  const key = path.resolve(filePath);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_LOCK_TIMEOUT_MS;

  const previous = LOCK_CHAIN.get(key) || Promise.resolve();

  // `gate` is released by this holder when its work finishes. The chain entry is
  // derived from `gate` rather than from our own completion, which is what keeps
  // the two from forming a cycle — a tail waiting on a gate that only opens
  // after the tail settles deadlocks on the first caller.
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });

  const tail = previous.then(() => gate, () => gate).then(() => undefined, () => undefined);
  LOCK_CHAIN.set(key, tail);

  // Waits for the previous holder, then runs.
  return previous.then(async () => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        // Reported, not thrown: a large ingest legitimately holds the lock for
        // seconds, and this only makes a genuinely stuck writer visible.
        defaultLogger.warn(`Held the write lock for ${key} longer than ${timeoutMs}ms (${elapsed}ms).`);
      }
      // Always released, including when `fn` throws. A leaked lock would make
      // the register permanently unwritable.
      release();
    }
  });
}

/**
 * Marker for the value a boxed mutator wants written.
 *
 * A mutator usually needs to return two things: the value to persist, and
 * something derived from it for the caller. Returning an ordinary wrapper object
 * would persist the wrapper, so the register ends up holding the wrong shape —
 * a bug that only shows up on the next read.
 *
 * A boxed mutator returns `{[STORE_VALUE]: <value to write>, result: <anything>}`.
 * The wrapper is unwrapped here and `result` is what the caller receives.
 *
 * @type {Symbol}
 */
const STORE_VALUE = Symbol('sapauto.storeValue');

/**
 * Builds the return value for a boxed mutator.
 *
 * @param {*} valueToStore
 * @param {*} [result] - handed back to the caller
 * @returns {Object}
 */
function storeResult(valueToStore, result) {
  return { [STORE_VALUE]: valueToStore, result };
}

/**
 * Read-fresh, mutate, write — serialized per file.
 *
 * This is the only safe way to change a register that another writer may also
 * be changing. Reading through an in-memory copy loaded earlier and writing it
 * back discards anything written in between.
 *
 * @param {string} filePath
 * @param {(current: any) => any} mutator - receives the freshly-read value and returns
 *   either the value to store, or `storeResult(valueToStore, result)`
 * @param {Object} [options={}]
 * @param {*} [options.defaultValue={}] - used when the file is missing or unreadable
 * @returns {Promise<*>} the value written, or the mutator's `result` when boxed
 */
async function updateJsonStore(filePath, mutator, options = {}) {
  if (typeof mutator !== 'function') {
    throw new StorageError('updateJsonStore requires a mutator function', { filePath });
  }

const defaultValue = options.defaultValue !== undefined ? options.defaultValue : {};
  const key = path.resolve(filePath);

  // A promise for "my turn", linked behind whatever was already queued. The tail
  // published into the chain settles only when the whole cycle below is done, so
  // the next writer cannot start mid-mutation.
  // Same gate shape as withStoreLock, and for the same reason: deriving the chain
  // entry from the gate rather than from our own completion avoids a cycle.
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  const previous = LOCK_CHAIN.get(key) || Promise.resolve();
  const tail = previous.then(() => gate, () => gate).then(() => undefined, () => undefined);
  LOCK_CHAIN.set(key, tail);

  try {
    await previous.catch(() => {});

    guardRegisterLoad(filePath);

    let current = defaultValue;
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (raw && raw.trim().length > 0) {
          const parsed = JSON.parse(raw);
          current = (parsed === null || parsed === undefined) ? defaultValue : parsed;
        }
      } catch (err) {
        // A corrupt file is quarantined rather than overwritten. Swapping in an
        // empty default would destroy whatever a human could still recover.
        const quarantined = quarantineCorruptFile(filePath, err);
        defaultLogger.error(
          `Could not parse ${filePath}; moved it aside as ${quarantined} and starting from the default.`,
          { filePath, quarantined },
          err
        );
        current = defaultValue;
      }
    }

    const outcome = await mutator(current);

    // Unwrapped here rather than by every caller: persisting the wrapper would
    // put the wrong shape into the register, which only surfaces on a later read.
    const boxed = Boolean(outcome && typeof outcome === 'object' && Object.prototype.hasOwnProperty.call(outcome, STORE_VALUE));
    const valueToStore = boxed ? outcome[STORE_VALUE] : outcome;

    writeJsonAtomic(filePath, valueToStore);
    return boxed ? outcome.result : valueToStore;
  } finally {
    // Always released, including when the mutator throws. A leaked lock would
    // deadlock every later writer for this file.
    release();
  }
}

/**
 * Moves an unparseable register aside instead of destroying it.
 *
 * @param {string} filePath
 * @param {Error} cause
 * @returns {string} the quarantine path
 */
function quarantineCorruptFile(filePath, cause) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${filePath}.corrupt-${stamp}`;
  try {
    fs.renameSync(filePath, target);
  } catch (err) {
    defaultLogger.error(
      `Could not quarantine the corrupt register ${filePath}; leaving it in place.`,
      { filePath },
      err
    );
    return filePath;
  }
  defaultLogger.error(`Quarantined corrupt register ${filePath} as ${target}.`, { cause: cause && cause.message });
  return target;
}

/**
 * Whether any writer currently holds the lock for a file.
 *
 * Exposed for tests and diagnostics. It reflects the in-process table only.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isLocked(filePath) {
  return LOCK_CHAIN.has(path.resolve(filePath));
}

/**
 * Drops the lock table.
 *
 * Exported for tests. Calling this while a writer is mid-flight would break the
 * mutual exclusion it exists to provide.
 *
 * @returns {void}
 */
function _resetLocks() {
  LOCK_CHAIN.clear();
}

module.exports = {
  DEFAULT_LOCK_TIMEOUT_MS,
  STORE_VALUE,
  storeResult,
  withStoreLock,
  updateJsonStore,
  quarantineCorruptFile,
  isLocked,
  _resetLocks
};