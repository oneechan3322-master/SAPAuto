/**
 * Sent documents history tracker and deduplicator.
 * Adheres to RULE 1, RULE 2, RULE 3, RULE 5 (RESOURCE CLEANUP), RULE 7 (FAIL-SAFE DEFAULTS)
 */

const fs = require('fs');
const path = require('path');
const { StorageError } = require('../common/errors');
const { assertNonEmptyString, assertInvariant } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');
const { guardRegisterLoad, writeJsonAtomic } = require('./atomic-json');

class SentTracker {
  /**
   * @param {string} [storageFilePath]
   */
  constructor(storageFilePath) {
    this.filePath = storageFilePath
      ? assertNonEmptyString(storageFilePath, 'storageFilePath', 'SentTracker.constructor')
      : path.resolve(process.cwd(), 'sent_history.json');
    this.data = this._load();
  }

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
        defaultLogger.warn(`Invalid content in ${this.filePath}, resetting to empty record.`);
        return {};
      }
      return parsed;
    } catch (err) {
      defaultLogger.error(`Failed to read sent history at ${this.filePath}`, { filePath: this.filePath }, err);
      // Fail-safe default: empty object
      return {};
    }
  }

  _persist() {
    try {
      writeJsonAtomic(this.filePath, this.data);
    } catch (writeErr) {
      if (writeErr instanceof StorageError) throw writeErr;
      throw new StorageError(`Failed to persist sent history to ${this.filePath}`, { filePath: this.filePath }, writeErr);
    }
  }

  /**
   * Generates month key (e.g., "2026-09")
   * @param {Date} [date=new Date()]
   * @returns {string}
   */
  static getMonthKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Checks if a document has already been sent for an account in a given month.
   * @param {string} accountKey - Unique identifier (username or id)
   * @param {string} monthKey - "YYYY-MM"
   * @param {string} docId - Unique document ID or identifier
   * @returns {boolean}
   */
  hasBeenSent(accountKey, monthKey, docId) {
    const acc = assertNonEmptyString(accountKey, 'accountKey', 'SentTracker.hasBeenSent');
    const month = assertNonEmptyString(monthKey, 'monthKey', 'SentTracker.hasBeenSent');
    const doc = assertNonEmptyString(docId, 'docId', 'SentTracker.hasBeenSent');

    if (!this.data[acc]) {
      return false;
    }
    if (!this.data[acc][month]) {
      return false;
    }
    return Boolean(this.data[acc][month][doc]);
  }

  /**
   * Returns the stored metadata for a document, or null when there is none.
   *
   * The PDF path a document was sent with is durable: it was downloaded once and
   * recorded here. A later run must be able to recover it, because the document
   * is skipped as "already sent" and would otherwise carry an empty path — the
   * file stays on disk while the task claims no PDF.
   *
   * @param {string} accountKey
   * @param {string} monthKey
   * @param {string} docId
   * @returns {{sentAt: string, metadata: Record<string, unknown>}|null}
   */
  getSentRecord(accountKey, monthKey, docId) {
    const acc = assertNonEmptyString(accountKey, 'accountKey', 'SentTracker.getSentRecord');
    const month = assertNonEmptyString(monthKey, 'monthKey', 'SentTracker.getSentRecord');
    const doc = assertNonEmptyString(docId, 'docId', 'SentTracker.getSentRecord');

    if (!this.data[acc] || !this.data[acc][month]) return null;
    const record = this.data[acc][month][doc];
    return record && typeof record === 'object' ? record : null;
  }

  /**
   * Marks a document as sent.
   * @param {string} accountKey
   * @param {string} monthKey
   * @param {string} docId
   * @param {Record<string, unknown>} [metadata={}]
   */
  markSent(accountKey, monthKey, docId, metadata = {}) {
    const acc = assertNonEmptyString(accountKey, 'accountKey', 'SentTracker.markSent');
    const month = assertNonEmptyString(monthKey, 'monthKey', 'SentTracker.markSent');
    const doc = assertNonEmptyString(docId, 'docId', 'SentTracker.markSent');

    if (!this.data[acc]) {
      this.data[acc] = {};
    }
    if (!this.data[acc][month]) {
      this.data[acc][month] = {};
    }

    this.data[acc][month][doc] = {
      sentAt: new Date().toISOString(),
      metadata: metadata || {}
    };

    this._persist();
  }
}

module.exports = {
  SentTracker
};
