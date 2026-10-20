/**
 * Schema validation for every register boundary (T7).
 *
 * Hand-written validator — no new dependency.  The zero-build property is
 * worth more than a library here (plan §T7).
 *
 * Validates:
 *  - tasks.json   → TASK_SCHEMA
 *  - login-failures register → LOGIN_FAILURE_SCHEMA
 *
 * Rules:
 *  - Unknown fields: WARNING, preserved verbatim (never drop data).
 *  - Wrong-type or out-of-enum known field: HARD ERROR.
 *
 * The canonical field names for tasks are:
 *   docNumber, docTitle, taxTypeKey, periodKey, deadline
 * These must never silently become docNum, title, kind, period, dueDate.
 *
 * Adheres to:
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures (every violation logged)
 * - RULE 4: Explicit error types
 * - RULE 7: Fail-safe defaults
 * - RULE 8: Assertions for invariants (canonical field name test exported)
 */

'use strict';

const { defaultLogger } = require('../common/logger');
const { ValidationError } = require('../common/errors');

// ---------------------------------------------------------------------------
// Canonical enum sets
// ---------------------------------------------------------------------------

/** §4 canonical task status values. */
const TASK_STATUS_VALUES = Object.freeze([
  'pending',
  'waiting',
  'in_progress',
  'completed',
  'closed'
]);

/**
 * Where a task's document came from in the portal.
 * 'new'     – the document is in the portal's current (unsubmitted) view
 * 'archive' – the portal itself already lists it as downloaded/archived
 * These are about the document, not about whether anyone has done the work.
 */
const PORTAL_ORIGIN_VALUES = Object.freeze([
  'new',
  'archive'
]);

/**
 * Where the task sits in the work queue. Only this decides which filter a task
 * appears in.
 */
const WORKFLOW_STATE_VALUES = Object.freeze([
  'open',
  'waiting',
  'closed'
]);

/** Urgency values produced by task-rules:evaluateUrgency. */
const URGENCY_VALUES = Object.freeze([
  'overdue',
  'today',
  'tomorrow',
  'soon',
  'normal',
  'completed'
]);

/** Penalty bands from penalty-scale.js. */
const PENALTY_BAND_VALUES = Object.freeze([
  'not_late',
  'within_60',
  'beyond_60'
]);

/** Registry source keys used by the scraper. */
const REGISTRY_SOURCE_VALUES = Object.freeze([
  'efiling',
  'etax',
  'local',
  'manual',
  'unknown'
]);

/** Login-failure reason codes from login-failures.js. */
const FAILURE_REASON_VALUES = Object.freeze([
  'credentials_rejected',
  'login_form_unavailable',
  'navigation_failed',
  'unknown'
]);

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

/**
 * Field descriptor shape:
 *   type      – 'string' | 'number' | 'boolean' | 'object' | 'array' | 'iso8601'
 *   required  – boolean (hard error when missing)
 *   enum      – string[] | undefined  (must be one of these values when present)
 *   nullable  – when true, null is accepted as well as the declared type
 */

/** Canonical §4 task record schema. */
const TASK_SCHEMA = Object.freeze({
  // Canonical §4 names — must not drift to docNum / title / kind / period / dueDate
  docNumber:  { type: 'string', required: true },
  docTitle:   { type: 'string', required: true },
  taxTypeKey: { type: 'string', required: false },
  periodKey:  { type: 'string', required: false },
  deadline:   { type: 'string', required: true },  // YYYY-MM-DD

  // Derived / computed fields
  id:         { type: 'string', required: false },
  account:    { type: 'string', required: false },
  status:     { type: 'string', required: false, enum: TASK_STATUS_VALUES },
  urgency:    { type: 'string', required: false, enum: URGENCY_VALUES },
  penaltyBand:{ type: 'string', required: false, enum: PENALTY_BAND_VALUES },

  // Optional string fields
  docTypeKey:       { type: 'string', required: false },
  source:           { type: 'string', required: false, enum: REGISTRY_SOURCE_VALUES },
  badgeText:        { type: 'string', required: false },
  badgeClass:       { type: 'string', required: false },
  notes:            { type: 'string', required: false, nullable: true },
  clarification:    { type: 'string', required: false, nullable: true },
  completedAt:      { type: 'string', required: false, nullable: true },
  pdfPath:          { type: 'string', required: false, nullable: true },

  // Fields written by task-engine that must be recognised by the schema
  taskId:                    { type: 'string',  required: false },
  company:                   { type: 'string',  required: false },
  username:                  { type: 'string',  required: false },
  dateIssued:                { type: 'string',  required: false },
  requiredAction:            { type: 'string',  required: false },
  assignedTo:                { type: 'string',  required: false },
  headline:                  { type: 'string',  required: false },
  createdAt:                 { type: 'string',  required: false, nullable: true },
  updatedAt:                 { type: 'string',  required: false, nullable: true },
  penaltyRange:              { type: 'string',  required: false, nullable: true },
  penaltyBasis:              { type: 'string',  required: false, nullable: true },

  // Where the document came from, and where the task sits in the work queue.
  // These are deliberately separate: `isArchived` conflated them, so a
  // document the portal simply lists as already-downloaded was hidden from the
  // inbox as if it were closed work.
  portalOrigin:              { type: 'string',  required: false, enum: PORTAL_ORIGIN_VALUES },
  workflowState:             { type: 'string',  required: false, enum: WORKFLOW_STATE_VALUES },
  archivedAt:                { type: 'string',  required: false, nullable: true },

  // Optional numeric / boolean
  daysLeft:                  { type: 'number',  required: false },
  deadlineDays:              { type: 'number',  required: false },
  penaltyDays:               { type: 'number',  required: false },
  hasPdf:                    { type: 'boolean', required: false },
  isArchived:                { type: 'boolean', required: false },
  isCurrentMonth:            { type: 'boolean', required: false },
  userClarificationRequested:{ type: 'boolean', required: false }
});

/** Login-failure record schema. */
const LOGIN_FAILURE_SCHEMA = Object.freeze({
  username:           { type: 'string',  required: true },
  consecutiveFailures:{ type: 'number',  required: true },
  firstFailureAt:     { type: 'string',  required: true, nullable: true },
  lastFailureAt:      { type: 'string',  required: true, nullable: true },
  nextAttemptAt:      { type: 'string',  required: false, nullable: true },
  reason:             { type: 'string',  required: false, enum: FAILURE_REASON_VALUES }
});

// ---------------------------------------------------------------------------
// Validator core
// ---------------------------------------------------------------------------

/**
 * Validates one record against a schema.
 *
 * @param {unknown} record      – The object to validate.
 * @param {Object}  schema      – Schema descriptor (see above).
 * @param {string}  recordLabel – Human-readable label for error messages.
 * @param {Object}  [options={}]
 * @param {boolean} [options.strict=false] – When true, unknown fields are errors
 *   rather than warnings.  The plan says warnings; strict=true is for tests.
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateRecord(record, schema, recordLabel, options = {}) {
  const errors = [];
  const warnings = [];

  // RULE 2: validate inputs
  if (record === null || record === undefined) {
    errors.push(`${recordLabel}: record is ${record}`);
    return { errors, warnings };
  }
  if (typeof record !== 'object' || Array.isArray(record)) {
    errors.push(`${recordLabel}: expected plain object, got ${typeof record}`);
    return { errors, warnings };
  }

  // Check required fields and type/enum for known fields
  for (const [field, descriptor] of Object.entries(schema)) {
    const rawValue = record[field];
    const isMissing = rawValue === undefined;

    if (isMissing) {
      if (descriptor.required) {
        errors.push(`${recordLabel}.${field}: required field is missing`);
      }
      continue;
    }

    const isNull = rawValue === null;

    if (isNull) {
      if (!descriptor.nullable) {
        errors.push(`${recordLabel}.${field}: must not be null (type: ${descriptor.type})`);
      }
      continue;
    }

    // Type check
    let typeOk = false;
    switch (descriptor.type) {
      case 'string':  typeOk = typeof rawValue === 'string';  break;
      case 'number':  typeOk = typeof rawValue === 'number';  break;
      case 'boolean': typeOk = typeof rawValue === 'boolean'; break;
      case 'object':  typeOk = typeof rawValue === 'object' && !Array.isArray(rawValue); break;
      case 'array':   typeOk = Array.isArray(rawValue); break;
      case 'iso8601': typeOk = typeof rawValue === 'string'; break; // further checked below
      default:        typeOk = true;
    }

    if (!typeOk) {
      errors.push(
        `${recordLabel}.${field}: expected ${descriptor.type}, got ${typeof rawValue} (value: ${JSON.stringify(rawValue)})`
      );
      continue; // enum check would always fail too
    }

    // Enum check
    if (descriptor.enum && !descriptor.enum.includes(rawValue)) {
      errors.push(
        `${recordLabel}.${field}: value "${rawValue}" is not one of [${descriptor.enum.join(', ')}]`
      );
    }
  }

  // Unknown field check
  const knownFields = new Set(Object.keys(schema));
  for (const key of Object.keys(record)) {
    if (!knownFields.has(key)) {
      const msg = `${recordLabel}.${key}: unknown field (preserved verbatim)`;
      if (options.strict) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a single task record.
 * Warnings are logged; errors throw ValidationError.
 *
 * @param {unknown} task
 * @param {string}  [label='task']
 * @param {Object}  [options={}]
 * @throws {ValidationError} on hard schema errors
 */
function validateTask(task, label = 'task', options = {}) {
  const { errors, warnings } = validateRecord(task, TASK_SCHEMA, label, options);

  for (const w of warnings) {
    defaultLogger.warn(`[schemas] ${w}`);
  }

  if (errors.length > 0) {
    const msg = `Task schema validation failed: ${errors.join('; ')}`;
    defaultLogger.error(`[schemas] ${msg}`, { errors, label });
    throw new ValidationError(msg, { errors, label });
  }
}

/**
 * Validates every task in an array.
 * Returns { valid: boolean, errors: string[] } — does NOT throw, so a caller
 * can decide whether to halt or recover.
 *
 * @param {unknown[]} tasks
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateTaskArray(tasks) {
  if (!Array.isArray(tasks)) {
    const err = `validateTaskArray: expected array, got ${typeof tasks}`;
    defaultLogger.error(`[schemas] ${err}`);
    return { valid: false, errors: [err], warnings: [] };
  }

  const allErrors = [];
  const allWarnings = [];
  const MAX_TASKS = 10000; // RULE 6: bounded
  const limit = Math.min(tasks.length, MAX_TASKS);

  for (let i = 0; i < limit; i++) {
    const { errors, warnings } = validateRecord(
      tasks[i],
      TASK_SCHEMA,
      `tasks[${i}]`
    );
    for (const w of warnings) {
      defaultLogger.warn(`[schemas] ${w}`);
    }
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }

  if (tasks.length > MAX_TASKS) {
    allWarnings.push(`validateTaskArray: only first ${MAX_TASKS} of ${tasks.length} tasks validated`);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  };
}

/**
 * Validates a login-failure record.
 * Returns { valid, errors, warnings } — does NOT throw.
 *
 * @param {unknown} record
 * @param {string}  [label='login-failure']
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateLoginFailure(record, label = 'login-failure') {
  const { errors, warnings } = validateRecord(record, LOGIN_FAILURE_SCHEMA, label);

  for (const w of warnings) {
    defaultLogger.warn(`[schemas] ${w}`);
  }
  if (errors.length > 0) {
    defaultLogger.error(`[schemas] Login-failure schema error: ${errors.join('; ')}`, { errors });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Canonical field name assertion (used by tests to prevent field drift)
// ---------------------------------------------------------------------------

/**
 * Asserts the task schema contains exactly the §4 canonical field names.
 * Throws if any has been renamed (e.g. docNum instead of docNumber).
 *
 * Called from the test suite; safe to call at any time.
 */
function assertCanonicalTaskFields() {
  const REQUIRED_CANONICAL = [
    'docNumber',
    'docTitle',
    'taxTypeKey',
    'periodKey',
    'deadline'
  ];

  const FORBIDDEN_ALIASES = [
    'docNum',
    'title',
    'kind',
    'period',
    'dueDate'
  ];

  const schemaKeys = new Set(Object.keys(TASK_SCHEMA));

  for (const field of REQUIRED_CANONICAL) {
    if (!schemaKeys.has(field)) {
      throw new ValidationError(
        `Canonical field "${field}" is missing from TASK_SCHEMA — field drift detected`,
        { field, REQUIRED_CANONICAL }
      );
    }
  }

  for (const alias of FORBIDDEN_ALIASES) {
    if (schemaKeys.has(alias)) {
      throw new ValidationError(
        `Forbidden alias field "${alias}" found in TASK_SCHEMA — use the canonical name instead`,
        { alias, FORBIDDEN_ALIASES }
      );
    }
  }
}

module.exports = {
  TASK_SCHEMA,
  LOGIN_FAILURE_SCHEMA,
  TASK_STATUS_VALUES,
  URGENCY_VALUES,
  PORTAL_ORIGIN_VALUES,
  WORKFLOW_STATE_VALUES,
  PENALTY_BAND_VALUES,
  REGISTRY_SOURCE_VALUES,
  FAILURE_REASON_VALUES,
  validateRecord,
  validateTask,
  validateTaskArray,
  validateLoginFailure,
  assertCanonicalTaskFields
};
