/**
 * Assertion utilities for runtime invariant checking and parameter validation.
 * Adheres to RULE 2 (VALIDATE ALL INPUTS) and RULE 8 (ASSERTIONS FOR INVARIANTS)
 */

const { ValidationError, AppError } = require('./errors');

/**
 * Validates that an argument is a non-empty, non-null string.
 * @param {unknown} val - Value to check
 * @param {string} paramName - Name of the parameter
 * @param {string} [context=''] - Caller function/module name
 * @returns {string} - The trimmed string
 */
function assertNonEmptyString(val, paramName, context = '') {
  if (val === null || val === undefined) {
    throw new ValidationError(`Parameter '${paramName}' cannot be null or undefined`, {
      paramName,
      receivedType: typeof val,
      context
    });
  }
  if (typeof val !== 'string') {
    throw new ValidationError(`Parameter '${paramName}' must be a string, got ${typeof val}`, {
      paramName,
      receivedType: typeof val,
      context
    });
  }
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`Parameter '${paramName}' cannot be empty string`, {
      paramName,
      length: 0,
      context
    });
  }
  return trimmed;
}

/**
 * Validates that a numeric argument is within expected bounds.
 * @param {unknown} val - Value to check
 * @param {string} paramName - Name of the parameter
 * @param {number} min - Minimum acceptable value (inclusive)
 * @param {number} max - Maximum acceptable value (inclusive)
 * @param {string} [context=''] - Caller context
 * @returns {number} - The validated number
 */
function assertNumberInRange(val, paramName, min, max, context = '') {
  if (typeof val !== 'number' || Number.isNaN(val)) {
    throw new ValidationError(`Parameter '${paramName}' must be a valid number, got ${typeof val}`, {
      paramName,
      val,
      context
    });
  }
  if (val < min || val > max) {
    throw new ValidationError(`Parameter '${paramName}' must be between ${min} and ${max}, got ${val}`, {
      paramName,
      val,
      min,
      max,
      context
    });
  }
  return val;
}

/**
 * Validates that an array argument is provided and within size limits.
 * @param {unknown} val - Value to check
 * @param {string} paramName - Name of the parameter
 * @param {number} [maxSize=1000] - Upper bound on array size (RULE 6)
 * @param {string} [context=''] - Caller context
 * @returns {Array} - The validated array
 */
function assertArray(val, paramName, maxSize = 1000, context = '') {
  if (!Array.isArray(val)) {
    throw new ValidationError(`Parameter '${paramName}' must be an array, got ${typeof val}`, {
      paramName,
      receivedType: typeof val,
      context
    });
  }
  if (val.length > maxSize) {
    throw new ValidationError(`Array '${paramName}' exceeded max bound of ${maxSize} items (got ${val.length})`, {
      paramName,
      length: val.length,
      maxSize,
      context
    });
  }
  return val;
}

/**
 * Soft assertion for internal invariants. Never throws in a way that swallows details.
 * @param {boolean} condition - Invariant condition
 * @param {string} message - Invariant description
 * @param {Record<string, unknown>} [context={}] - Context details
 */
function assertInvariant(condition, message, context = {}) {
  if (!condition) {
    throw new AppError(`Invariant violation: ${message}`, 'INVARIANT_VIOLATION', context);
  }
}

module.exports = {
  assertNonEmptyString,
  assertNumberInRange,
  assertArray,
  assertInvariant
};
