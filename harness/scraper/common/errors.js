/**
 * SapAuto Error Definitions
 * Adheres to RULE 4 (EXPLICIT ERROR TYPES) and RULE 3 (NO SILENT FAILURES)
 */

class AppError extends Error {
  /**
   * @param {string} message - What operation failed and why
   * @param {string} code - Explicit error code string
   * @param {Record<string, unknown>} [context={}] - Contextual values causing failure
   * @param {Error|null} [cause=null] - Upstream error if any
   */
  constructor(message, code, context = {}, cause = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || 'APP_ERROR';
    this.timestamp = new Date().toISOString();
    this.context = (typeof context === 'object' && context !== null) ? context : { rawContext: context };
    if (cause instanceof Error) {
      this.cause = cause;
      this.stack = `${this.stack}\nCaused by: ${cause.stack || cause.message}`;
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      context: this.context,
      stack: this.stack
    };
  }
}

class ValidationError extends AppError {
  constructor(message, context = {}, cause = null) {
    super(message, 'VALIDATION_ERROR', context, cause);
  }
}

class ConfigError extends AppError {
  constructor(message, context = {}, cause = null) {
    super(message, 'CONFIG_ERROR', context, cause);
  }
}

class AuthError extends AppError {
  constructor(message, context = {}, cause = null) {
    super(message, 'AUTH_ERROR', context, cause);
  }
}

class AutomationError extends AppError {
  constructor(message, context = {}, cause = null) {
    super(message, 'AUTOMATION_ERROR', context, cause);
  }
}

class EmailError extends AppError {
  constructor(message, context = {}, cause = null) {
    super(message, 'EMAIL_ERROR', context, cause);
  }
}

class StorageError extends AppError {
  constructor(message, context = {}, cause = null) {
    super(message, 'STORAGE_ERROR', context, cause);
  }
}

module.exports = {
  AppError,
  ValidationError,
  ConfigError,
  AuthError,
  AutomationError,
  EmailError,
  StorageError
};
