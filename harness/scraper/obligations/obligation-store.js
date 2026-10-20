/**
 * Obligation Store.
 *
 * Persists the office's tax obligations to `data/obligations.json` with atomic
 * writes, mirroring the conventions of the task store.
 *
 * Status and days-left are never trusted from disk: they are recomputed from the
 * stored deadline and submission flag on every read, so the register can never
 * show a stale "متأخر" badge.
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
const { assertNonEmptyString, assertArray } = require('../common/assertions');
const { evaluatePenaltyBandForObligation } = require('../common/penalty-scale');
const { defaultLogger } = require('../common/logger');
const { guardRegisterLoad, writeJsonAtomic } = require('../storage/atomic-json');
const { updateJsonStore, storeResult } = require('../storage/store-lock');
const {
  TAX_TYPES,
  OBLIGATION_STATUSES,
  OBLIGATION_KINDS,
  CERTIFICATE_STATUS_VALUES,
  classifyObligationKind,
  evaluateObligationStatus,
  summarizeObligations,
  buildStatutoryObligations,
  parsePortalObligationRow
} = require('./obligation-rules');

const MAX_OBLIGATIONS = 4000;

/**
 * The obligation register backed by a JSON file.
 */
class ObligationStore {
  /**
   * @param {string} [customFilePath]
   */
  constructor(customFilePath) {
    this.filePath = customFilePath
      ? assertNonEmptyString(customFilePath, 'customFilePath', 'ObligationStore.constructor')
      : path.resolve(process.cwd(), 'data', 'obligations.json');

    const dataDir = path.dirname(this.filePath);
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        throw new StorageError(`Failed to create obligation store directory: ${dataDir}`, { dataDir }, err);
      }
    }

    this.obligations = this._load();
  }

  /**
   * Loads obligations from disk safely.
   * @returns {Record<string, Object>}
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
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        defaultLogger.warn(`Invalid content in ${this.filePath}, resetting to an empty obligation register.`);
        return {};
      }
      return parsed;
    } catch (err) {
      defaultLogger.error(`Failed to read the obligation store at ${this.filePath}`, { filePath: this.filePath }, err);
      return {};
    }
  }

  /**
   * Atomically persists the register (RULE 5).
   */
  _persist() {
    try {
      writeJsonAtomic(this.filePath, this.obligations);
    } catch (writeErr) {
      if (writeErr instanceof StorageError) throw writeErr;
      throw new StorageError(`Failed to persist the obligation store to ${this.filePath}`, {
        filePath: this.filePath
      }, writeErr);
    }
  }

  /**
   * Recomputes the live status of a stored record.
   * @param {Object} record
   * @param {Date} asOf
   * @returns {Object}
   */
  _hydrate(record, asOf) {
    const taxType = TAX_TYPES[record.taxTypeKey] || {};

    // Records written before the filing/certificate split carry no `kind`, and
    // their stored status is in the old filing vocabulary — so it cannot be
    // used to tell them apart. The label is the actual evidence, so an unmarked
    // record is reclassified from its text. That is what moves an existing
    // "البطاقة الضريبية" out of the overdue column without a data migration.
    let resolvedKind;
    if (record.kind === 'certificate' || record.kind === 'filing') {
      resolvedKind = record.kind;
    } else if (CERTIFICATE_STATUS_VALUES.has(record.status)) {
      resolvedKind = 'certificate';
    } else {
      resolvedKind = classifyObligationKind(
        `${record.formLabel || ''} ${record.taxLabel || ''} ${record.requiredAction || ''}`
      );
    }
    const isCertificate = resolvedKind === 'certificate';

    const submitted = !isCertificate && record.submitted === true;

    // A row flagged as missing from the portal's complete view stays pending,
    // because absence is not proof of submission. Reporting it as submitted
    // would invent a fact; reporting it as overdue would warn about a filing the
    // office may already have made.
    const unresolved = record.reconciliation === 'resolved_unconfirmed' && !submitted;

    const evaluated = unresolved
      ? { status: 'resolved_unconfirmed', daysLeft: null }
      : evaluateObligationStatus(record.deadline, submitted, asOf, resolvedKind);
    // Statutory cost band, recomputed with everything else and never trusted
    // from disk: a submitted return cannot be penalised however late it was,
    // and an expired tax card is not a late return at all.
    const penalty = (isCertificate || unresolved)
      ? evaluatePenaltyBandForObligation(null, { submitted: true, status: 'submitted' })
      : evaluatePenaltyBandForObligation(evaluated.daysLeft, {
        submitted,
        status: evaluated.status
      });

    return Object.assign({}, record, {
      taxLabel: record.taxLabel || taxType.label || record.taxTypeKey,
      formLabel: record.formLabel || taxType.formLabel || '',
      requiredAction: record.requiredAction || taxType.action || '',
      kind: resolvedKind,
      submitted,
      status: evaluated.status,
      daysLeft: evaluated.daysLeft,
      penaltyBand: penalty.band,
      penaltyDays: penalty.daysOverdue,
      penaltyRange: penalty.statutoryRange,
      penaltyBasis: penalty.basis
    });
  }

/**
   * All obligations, status freshly computed. Bounded (RULE 6).
   * @param {Object} [options={}]
   * @param {Date} [options.asOf=new Date()]
   * @returns {Array<Object>}
   */
  getAllObligations(options = {}) {
    const asOf = options.asOf instanceof Date ? options.asOf : new Date();
    const keys = Object.keys(this.obligations);
    const limit = Math.min(keys.length, MAX_OBLIGATIONS);
    const result = [];

    for (let i = 0; i < limit; i++) {
      result.push(this._hydrate(this.obligations[keys[i]], asOf));
    }

    return result;
  }

  /**
   * Obligations for one company, matched by key or display name.
   * @param {string} companyKeyOrName
   * @param {Object} [options={}]
   * @returns {Array<Object>}
   */
  getCompanyObligations(companyKeyOrName, options = {}) {
    const key = assertNonEmptyString(companyKeyOrName, 'companyKeyOrName', 'ObligationStore.getCompanyObligations');
    return this.getAllObligations(options).filter(
      (item) => item.companyKey === key || item.company === key
    );
  }

  /**
   * Inserts or replaces an obligation, preserving the existing submission flag.
   * @param {Object} obligation
   * @returns {Object} The stored record
   */
  upsertObligation(obligation) {
    if (!obligation || typeof obligation !== 'object') {
      throw new ValidationError('Obligation data must be an object', { obligation });
    }

    const id = assertNonEmptyString(obligation.id, 'obligation.id', 'ObligationStore.upsertObligation');
    const existing = this.obligations[id];
    const now = new Date();

    if (!existing && Object.keys(this.obligations).length >= MAX_OBLIGATIONS) {
      defaultLogger.warn(`Obligation store reached its ${MAX_OBLIGATIONS} bound. Skipping ${id}.`);
      return this._hydrate(obligation, now);
    }

    // A reseed from the scraper must never wipe a real submission.
    const preservedSubmitted = existing ? (existing.submitted === true) : false;
    const preservedSubmittedAt = existing && existing.submittedAt ? existing.submittedAt : null;

    this.obligations[id] = Object.assign({}, existing, obligation, {
      id,
      submitted: obligation.submitted === true ? true : preservedSubmitted,
      submittedAt: obligation.submitted === true
        ? (obligation.submittedAt || new Date().toISOString())
        : preservedSubmittedAt,
      // Seeing the row again is evidence it was never missing — a portal glitch
      // or a filter that briefly dropped it. The flag is cleared here rather
      // than waiting for the next reconcile, so the row reports its real status
      // immediately.
      reconciliation: null,
      reconciledAt: null,
      updatedAt: now.toISOString()
    });

    return this._hydrate(this.obligations[id], now);
  }

  /**
   * Marks an obligation as submitted or not submitted.
   * @param {string} obligationId
   * @param {boolean} submitted
   * @returns {{record: Object, changed: boolean}}
   */
  setSubmitted(obligationId, submitted) {
    const id = assertNonEmptyString(obligationId, 'obligationId', 'ObligationStore.setSubmitted');

    if (typeof submitted !== 'boolean') {
      throw new ValidationError('submitted must be a boolean', { submitted });
    }

    const existing = this.obligations[id];
    if (!existing) {
      throw new ValidationError(`Unknown obligation "${id}"`, { obligationId: id });
    }

    const changed = existing.submitted !== submitted;
    existing.submitted = submitted;
    existing.submittedAt = submitted ? new Date().toISOString() : null;
    existing.updatedAt = new Date().toISOString();

    this.save();

    return { record: this._hydrate(existing, new Date()), changed };
  }

  /**
   * Flips the submission flag of an obligation.
   * @param {string} obligationId
   * @returns {{record: Object, changed: boolean}}
   */
  toggleSubmission(obligationId) {
    const id = assertNonEmptyString(obligationId, 'obligationId', 'ObligationStore.toggleSubmission');
    const existing = this.obligations[id];
    if (!existing) {
      throw new ValidationError(`Unknown obligation "${id}"`, { obligationId: id });
    }
    return this.setSubmitted(id, existing.submitted !== true);
  }

/**
   * Seeds the current statutory obligations for the supplied companies.
   * By default this only runs when the register is empty, so a real submission
   * is never silently overwritten.
   *
   * @param {Array<{companyKey: string, companyName: string}>} companies
   * @param {Object} [options={}]
   * @param {Date} [options.asOf=new Date()]
   * @param {boolean} [options.force=false]
   * @returns {{seeded: number, skipped: boolean}}
   */
  seedDefaultObligationsIfEmpty(companies, options = {}) {
    const list = assertArray(companies, 'companies', 500, 'ObligationStore.seedDefaultObligationsIfEmpty');
    const asOf = options.asOf instanceof Date ? options.asOf : new Date();
    const force = options.force === true;

    if (!force && Object.keys(this.obligations).length > 0) {
      return { seeded: 0, skipped: true };
    }

    const submittedMap = {};
    for (const id of Object.keys(this.obligations)) {
      const record = this.obligations[id];
      if (record && record.submitted === true) {
        submittedMap[id] = true;
        if (record.submittedAt) {
          submittedMap[`${id}::at`] = record.submittedAt;
        }
      }
    }

    let seeded = 0;
    for (const company of list) {
      if (!company || typeof company.companyKey !== 'string' || company.companyKey.length === 0) continue;

      const generated = buildStatutoryObligations({
        companyKey: company.companyKey,
        companyName: company.companyName || company.companyKey,
        submittedMap,
        asOf
      });

      for (const obligation of generated) {
        this.upsertObligation(obligation);
        seeded += 1;
      }
    }

    this.save();
    defaultLogger.info(`Seeded ${seeded} statutory obligation(s) for ${list.length} company record(s).`);

    return { seeded, skipped: false };
  }

  /**
   * Ingests obligations scraped from the live ETA portal at `#/filing_obligations`.
   *
   * @param {Object} params
   * @param {string} params.companyKey
   * @param {string} params.companyName
   * @param {Array<Object>} params.scrapedRows
   * @param {Date} [params.asOf=new Date()]
   * @returns {number} Count of ingested obligations
   */
  /**
   * Ingests portal rows through a fresh, serialized read-modify-write.
   *
   * Unlike `upsertObligation`, this reads the register again inside the lock.
   * A scrape runs for minutes while the dashboard may be toggling obligations
   * throughout, so this store's in-memory copy is stale the moment it was
   * loaded — writing it back would discard every toggle made since.
   *
   * @param {Object} params
   * @param {string} params.companyKey
   * @param {string} params.companyName
   * @param {Array<Object>} params.scrapedRows
   * @param {Date} [params.asOf=new Date()]
   * @returns {Promise<number>} Count of ingested obligations
   */
  async ingestPortalObligationsSerialized(params = {}) {
    const companyKey = assertNonEmptyString(params.companyKey, 'companyKey', 'ObligationStore.ingestPortalObligations');
    const companyName = typeof params.companyName === 'string' && params.companyName.length > 0 ? params.companyName : companyKey;
    const scrapedRows = Array.isArray(params.scrapedRows) ? params.scrapedRows : [];
    const asOf = (params.asOf instanceof Date) ? params.asOf : new Date();

    if (scrapedRows.length === 0) return 0;

    const outcome = await updateJsonStore(this.filePath, (records) => {
      const staging = new ObligationStore(this.filePath);
      staging.obligations = (records && typeof records === 'object' && !Array.isArray(records)) ? records : {};

      let count = 0;
      for (const row of scrapedRows) {
        const parsed = parsePortalObligationRow(row, companyKey, companyName, asOf);
        if (parsed) {
          // upsertObligation mutates staging.obligations in place, so the object
          // returned below carries every change.
          staging.upsertObligation(parsed);
          count += 1;
        }
      }

      // Boxed, so the records are what lands on disk and `count` is what comes
      // back. Returning a plain {records, count} would persist the wrapper.
      return storeResult(staging.obligations, { records: staging.obligations, count });
    }, { defaultValue: {} });

    // Adopt the result so a caller reading this store afterwards sees the same
    // state the register now holds.
    this.obligations = outcome.records;

    if (outcome.count > 0) {
      defaultLogger.info(`Ingested ${outcome.count} live filing obligation(s) from ETA portal for ${companyName} (${companyKey}).`);
    }

    return outcome.count;
  }

  /**
   * Reconciles the register against a complete portal read.
   *
   * A row that was pending on the last cycle and is absent from the "الكل"
   * (all) view has either been submitted or dropped by the portal. Neither is
   * knowable from a single read, so the row is kept and marked
   * `resolved_unconfirmed`: visible, flagged, and never deleted.
   *
   * Deleting it would be the one irreversible option, and it is the wrong one.
   * The zero-fake-data rule cuts both ways — the system must never invent an
   * obligation, and it must never quietly lose one.
   *
   * Only safe to call with a read known to be complete, because a partial or
   * failed read would mark everything as missing. That is what `complete` guards.
   *
   * @param {Object} params
   * @param {string} params.companyKey
   * @param {Array<Object>} params.scrapedRows - rows from the "all" view
   * @param {boolean} [params.complete=false] - true only when the read succeeded
   * @param {Date} [params.asOf=new Date()]
   * @returns {Promise<{reconciled: number, retained: number, checked: number, skipped: string|null}>}
   */
  async reconcilePortalObligationsSerialized(params = {}) {
    const companyKey = assertNonEmptyString(params.companyKey, 'companyKey', 'ObligationStore.reconcilePortalObligations');
    const scrapedRows = Array.isArray(params.scrapedRows) ? params.scrapedRows : [];
    const asOf = (params.asOf instanceof Date) ? params.asOf : new Date();

    // An incomplete read would reconcile every obligation into "missing", which
    // is indistinguishable from the portal having dropped them all.
    if (params.complete !== true) {
      return { reconciled: 0, retained: 0, checked: 0, skipped: 'read_not_confirmed_complete' };
    }

    const outcome = await updateJsonStore(this.filePath, (records) => {
      const staging = new ObligationStore(this.filePath);
      staging.obligations = (records && typeof records === 'object' && !Array.isArray(records)) ? records : {};

      const seenIds = new Set();
      for (const row of scrapedRows) {
        const parsed = parsePortalObligationRow(row, companyKey, companyKey, asOf);
        if (parsed) seenIds.add(parsed.id);
      }

      let reconciled = 0;
      let retained = 0;
      let checked = 0;

      for (const id of Object.keys(staging.obligations)) {
        const record = staging.obligations[id];
        if (!record || record.companyKey !== companyKey) continue;
        checked += 1;

        if (seenIds.has(id)) {
          // Still on the portal. A row that was flagged and has reappeared is
          // confirmed rather than missing, so the flag is cleared.
          if (record.reconciliation === 'resolved_unconfirmed') {
            record.reconciliation = null;
            record.reconciledAt = null;
            record.updatedAt = new Date().toISOString();
            reconciled += 1;
          }
          continue;
        }

        if (record.submitted === true) {
          // Already known submitted; absence from the list adds nothing.
          retained += 1;
          continue;
        }

        if (record.reconciliation === 'resolved_unconfirmed') {
          // Already flagged on an earlier cycle. Left alone rather than
          // re-stamped, so `reconciledAt` stays the first time it was noticed.
          retained += 1;
          continue;
        }

        // Kept, flagged, dated. Never removed.
        record.reconciliation = 'resolved_unconfirmed';
        record.reconciledAt = new Date().toISOString();
        record.updatedAt = new Date().toISOString();
        reconciled += 1;
      }

      return storeResult(staging.obligations, {
        records: staging.obligations,
        reconciled,
        retained,
        checked
      });
    }, { defaultValue: {} });

    this.obligations = outcome.records;

    if (outcome.reconciled > 0) {
      defaultLogger.warn(
        `${outcome.reconciled} obligation(s) for ${companyKey} were absent from the complete portal read and are ` +
        'now marked resolved_unconfirmed. They are kept, not deleted: confirm each one with the office.'
      );
    }

    return { reconciled: outcome.reconciled, retained: outcome.retained, checked: outcome.checked, skipped: null };
  }

  ingestPortalObligations(params = {}) {
    const companyKey = assertNonEmptyString(params.companyKey, 'companyKey', 'ObligationStore.ingestPortalObligations');
    const companyName = typeof params.companyName === 'string' && params.companyName.length > 0 ? params.companyName : companyKey;
    const scrapedRows = Array.isArray(params.scrapedRows) ? params.scrapedRows : [];
    const asOf = (params.asOf instanceof Date) ? params.asOf : new Date();

    if (scrapedRows.length === 0) return 0;

    let count = 0;
    for (const row of scrapedRows) {
      const parsed = parsePortalObligationRow(row, companyKey, companyName, asOf);
      if (parsed) {
        this.upsertObligation(parsed);
        count += 1;
      }
    }

    if (count > 0) {
      this.save();
      defaultLogger.info(`Ingested ${count} live filing obligation(s) from ETA portal for ${companyName} (${companyKey}).`);
    }

    return count;
  }

  /**
   * Reconciles the register against a complete portal read.
   *
   * A row that was pending on the last cycle and is absent from the "الكل"
   * (all) view has either been submitted or dropped by the portal. Neither is
   * knowable from a single read, so the row is kept and marked
   * `resolved_unconfirmed`: visible, flagged, and never deleted.
   *
   * Deleting it would be the one irreversible option, and it is the wrong one.
   * The zero-fake-data rule cuts both ways — the system must never invent an
   * obligation, and it must never quietly lose one.
   *
   * Only safe to call with a read known to be complete, because a partial or
   * failed read would mark everything as missing. That is what `complete` guards.
   *
   * @param {Object} params
   * @param {string} params.companyKey
   * @param {Array<Object>} params.scrapedRows - rows from the "all" view
   * @param {boolean} [params.complete=false] - true only when the read succeeded
   * @param {Date} [params.asOf=new Date()]
   * @returns {{reconciled: number, retained: number, checked: number, skipped: string|null}}
   */
  reconcilePortalObligations(params = {}) {
    const companyKey = assertNonEmptyString(params.companyKey, 'companyKey', 'ObligationStore.reconcilePortalObligations');
    const scrapedRows = Array.isArray(params.scrapedRows) ? params.scrapedRows : [];
    const asOf = (params.asOf instanceof Date) ? params.asOf : new Date();

    // An incomplete read would reconcile every obligation into "missing", which
    // is indistinguishable from the portal having dropped them all.
    if (params.complete !== true) {
      return { reconciled: 0, retained: 0, checked: 0, skipped: 'read_not_confirmed_complete' };
    }

    const seenIds = new Set();
    for (const row of scrapedRows) {
      const parsed = parsePortalObligationRow(row, companyKey, companyKey, asOf);
      if (parsed) seenIds.add(parsed.id);
    }

    let reconciled = 0;
    let retained = 0;
    let checked = 0;

    for (const id of Object.keys(this.obligations)) {
      const record = this.obligations[id];
      if (!record || record.companyKey !== companyKey) continue;
      checked += 1;

      if (seenIds.has(id)) {
        // Still on the portal. A row that was flagged and has reappeared is
        // confirmed rather than missing, so the flag is cleared.
        if (record.reconciliation === 'resolved_unconfirmed') {
          record.reconciliation = null;
          record.reconciledAt = null;
          record.updatedAt = new Date().toISOString();
          reconciled += 1;
        }
        continue;
      }

      if (record.submitted === true) {
        // Already known submitted; absence from the list adds nothing.
        retained += 1;
        continue;
      }

      if (record.reconciliation === 'resolved_unconfirmed') {
        // Already flagged on an earlier cycle. Left alone rather than
        // re-stamped, so `reconciledAt` stays the first time it was noticed.
        retained += 1;
        continue;
      }

      // Kept, flagged, dated. Never removed.
      record.reconciliation = 'resolved_unconfirmed';
      record.reconciledAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      reconciled += 1;
    }

    if (reconciled > 0) {
      this.save();
      defaultLogger.warn(
        `${reconciled} obligation(s) for ${companyKey} were absent from the complete portal read and are ` +
        'now marked resolved_unconfirmed. They are kept, not deleted: confirm each one with the office.'
      );
    }

    return { reconciled, retained, checked, skipped: null };
  }

  /**
   * Grouped obligations per company, ready for the dashboard.
   * @param {Object} [options={}]
   * @returns {Array<{companyKey: string, company: string, obligations: Array<Object>, summary: Object}>}
   */
  getCompanySummaries(options = {}) {
    const asOf = (options.asOf instanceof Date) ? options.asOf : new Date();
    const grouped = new Map();

    for (const obligation of this.getAllObligations({ asOf })) {
      const key = obligation.companyKey;
      if (!grouped.has(key)) {
        grouped.set(key, { companyKey: key, company: obligation.company, obligations: [] });
      }
      grouped.get(key).obligations.push(obligation);
    }

    const summaries = [];
    for (const entry of grouped.values()) {
      summaries.push(Object.assign({}, entry, { summary: summarizeObligations(entry.obligations) }));
    }

    return summaries;
  }

  /**
   * Summary counts across the whole register.
   * @param {Object} [options={}]
   * @returns {Object}
   */
  getSummary(options = {}) {
    return summarizeObligations(this.getAllObligations(options));
  }

  /**
   * Validates a status token against the known statuses.
   * @param {string} status
   * @returns {string}
   */
  static assertStatus(status) {
    const value = assertNonEmptyString(status, 'status', 'ObligationStore.assertStatus');
    if (!OBLIGATION_STATUSES.includes(value)) {
      throw new ValidationError(`Unknown obligation status "${value}"`, {
        status: value,
        allowed: OBLIGATION_STATUSES
      });
    }
    return value;
  }

  /**
   * Persists the register.
   */
  save() {
    this._persist();
  }
}

module.exports = {
  ObligationStore,
  MAX_OBLIGATIONS
};