/**
 * The payment-claim register backed by a JSON file.
 *
 * Deliberately a structural mirror of ObligationStore: same load/guard/persist
 * shape, same `updateJsonStore` mutator discipline, same "a vanished record is
 * marked, never deleted" rule. That is not copy-paste for its own sake — the two
 * registers answer the same question about the same office (what must be done,
 * and can it still be acted on), so a divergence between them would show up as
 * two different numbers on one dashboard.
 *
 * The differences that matter, and why:
 *
 *   - Claims are keyed `<companyId>::<claimNumber>` rather than by account,
 *     because the Workspace addresses a company by its workspace id.
 *   - Staleness is reconciled per companyId, not globally. A complete read proves
 *     something about the one company it covered; a global reconcile during a run
 *     where some accounts were in backoff would mark every claim of every
 *     unread company as stale, which is precisely wrong in the runs where the
 *     data is thinnest.
 *   - A claim's `firstSeenAt` is preserved across upserts while everything
 *     observed is refreshed. `firstSeenAt` is what orders the register, so
 *     letting a re-read move it would reorder the whole list every run.
 *   - Nothing is ever deleted. A claim that leaves the complete list is marked
 *     `stale`, because "the portal no longer lists this" and "this was paid" are
 *     different facts and only one of them was observed.
 */

const fs = require('fs');
const path = require('path');
const { StorageError } = require('../common/errors');
const { assertNonEmptyString } = require('../common/assertions');
const { guardRegisterLoad, writeJsonAtomic } = require('../storage/atomic-json');
const { updateJsonStore, storeResult } = require('../storage/store-lock');
const { classifyClaim, summarizePayments } = require('../automation/portal/payments-scraper');
const { defaultLogger } = require('../common/logger');

const MAX_PAYMENTS = 4000;

/**
 * Fields that survive an upsert untouched.
 *
 * `firstSeenAt` is the register's identity-in-time: it is when the office first
 * saw the claim, which no later read can change. Everything else observed is
 * refreshed. Keeping this list short is deliberate — a field missing from it
 * gets overwritten by the next read, and one wrongly added stops updating.
 *
 * @type {ReadonlyArray<string>}
 */
const PRESERVED_ON_UPSERT = Object.freeze(['firstSeenAt', 'createdAt']);

/**
 * Merges an incoming claim over a stored one.
 *
 * The stored record is spread first so fields this store does not know about
 * survive, matching the preserve-verbatim policy in src/storage/schemas.js. Only
 * the preserved list is then restored from the old value.
 *
 * @param {Object|undefined} previous
 * @param {Object} incoming
 * @returns {Object}
 */
function mergePreserving(previous, incoming) {
  const next = Object.assign({}, previous || {}, incoming);
  if (previous) {
    for (const key of PRESERVED_ON_UPSERT) {
      if (previous[key] !== undefined) next[key] = previous[key];
    }
  }
  return next;
}

/**
 * Builds the store key for a claim.
 *
 * @param {string} companyId
 * @param {string} claimNumber
 * @returns {string}
 */
function paymentId(companyId, claimNumber) {
  return `${companyId}::${claimNumber}`;
}

class PaymentsStore {
  /**
   * @param {string} [customFilePath]
   */
  constructor(customFilePath) {
    this.filePath = customFilePath
      ? assertNonEmptyString(customFilePath, 'customFilePath', 'PaymentsStore.constructor')
      : path.resolve(process.cwd(), 'data', 'payments.json');

    const dataDir = path.dirname(this.filePath);
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        throw new StorageError(`Failed to create payments store directory: ${dataDir}`, { dataDir }, err);
      }
    }

    this.payments = this._load();
  }

  /**
   * Loads the register from disk safely.
   *
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
        defaultLogger.warn(`Invalid content in ${this.filePath}, resetting to an empty payment register.`);
        return {};
      }
      return parsed;
    } catch (err) {
      defaultLogger.error(`Failed to read the payments store at ${this.filePath}`, { filePath: this.filePath }, err);
      return {};
    }
  }

  /**
   * Atomically persists the register.
   */
  _persist() {
    try {
      writeJsonAtomic(this.filePath, this.payments);
    } catch (writeErr) {
      if (writeErr instanceof StorageError) throw writeErr;
      throw new StorageError(`Failed to persist the payments store to ${this.filePath}`, {
        filePath: this.filePath
      }, writeErr);
    }
  }

  /**
   * All claims, newest first.
   *
   * "Newest" is `firstSeenAt` descending, not `updatedAt`: `updatedAt` moves on
   * every single run, so ordering by it reshuffles the whole list daily and
   * means nothing. Ties break on the key so the order is total and stable.
   *
   * @param {{asOf?: string}} [options]
   * @returns {Array<Object>}
   */
  getAllPayments(options = {}) {
    const todayStr = options.asOf || undefined;
    // The unread sentinel and the read-metadata record are records about the read,
    // not claims. Letting either into the list would show a blank row in the
    // payments table and let them reach the totals.
    const list = Object.values(this.payments)
      .filter((record) => record && record.unread !== true && record.isReadMeta !== true);

    list.sort((a, b) => {
      const aSeen = String(a.firstSeenAt || '');
      const bSeen = String(b.firstSeenAt || '');
      if (aSeen !== bSeen) return aSeen < bSeen ? 1 : -1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    if (!todayStr) return list;
    // Hydrated copies carry the urgency band the dashboard renders.
    return list.map((record) => this._hydrate(record, todayStr));
  }

  /**
   * Attaches the computed urgency band without touching the stored record.
   *
   * @param {Object} record
   * @param {string} todayStr - YYYY-MM-DD in Cairo.
   * @returns {Object}
   */
  _hydrate(record, todayStr) {
    return Object.assign({}, record, { urgency: classifyClaim(record, todayStr) });
  }

  /**
   * Claims for one company, excluding the unread sentinel.
   *
   * @param {string} companyId
   * @returns {Array<Object>}
   */
  getForCompany(companyId) {
    const id = assertNonEmptyString(companyId, 'companyId', 'PaymentsStore.getForCompany');
    return Object.values(this.payments)
      .filter((record) => record && record.companyId === id
        && record.unread !== true && record.isReadMeta !== true);
  }

  /**
   * How the last read for a company went, including whether it was filtered.
   *
   * @param {string} companyId
   * @returns {{read: boolean, unfiltered: boolean, filterLabel: string, reason: string|null, at: string|null}}
   */
  getReadConditions(companyId) {
    const id = assertNonEmptyString(companyId, 'companyId', 'PaymentsStore.getReadConditions');
    const meta = this.payments[`${id}::__read__`];
    if (meta && meta.isReadMeta === true) {
      return {
        read: true,
        unfiltered: meta.unfiltered === true,
        filterLabel: meta.filterLabel || '',
        reason: null,
        at: meta.lastReadAt || null
      };
    }
    const unread = this.getReadState(id);
    return { read: false, unfiltered: false, filterLabel: '', reason: unread.reason, at: unread.at };
  }

  /**
   * Rolled-up figures for the dashboard.
   *
   * @param {{todayStr?: string}} [options]
   * @returns {{totalUnpaidEgp: number, openCount: number, overdueCount: number, dueSoonCount: number, paidCount: number, staleCount: number, nearest: Object|null}}
   */
  getSummary(options = {}) {
    return summarizePayments(this.getAllPayments(options), { todayStr: options.todayStr });
  }

  /**
   * Ingests a portal read for one company.
   *
   * @param {Object} params
   * @param {string} params.companyKey - Portal account username.
   * @param {string} params.companyId - Workspace company id.
   * @param {string} [params.companyName]
   * @param {Array<Object>} params.rows - Claims from the scraper.
   * @param {boolean} [params.complete=false] - True only when the read is trusted.
   * @param {Date} [params.asOf=new Date()]
   * @returns {Promise<number>} Count of claims upserted.
   */
  async ingestPaymentsSerialized(params = {}) {
    const companyKey = assertNonEmptyString(params.companyKey, 'companyKey', 'PaymentsStore.ingestPayments');
    const companyId = assertNonEmptyString(params.companyId, 'companyId', 'PaymentsStore.ingestPayments');
    const companyName = typeof params.companyName === 'string' && params.companyName.length > 0
      ? params.companyName
      : companyKey;
    const rows = Array.isArray(params.rows) ? params.rows.slice(0, MAX_PAYMENTS) : [];
    const asOf = (params.asOf instanceof Date) ? params.asOf : new Date();
    const nowIso = new Date().toISOString();
    const complete = params.complete === true;

    const outcome = await updateJsonStore(this.filePath, (records) => {
      const staging = new PaymentsStore(this.filePath);
      staging.payments = (records && typeof records === 'object' && !Array.isArray(records)) ? records : {};

      const seenIds = new Set();
      let count = 0;

      // A read that produced claims supersedes an earlier unread marker. Leaving
      // it in place would keep reporting the company as unread while its claims
      // sit right there in the register.
      const unreadKey = `${companyId}::__unread__`;
      if (staging.payments[unreadKey]) delete staging.payments[unreadKey];

      // Whether this read was filtered is stamped onto every claim it touched,
      // because that is where a reader will look. A claim seen only through
      // "غير مسدد / مسدد جزئياً" is not evidence about claims the filter hides.
      const wasUnfiltered = params.unfiltered !== false;

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;

        const claimNumber = typeof row.claimNumber === 'string' ? row.claimNumber.trim() : '';
        // A claim with no number cannot be identified, so it cannot be upserted,
        // and inventing one would collide with a real claim later.
        if (claimNumber.length === 0) continue;

        const id = row.id || paymentId(companyId, claimNumber);
        seenIds.add(id);

        const previous = staging.payments[id];
        const incoming = {
          id,
          companyId,
          companyKey,
          companyName,
          claimNumber,
          taxType: typeof row.taxType === 'string' ? row.taxType : '',
          itemType: typeof row.itemType === 'string' ? row.itemType : '',
          registrationType: typeof row.registrationType === 'string' ? row.registrationType : '-',
          amount: typeof row.amount === 'number' && isFinite(row.amount) ? row.amount : null,
          currency: typeof row.currency === 'string' ? row.currency : '',
          status: typeof row.status === 'string' ? row.status : '',
          periodFrom: typeof row.periodFrom === 'string' ? row.periodFrom : '',
          periodTo: typeof row.periodTo === 'string' ? row.periodTo : '',
          payBefore: typeof row.payBefore === 'string' ? row.payBefore : '',
          lastSeenAt: nowIso,
          readFiltered: wasUnfiltered ? false : true,
          readFilterLabel: wasUnfiltered ? '' : (typeof params.filterLabel === 'string' ? params.filterLabel : ''),
          updatedAt: nowIso
        };

        const merged = mergePreserving(previous, incoming);

        if (!previous) {
          merged.firstSeenAt = nowIso;
          merged.createdAt = nowIso;
          merged.stale = false;
          merged.staleSince = null;
        } else if (merged.stale === true) {
          // Seen again on a complete read: the portal lists it, so it is live.
          merged.stale = false;
          merged.staleSince = null;
        }

        staging.payments[id] = merged;
        count += 1;
      }

      // Absence only means something after a COMPLETE read of this company, and
      // only when the read was not filtered.
      //
      // The page opens filtered to "غير مسدد / مسدد جزئياً", so a claim missing
      // from that list has most likely been paid. Reconciling on it would mark
      // every paid claim stale — a conclusion the read cannot support. The
      // scraper already refuses to call a filtered read complete; this is the
      // second lock, so a caller that ignores `complete` still cannot cause it.
      if (complete && params.unfiltered !== false) {
        for (const id of Object.keys(staging.payments)) {
          const record = staging.payments[id];
          if (!record || record.companyId !== companyId) continue;
          if (seenIds.has(id)) continue;
          if (record.stale === true) continue;

          record.stale = true;
          record.staleSince = asOf.toISOString();
          record.updatedAt = nowIso;
        }
      }

      // The read's own conditions travel with the records, so a later reader can
      // tell a filtered slice from a full statement without re-reading the log.
      const readKey = `${companyId}::__read__`;
      const previousRead = staging.payments[readKey] || {};
      staging.payments[readKey] = {
        id: readKey,
        companyId,
        unread: false,
        isReadMeta: true,
        // Only a read that was genuinely unfiltered may reconcile.
        unfiltered: params.unfiltered !== false,
        filterLabel: typeof params.filterLabel === 'string' ? params.filterLabel : (previousRead.filterLabel || ''),
        lastReadAt: nowIso,
        firstSeenAt: previousRead.firstSeenAt || nowIso,
        updatedAt: nowIso
      };

      return storeResult(staging.payments, { records: staging.payments, count });
    }, { defaultValue: {} });

    this.payments = outcome.records;

    if (outcome.count > 0) {
      defaultLogger.info(`Ingested ${outcome.count} payment claim(s) for ${companyName} (${companyId}).`);
    }

    return outcome.count;
  }

  /**
   * Records that a read did not happen, or did not reach the table.
   *
   * This is not the same as "the company owes nothing". Keeping the distinction
   * on disk is what lets the dashboard say which one it is looking at instead of
   * rendering a confident zero.
   *
   * @param {Object} params
   * @param {string} params.companyId
   * @param {string} params.reason
   * @param {Date} [params.asOf=new Date()]
   * @returns {Promise<void>}
   */
  async recordUnread(params = {}) {
    const companyId = assertNonEmptyString(params.companyId, 'companyId', 'PaymentsStore.recordUnread');
    const reason = assertNonEmptyString(params.reason, 'reason', 'PaymentsStore.recordUnread');
    const asOf = (params.asOf instanceof Date) ? params.asOf : new Date();

    const outcome = await updateJsonStore(this.filePath, (records) => {
      const staging = new PaymentsStore(this.filePath);
      staging.payments = (records && typeof records === 'object' && !Array.isArray(records)) ? records : {};

      // A sentinel record, kept under a key that cannot collide with a claim id
      // because it contains no claim number.
      const id = `${companyId}::__unread__`;
      staging.payments[id] = {
        id,
        companyId,
        companyKey: '',
        companyName: '',
        claimNumber: '',
        unread: true,
        unreadReason: reason,
        lastSeenAt: null,
        firstSeenAt: asOf.toISOString(),
        updatedAt: asOf.toISOString()
      };

      return storeResult(staging.payments, { records: staging.payments, count: 1 });
    }, { defaultValue: {} });

    // Adopt the result. Without this the sentinel is on disk but not in memory,
    // so a caller asking this same instance what it just recorded is told the
    // company was never read.
    this.payments = outcome.records;

    defaultLogger.warn(`Payments not read for company ${companyId}: ${reason}`);
  }

  /**
   * Whether the last read for a company produced trustworthy claims.
   *
   * @param {string} companyId
   * @returns {{read: boolean, reason: string|null, at: string|null}}
   */
  getReadState(companyId) {
    const id = `${companyId}::__unread__`;
    const sentinel = this.payments[id];
    if (sentinel && sentinel.unread === true) {
      return { read: false, reason: sentinel.unreadReason || 'unavailable', at: sentinel.updatedAt || null };
    }
    const any = this.getForCompany(companyId);
    if (any.length > 0) {
      const latest = any.map((c) => String(c.lastSeenAt || '')).sort().pop();
      return { read: true, reason: null, at: latest || null };
    }
    return { read: false, reason: 'not_read_yet', at: null };
  }
}

module.exports = {
  PaymentsStore,
  MAX_PAYMENTS,
  PRESERVED_ON_UPSERT,
  mergePreserving,
  paymentId
};
