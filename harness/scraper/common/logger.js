/**
 * Structured logger for SapAuto.
 * Adheres to RULE 3 (NO SILENT FAILURES) and RULE 4 (EXPLICIT ERROR TYPES)
 */

const { assertNonEmptyString } = require('./assertions');

const LogLevel = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

class Logger {
  constructor(options = {}) {
    this.minLevel = LogLevel.INFO;
    this.subscribers = new Set();
  }

  /**
   * Subscribe a listener function to receive log entries.
   * @param {(entry: {timestamp: string, level: string, message: string, context?: any}) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Logger subscriber must be a function');
    }
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  _format(levelName, message, context) {
    const timestamp = new Date().toISOString();
    return {
      timestamp,
      level: levelName,
      message,
      context: context || {}
    };
  }

  _dispatch(entry) {
    const contextStr = (entry.context && Object.keys(entry.context).length > 0)
      ? ` | ${JSON.stringify(entry.context)}`
      : '';
    const formattedLine = `[${entry.timestamp}] [${entry.level}] ${entry.message}${contextStr}`;

    if (entry.level === 'ERROR') {
      console.error(formattedLine);
    } else if (entry.level === 'WARN') {
      console.warn(formattedLine);
    } else {
      console.log(formattedLine);
    }

    for (const sub of this.subscribers) {
      try {
        sub(entry);
      } catch (err) {
        console.error(`Logger subscriber failed: ${err.message}`);
      }
    }
  }

  debug(message, context = {}) {
    if (LogLevel.DEBUG >= this.minLevel) {
      const entry = this._format('DEBUG', assertNonEmptyString(message, 'message', 'logger.debug'), context);
      this._dispatch(entry);
    }
  }

  info(message, context = {}) {
    if (LogLevel.INFO >= this.minLevel) {
      const entry = this._format('INFO', assertNonEmptyString(message, 'message', 'logger.info'), context);
      this._dispatch(entry);
    }
  }

  warn(message, context = {}) {
    if (LogLevel.WARN >= this.minLevel) {
      const entry = this._format('WARN', assertNonEmptyString(message, 'message', 'logger.warn'), context);
      this._dispatch(entry);
    }
  }

  error(message, context = {}, errorObj = null) {
    const ctx = Object.assign({}, context);
    if (errorObj instanceof Error) {
      ctx.errorName = errorObj.name;
      ctx.errorMessage = errorObj.message;
      ctx.stack = errorObj.stack;
    }
    const entry = this._format('ERROR', assertNonEmptyString(message, 'message', 'logger.error'), ctx);
    this._dispatch(entry);
  }
}

const defaultLogger = new Logger();

module.exports = {
  Logger,
  defaultLogger,
  LogLevel
};
