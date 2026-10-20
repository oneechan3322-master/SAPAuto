/**
 * Persistent Storage for Office Secretary Tasks.
 * Manages atomic persistence of tasks to `data/tasks.json`.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 5: Resource acquisition/release (guaranteed atomic file replace)
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 8: Assertions for invariants
 * - RULE 10: Defensive redundancy
 */

const fs = require('fs');
const path = require('path');
const { StorageError, ValidationError } = require('../common/errors');
const { assertNonEmptyString, assertInvariant } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');
const { guardRegisterLoad, writeJsonAtomic } = require('../storage/atomic-json');
const { validateTaskArray } = require('../storage/schemas');
const { mergeCaseVariantKeys } = require('../common/canonical-keys');

const MAX_STORED_TASKS = 2000;

const WORKFLOW_STATE_VALUES = new Set(['open', 'waiting', 'closed']);

/**
 * Maps the legacy `status` onto the position in the work queue.
 *
 * Reads only; nothing is written back, so a register written before the
 * portalOrigin/workflowState split still reports where each task sits without
 * needing a migration.
 *
 * @param {unknown} status
 * @returns {'open'|'waiting'|'closed'}
 */
function deriveWorkflowState(status) {
  if (status === 'completed' || status === 'closed') return 'closed';
  if (status === 'pending' || status === 'waiting') return 'waiting';
  return 'open';
}

class TaskStore {
  /**
   * @param {string} [customFilePath]
   * @param {Object} [options]
   * @param {string} [options.downloadsDir] Directory real PDFs live in. Used to
   *   repair legacy paths that point at a parent directory that does not exist.
   */
  constructor(customFilePath, options = {}) {
    this.filePath = customFilePath
      ? assertNonEmptyString(customFilePath, 'customFilePath', 'TaskStore.constructor')
      : path.resolve(process.cwd(), 'data', 'tasks.json');

    const opts = (options && typeof options === 'object') ? options : {};
    this.downloadsDir = typeof opts.downloadsDir === 'string' && opts.downloadsDir.trim().length > 0
      ? path.resolve(opts.downloadsDir.trim())
      : path.resolve(process.cwd(), 'downloads');

    const dataDir = path.dirname(this.filePath);
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        throw new StorageError(`Failed to create task store directory: ${dataDir}`, { dataDir }, err);
      }
    }

    this.tasks = this._load();
  }

  /**
   * Repairs a stored PDF path that points somewhere that does not exist.
   *
   * Every path written by an earlier version pointed at `..\SapAuto\downloads\`
   * — the *parent* directory — which was never where the PDFs were saved. This
   * only rewrites a path when the file is actually found in the real downloads
   * directory; a path we cannot resolve is left untouched rather than replaced
   * with a guess, because a wrong path is worse than a known-dangling one.
   *
   * @param {unknown} storedPath
   * @returns {string} a usable path, or '' when there is nothing to point at
   */
  resolvePdfPath(storedPath) {
    if (typeof storedPath !== 'string' || storedPath.trim().length === 0) {
      return '';
    }

    const candidate = storedPath.trim();
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    // Only the filename is trusted from a broken path; the directory is ours.
    const filename = path.basename(candidate);
    if (!filename) {
      return candidate;
    }

    const rebuilt = path.join(this.downloadsDir, filename);
    if (fs.existsSync(rebuilt)) {
      defaultLogger.info(`Repaired dangling PDF path for "${filename}" to the real downloads directory.`);
      return rebuilt;
    }

    return candidate;
  }

  /**
   * Applies the derived-field invariants to one task record.
   *
   * `hasPdf` is *derived* from `pdfPath`, never stored independently. The two
   * used to be written from different sources — `pdfPath` was carried over from
   * the previous record while `hasPdf` came from the fresh scrape — which is how
   * 28 tasks ended up claiming `hasPdf: false` while holding a path.
   *
   * @param {Record<string, any>} task
   * @returns {Record<string, any>} the same task, normalised
   */
  _normalize(task) {
    const pdfPath = this.resolvePdfPath(task.pdfPath);
    return { ...task, pdfPath, hasPdf: Boolean(pdfPath) };
  }

  /**
   * Loads tasks from disk safely
   * @returns {Record<string, any>}
   */
  _load() {
    guardRegisterLoad(this.filePath);
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw || raw.trim().length === 0) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        defaultLogger.warn(`Invalid content in ${this.filePath}, resetting to empty tasks map.`);
        return {};
      }

      // Task ids embed the portal account's username, so two scrapes that
      // capitalised it differently wrote the same document under two ids
      // ("HashimSabry::DOC_1" and "hashimsabry::DOC_1"). Fold them together on
      // load. Only the account segment is folded — the document, date and title
      // segments are compared too, so two genuinely different documents never
      // collide.
      const { merged: deduped, collisions } = mergeCaseVariantKeys(parsed);
      if (collisions.length > 0) {
        defaultLogger.warn(
          `Task register contained ${collisions.length} task id(s) differing only by case; merged on load.`,
          { sample: collisions.slice(0, 5).map((c) => c.spellings) }
        );
      }

      // Normalise every record on read: repair dangling PDF paths and make
      // hasPdf agree with pdfPath. This is the forward-only migration for the
      // records written before those two facts were reconciled — the corrected
      // values are persisted by the next save().
      let repaired = 0;
      let disagreed = 0;
      const normalized = {};
      for (const [taskId, task] of Object.entries(deduped)) {
        if (!task || typeof task !== 'object') {
          continue;
        }
        const before = task.pdfPath;
        const after = this._normalize(task);
        if (before !== after.pdfPath) repaired += 1;
        if (Boolean(task.hasPdf) !== after.hasPdf) disagreed += 1;
        normalized[taskId] = after;
      }

      // Reconcile receipt-confirmation lifecycle: if an account has a receipt
      // confirmation for a document number, any preparation notice sharing that
      // document number was resolved and is marked closed.
      const confirmedDocNumbers = new Set();
      for (const task of Object.values(normalized)) {
        if (!task || typeof task !== 'object') continue;
        const titleNorm = String(task.docTitle || '').replace(/[أإآٱ]/g, 'ا');
        if (titleNorm.includes('استلام') && (titleNorm.includes('تاكيد') || titleNorm.includes('المستندات'))) {
          if (task.docNumber) confirmedDocNumbers.add(task.docNumber);
        }
      }

      let lifecycleResolved = 0;
      for (const task of Object.values(normalized)) {
        if (!task || typeof task !== 'object') continue;
        const titleNorm = String(task.docTitle || '').replace(/[أإآٱ]/g, 'ا');
        const isReceipt = titleNorm.includes('استلام') && (titleNorm.includes('تاكيد') || titleNorm.includes('المستندات'));
        const isPrep = titleNorm.includes('تجهيز');

        if (isReceipt && task.status !== 'completed' && task.status !== 'closed') {
          task.status = 'closed';
          task.urgency = 'completed';
          task.badgeText = 'تم الاستلام';
          task.badgeClass = 'badge-completed';
          task.penaltyBand = 'not_late';
          task.penaltyDays = 0;
          lifecycleResolved += 1;
        } else if (isPrep && confirmedDocNumbers.has(task.docNumber) && task.status !== 'completed' && task.status !== 'closed') {
          task.status = 'closed';
          task.urgency = 'completed';
          task.badgeText = 'تمت المعالجة';
          task.badgeClass = 'badge-completed';
          task.penaltyBand = 'not_late';
          task.penaltyDays = 0;
          lifecycleResolved += 1;
        }
      }

      if (lifecycleResolved > 0) {
        defaultLogger.info(
          `Task register lifecycle reconciled on load: ${lifecycleResolved} task(s) resolved via matching receipt confirmation doc numbers.`
        );
      }

      // T7: schema-validate the loaded register; warn but never halt on old data
      const tasks = Object.values(normalized);
      const validation = validateTaskArray(tasks);
      if (!validation.valid) {
        defaultLogger.warn(
          `Task register schema validation found ${validation.errors.length} error(s) on load — ` +
          `data is preserved, but investigation is recommended.`,
          { errors: validation.errors }
        );
      }

      return normalized;
    } catch (err) {
      defaultLogger.error(`Failed to read task store at ${this.filePath}`, { filePath: this.filePath }, err);
      // Fail-safe default
      return {};
    }
  }

  /**
   * Atomically persists tasks to disk
   */
  _persist() {
    // T7: validate before write — a hard error here prevents persisting corrupt data
    const tasks = Object.values(this.tasks);
    const validation = validateTaskArray(tasks);
    if (!validation.valid) {
      // Log but do NOT throw — we never want a validation quirk to prevent a save
      // that would otherwise succeed. The register must never be lost due to
      // stricter future schema versions.
      defaultLogger.warn(
        `Task register schema validation found ${validation.errors.length} error(s) before persist — ` +
        `data is written, but investigation is recommended.`,
        { errors: validation.errors }
      );
    }

    // Ensure isArchived is never persisted to disk (derived on read only)
    for (const key of Object.keys(this.tasks)) {
      if (this.tasks[key] && 'isArchived' in this.tasks[key]) {
        delete this.tasks[key].isArchived;
      }
    }

    try {
      writeJsonAtomic(this.filePath, this.tasks);
    } catch (writeErr) {
      if (writeErr instanceof StorageError) throw writeErr;
      throw new StorageError(`Failed to persist task store to ${this.filePath}`, { filePath: this.filePath }, writeErr);
    }
  }

  /**
   * Retrieves all tasks as an array.
   *
   * T9: When `activeUsernames` is supplied, tasks whose `account` field is
   * absent from the live account list receive a derived `isArchived: true`
   * flag.  The flag is NEVER persisted — it is derived on every read, exactly
   * the way `hasPdf` is derived from `pdfPath`.  This keeps the register
   * clean and the decision reversible.
   *
   * @param {Set<string>|string[]|null} [activeUsernames=null]
   *   When provided, tasks whose account is not in this set are marked archived.
   * @returns {Array<any>}
   */
  getAllTasks(activeUsernames = null) {
    const keys = Object.keys(this.tasks);
    const limit = Math.min(keys.length, MAX_STORED_TASKS);
    const result = [];

    // Build an efficient lookup; handle both Set and Array
    let usernameSet = null;
    if (activeUsernames !== null && activeUsernames !== undefined) {
      if (activeUsernames instanceof Set) {
        usernameSet = activeUsernames;
      } else if (Array.isArray(activeUsernames)) {
        usernameSet = new Set(activeUsernames);
      } else {
        defaultLogger.warn('TaskStore.getAllTasks: activeUsernames must be a Set or Array; archive derivation skipped');
      }
    }

    for (let i = 0; i < limit; i++) {
      const task = this.tasks[keys[i]];

      // `portalOrigin` says where the document came from; `workflowState` says
      // whether the work is done. The old single `isArchived` flag stood for
      // both, which is why an already-downloaded document was hidden from the
      // inbox as though it had been handled.
      const storedOrigin = task.portalOrigin === 'archive' ? 'archive' : 'new';
      const storedState = WORKFLOW_STATE_VALUES.has(task.workflowState)
        ? task.workflowState
        : deriveWorkflowState(task.status);

      let portalOrigin = storedOrigin;
      let isArchived = Boolean(task.isArchived);

      // Why is this document not in the current list? Two very different
      // reasons that used to share one number: the portal itself lists it as
      // already downloaded, or the account was removed from accounts.txt.
      // The second says nothing about the document, and conflating the two made
      // the archive figure look like "old paperwork" when it mostly meant
      // "companies you stopped tracking".
      let accountRetired = false;
      if (usernameSet !== null) {
        const user = (typeof task.username === 'string' && task.username.trim().length > 0)
          ? task.username.trim()
          : (typeof task.account === 'string' && task.account.trim().length > 0
            ? task.account.trim()
            : '');
        const accountMissing = user.length > 0 && !usernameSet.has(user);
        accountRetired = accountMissing;
        // A removed account is a property of the account, not of the document,
        // so it feeds portalOrigin rather than workflowState. The work still
        // needs doing and must stay in the queue.
        if (accountMissing) portalOrigin = 'archive';
        isArchived = accountMissing || task.isArchived === true;
      }

      result.push({
        ...task,
        portalOrigin,
        workflowState: storedState,
        accountRetired,
        isArchived
      });
    }
    return result;
  }

  /**
   * Retrieves a task by its unique ID
   * @param {string} taskId
   * @returns {any|null}
   */
  getTaskById(taskId) {
    const id = assertNonEmptyString(taskId, 'taskId', 'TaskStore.getTaskById');
    return this.tasks[id] || null;
  }

  /**
   * Upserts a task while preserving user modifications (status, notes, etc.)
   * @param {Object} taskData
   * @returns {any} The updated task
   */
  upsertTask(taskData) {
    if (!taskData || typeof taskData !== 'object') {
      throw new ValidationError('Task data must be an object', { taskData });
    }

    const requestedId = assertNonEmptyString(taskData.taskId, 'taskData.taskId', 'TaskStore.upsertTask');

    // A fresh scrape can spell the account differently from the stored record.
    // Write through the stored spelling so the update lands on the existing task
    // instead of creating a case-variant twin that would duplicate in the UI.
    let taskId = requestedId;
    if (!this.tasks[taskId]) {
      const folded = taskId.trim().toLowerCase();
      for (const stored of Object.keys(this.tasks)) {
        if (stored.trim().toLowerCase() === folded) {
          taskId = stored;
          break;
        }
      }
    }
    const existing = this.tasks[taskId];

    if (existing) {
      // Merge: keep user status and notes if existing, but honor authoritative closed status
      const status = taskData.status === 'closed'
        ? 'closed'
        : (existing.status || taskData.status || 'pending');
      const updated = {
        ...taskData,
        status,
        assignedTo: existing.assignedTo || taskData.assignedTo || 'مدير المكتب',
        notes: existing.notes || taskData.notes || '',
        completedAt: status === 'closed' || status === 'completed'
          ? (existing.completedAt || new Date().toISOString())
          : (existing.completedAt || null),
        userClarificationRequested: existing.userClarificationRequested || false,
        updatedAt: new Date().toISOString()
      };
      delete updated.isArchived;

      // Preserve a previously obtained PDF if this scrape produced none. The
      // fact that the document was downloaded is durable, so the path carries
      // forward; hasPdf is then re-derived from it rather than trusted from the
      // incoming scrape.
      if (!updated.pdfPath && existing.pdfPath) {
        updated.pdfPath = existing.pdfPath;
      }

      const normalized = this._normalize(updated);
      this.tasks[taskId] = normalized;
      return normalized;
    }

    // New task insertion
    const count = Object.keys(this.tasks).length;
    if (count >= MAX_STORED_TASKS) {
      defaultLogger.warn(`TaskStore reached max capacity of ${MAX_STORED_TASKS}. Skipping task ${taskId}`);
      return taskData;
    }

    const newTask = this._normalize({
      ...taskData,
      status: taskData.status || 'pending',
      assignedTo: taskData.assignedTo || 'مدير المكتب',
      notes: taskData.notes || '',
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    delete newTask.isArchived;

    this.tasks[taskId] = newTask;
    return newTask;
  }

  /**
   * Explicitly applies a dashboard override (status / notes / clarification).
   *
   * `upsertTask` intentionally keeps the existing status so a fresh scrape can
   * never undo a human decision. An override from the dashboard is the opposite
   * intent, so it needs its own explicit path.
   *
   * @param {string} taskId
   * @param {Object} overrides
   * @param {string} [overrides.status]
   * @param {string} [overrides.notes]
   * @param {boolean} [overrides.userClarificationRequested]
   * @returns {Object} The updated task
   */
  applyOverride(taskId, overrides = {}) {
    const id = assertNonEmptyString(taskId, 'taskId', 'TaskStore.applyOverride');
    const task = this.tasks[id];

    if (!task) {
      throw new ValidationError(`Unknown task "${id}"`, { taskId: id });
    }
    if (!overrides || typeof overrides !== 'object') {
      throw new ValidationError('overrides must be an object', { taskId: id });
    }

    const allowedStatuses = ['pending', 'waiting', 'in_progress', 'completed', 'closed'];

    if (overrides.status !== undefined) {
      if (typeof overrides.status !== 'string' || !allowedStatuses.includes(overrides.status)) {
        throw new ValidationError(`override.status must be one of: ${allowedStatuses.join(', ')}`, {
          received: overrides.status,
          allowed: allowedStatuses
        });
      }
      task.status = overrides.status;
      task.completedAt = (overrides.status === 'completed') ? (task.completedAt || new Date().toISOString()) : null;
    }

    if (overrides.notes !== undefined) {
      if (typeof overrides.notes !== 'string') {
        throw new ValidationError('override.notes must be a string', { taskId: id });
      }
      task.notes = overrides.notes.slice(0, 2000);
    }

    if (overrides.userClarificationRequested !== undefined) {
      if (typeof overrides.userClarificationRequested !== 'boolean') {
        throw new ValidationError('override.userClarificationRequested must be a boolean', { taskId: id });
      }
      task.userClarificationRequested = overrides.userClarificationRequested;
    }

    task.updatedAt = new Date().toISOString();
    this.save();

    return task;
  }

  /**
   * Saves and persists bulk updates
   */
  save() {
    this._persist();
  }

  /**
   * Marks a task as completed/processed
   * @param {string} taskId
   * @param {string} [notes]
   * @returns {boolean}
   */
  markCompleted(taskId, notes = '') {
    const id = assertNonEmptyString(taskId, 'taskId', 'TaskStore.markCompleted');
    if (!this.tasks[id]) {
      return false;
    }

    this.tasks[id].status = 'completed';
    this.tasks[id].completedAt = new Date().toISOString();
    if (notes) {
      this.tasks[id].notes = notes;
    }
    this.tasks[id].updatedAt = new Date().toISOString();
    this.save();
    return true;
  }
}

module.exports = {
  TaskStore,
  MAX_STORED_TASKS
};
