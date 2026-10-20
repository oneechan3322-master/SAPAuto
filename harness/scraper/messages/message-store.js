/**
 * Message Store.
 *
 * Persists official ETA portal messages and notifications to `data/messages.json`
 * with atomic writes.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 5: Resource acquisition/release (atomic file replace)
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 */

const fs = require('fs');
const path = require('path');
const { StorageError, ValidationError } = require('../common/errors');
const { assertNonEmptyString } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');
const { guardRegisterLoad, writeJsonAtomic } = require('../storage/atomic-json');

const MAX_MESSAGES_STORE = 1000;

class MessageStore {
  /**
   * @param {string} [customFilePath]
   */
  constructor(customFilePath) {
    this.filePath = customFilePath
      ? assertNonEmptyString(customFilePath, 'customFilePath', 'MessageStore.constructor')
      : path.resolve(process.cwd(), 'data', 'messages.json');

    const dataDir = path.dirname(this.filePath);
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        throw new StorageError(`Failed to create message store directory: ${dataDir}`, { dataDir }, err);
      }
    }

    this.messages = this._load();
  }

  /**
   * Loads messages safely from disk.
   * @returns {Record<string, Object>}
   */
  _load() {
    guardRegisterLoad(this.filePath);
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (err) {
      defaultLogger.warn(`Failed reading messages file: ${err.message}; starting with empty store.`);
      return {};
    }
  }

  /**
   * Saves messages atomically to disk.
   */
  save() {
    try {
      writeJsonAtomic(this.filePath, this.messages);
      defaultLogger.debug(`Saved ${Object.keys(this.messages).length} message(s) to ${this.filePath}`);
    } catch (err) {
      throw new StorageError(`Failed writing messages atomically to ${this.filePath}: ${err.message}`, { path: this.filePath }, err);
    }
  }

  /**
   * Upserts a message.
   * @param {Object} msg
   * @returns {Object}
   */
  upsertMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('Message must be an object', 'MessageStore.upsertMessage');
    }
    const id = assertNonEmptyString(msg.id, 'msg.id', 'MessageStore.upsertMessage');

    const keys = Object.keys(this.messages);
    if (keys.length >= MAX_MESSAGES_STORE && !this.messages[id]) {
      // Remove oldest message
      delete this.messages[keys[0]];
    }

    this.messages[id] = {
      ...msg,
      id,
      updatedAt: new Date().toISOString()
    };

    return this.messages[id];
  }

  /**
   * Ingests a batch of scraped messages.
   * @param {Array<Object>} batch
   * @returns {number}
   */
  ingestBatch(batch = []) {
    if (!Array.isArray(batch) || batch.length === 0) return 0;
    let count = 0;
    for (const msg of batch) {
      if (msg && msg.id) {
        this.upsertMessage(msg);
        count++;
      }
    }
    if (count > 0) {
      this.save();
    }
    return count;
  }

  /**
   * Returns all stored messages.
   * @returns {Array<Object>}
   */
  getAllMessages() {
    return Object.values(this.messages);
  }

  /**
   * Returns messages for a specific account.
   * @param {string} accountKey
   * @returns {Array<Object>}
   */
  getAccountMessages(accountKey) {
    const key = assertNonEmptyString(accountKey, 'accountKey', 'MessageStore.getAccountMessages');
    return this.getAllMessages().filter(m => m.accountKey === key);
  }
}

module.exports = {
  MessageStore,
  MAX_MESSAGES_STORE
};
