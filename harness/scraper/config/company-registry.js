/**
 * Company Name Registry & Multi-Tier Resolver.
 *
 * The single authority for "what is this portal account's company really called".
 *
 * The ETA Workspace dashboard links every taxpayer entity as
 * `<a href="/workspace/company/89897">افجي التوكيلات الملاحية والاعمال البحرية - افجي مصر</a>`,
 * which is a semantic, non-positional source. That link is the primary tier.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 5: Resource acquisition/release (atomic registry replace)
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults (a missing source yields no invented name)
 */

const fs = require('fs');
const path = require('path');
const { StorageError, ValidationError } = require('../common/errors');
const { assertNonEmptyString } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');
const { buildCanonicalKeys, canonicalKey, mergeCaseVariantKeys } = require('../common/canonical-keys');

/** The authoritative ETA Workspace company-link selector. */
const WORKSPACE_COMPANY_LINK_SELECTOR = 'a[href*="/workspace/company/"]';

/** The historical placeholder that must never reach the dashboard again. */
const COMPANY_PLACEHOLDER = 'اسم المنشأة في بوابة ETA غير متاح';

/** How a name was obtained, in order of trust. */
const NAME_SOURCES = ['workspace_link', 'sap_profile', 'registry', 'alias', 'account_label', 'unresolved'];

const MAX_COMPANY_NAME_LENGTH = 300;
const MAX_REGISTRY_ENTRIES = 1000;
const MIN_COMPANY_NAME_LENGTH = 2;

/** Minimum tokens before a repeated run counts as portal duplication. */
const MIN_REPEATED_PHRASE_TOKENS = 3;

/**
 * True when words[start..start+length] equals words[other..other+length].
 * @param {string[]} words
 * @param {number} start
 * @param {number} other
 * @param {number} length
 * @returns {boolean}
 */
function _phraseEquals(words, start, other, length) {
  for (let i = 0; i < length; i++) {
    if (words[start + i] !== words[other + i]) return false;
  }
  return true;
}

/**
 * Collapses a name that the portal rendered twice inside one string.
 *
 * A workspace link carries the company name as its own text and again in the
 * surrounding breadcrumb, so one capture arrived as
 * "<name> ش م م <name> Roto star ش م م". The first copy is the name; the second
 * is the same words again around an alias. Left alone it reaches the dashboard
 * as a single garbled heading, and the old "longest name wins" link selection
 * actively preferred the longer, worse copy.
 *
 * Only the longest repeated run of three or more tokens is removed, and only
 * the later copy; the pass repeats so a name repeated three times collapses
 * to one copy. A real legal name repeating a short word ("ش م م", "شركة
 * شركة") is left untouched because it never reaches the token threshold. Each
 * pass strictly shortens the string, so the loop always terminates.
 *
 * @param {string} value - Already whitespace-collapsed name text.
 * @returns {string}
 */
function collapseRepeatedNamePhrase(value) {
  let current = value;

  for (;;) {
    const words = current.split(' ').filter(Boolean);
    const total = words.length;
    let collapsed = null;

    for (let length = Math.floor(total / 2); length >= MIN_REPEATED_PHRASE_TOKENS && !collapsed; length--) {
      for (let start = 0; start + length * 2 <= total && !collapsed; start++) {
        for (let other = start + length; other + length <= total; other++) {
          if (!_phraseEquals(words, start, other, length)) continue;
          collapsed = words.slice(0, other).concat(words.slice(other + length)).join(' ').trim();
          break;
        }
      }
    }

    if (!collapsed) return current;
    current = collapsed;
  }
}

/**
 * Normalizes portal text: strips bidi/invisible marks, collapses whitespace,
 * and removes a name the portal duplicated inside a single capture.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCompanyName(value) {
  return collapseRepeatedNamePhrase(
    String(value === undefined || value === null ? '' : value)
      .replace(/[\u200e\u200f\u061c\u202a-\u202e]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * True when a value is a usable company name: not blank, not a bare number
 * (a tax number is not a name) and within the sane length bounds.
 *
 * @param {unknown} value
 * @param {string} [portalAccountId=''] - Rejected when the name equals the account id
 * @returns {boolean}
 */
function isUsableCompanyName(value, portalAccountId = '') {
  const name = normalizeCompanyName(value);

  if (name.length < MIN_COMPANY_NAME_LENGTH || name.length > MAX_COMPANY_NAME_LENGTH) return false;
  if (/^[\d\s_\-./]+$/.test(name)) return false;
  if (name === COMPANY_PLACEHOLDER) return false;

  const accountId = normalizeCompanyName(portalAccountId);
  if (accountId.length > 0 && name === accountId) return false;

  return true;
}

/**
 * True when a stored name is the old "unavailable" placeholder.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlaceholderName(value) {
  const name = normalizeCompanyName(value);
  return name.length === 0 || name === COMPANY_PLACEHOLDER;
}

/**
 * Extracts the company id from a workspace company href.
 * @param {unknown} href
 * @returns {{companyId: string, href: string}|null}
 */
function parseCompanyHref(href) {
  if (typeof href !== 'string') return null;

  const marker = '/workspace/company/';
  const index = href.indexOf(marker);
  if (index === -1) return null;

  const rest = href.slice(index + marker.length);
  const companyId = rest.split(/[/?#]/)[0].trim();

  if (companyId.length === 0) return null;

  return { companyId, href };
}

/**
 * Normalizes raw `{ text, href }` pairs harvested from the workspace DOM.
 *
 * @param {Array<{text?: string, innerText?: string, href?: string, companyName?: string}>} links
 * @param {string} [portalAccountId='']
 * @returns {Array<{companyName: string, companyId: string, href: string}>}
 */
function parseWorkspaceCompanyLinks(links, portalAccountId = '') {
  if (!Array.isArray(links)) {
    throw new ValidationError('links must be an array', { receivedType: typeof links });
  }

  const results = [];

  for (const link of links) {
    if (!link || typeof link !== 'object') continue;

    const parsedHref = parseCompanyHref(link.href);
    if (!parsedHref) continue;

    const rawName = link.companyName !== undefined ? link.companyName : (link.text !== undefined ? link.text : link.innerText);
    const companyName = normalizeCompanyName(rawName);

    if (!isUsableCompanyName(companyName, portalAccountId)) continue;

    results.push({ companyName, companyId: parsedHref.companyId, href: parsedHref.href });
  }

  return results;
}

/**
 * Picks the best company link: the longest usable name wins, because the
 * workspace sometimes renders a truncated duplicate of the same entity.
 *
 * @param {Array<Object>} links
 * @param {string} [portalAccountId='']
 * @returns {{companyName: string, companyId: string, href: string}|null}
 */
function pickBestCompanyLink(links, portalAccountId = '') {
  const candidates = parseWorkspaceCompanyLinks(links, portalAccountId);
  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.companyName.length > best.companyName.length) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Persistent registry of resolved company names, keyed by portal account id.
 * Backs resolution tier 3 so a name observed once is never lost again.
 */
class CompanyRegistry {
  /**
   * @param {string} [customFilePath]
   */
  constructor(customFilePath) {
    this.filePath = customFilePath
      ? assertNonEmptyString(customFilePath, 'customFilePath', 'CompanyRegistry.constructor')
      : path.resolve(process.cwd(), 'data', 'company-registry.json');

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        throw new StorageError(`Failed to create company registry directory: ${dir}`, { dir }, err);
      }
    }

    this.entries = this._load();
  }

  /**
   * Loads the registry with a fail-safe empty result (RULE 7).
   * @returns {Record<string, Object>}
   */
  _load() {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw || raw.trim().length === 0) return {};

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        defaultLogger.warn(`Invalid company registry at ${this.filePath}; starting empty.`);
        return {};
      }

      // The portal has returned account labels with inconsistent capitalisation
      // between runs, which used to leave "Thenile14" and "thenile14" as two
      // entries here. Merge them on load so the file is repaired the next time
      // it is saved, rather than growing a new variant on every run.
      const { merged, collisions } = mergeCaseVariantKeys(parsed);
      if (collisions.length > 0) {
        defaultLogger.warn(
          `Company registry contained ${collisions.length} account key(s) differing only by case; merged on load.`,
          { collisions: collisions.map((c) => c.spellings) }
        );
      }
      return merged;
    } catch (err) {
      defaultLogger.error(`Failed to read the company registry at ${this.filePath}`, { filePath: this.filePath }, err);
      return {};
    }
  }

  /**
   * Atomically persists the registry (RULE 5).
   */
  save() {
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(this.entries, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (cleanupErr) {
          defaultLogger.error('Failed to cleanup the temp company registry file', { tempPath }, cleanupErr);
        }
      }
      throw new StorageError(`Failed to persist the company registry to ${this.filePath}`, {
        filePath: this.filePath
      }, err);
    }
  }

  /**
   * Looks up one entry.
   * @param {string} accountKey
   * @returns {Object|null}
   */
  get(accountKey) {
    const requested = assertNonEmptyString(accountKey, 'accountKey', 'CompanyRegistry.get');
    const key = this._canonicalOf(requested);
    if (key === null) return null;
    const entry = this.entries[key];
    return entry && typeof entry === 'object' ? entry : null;
  }

  /**
   * Records a resolved name. An unusable name is refused, never stored.
   *
   * @param {string} accountKey
   * @param {Object} value
   * @param {string} value.companyName
   * @param {string} [value.companyId='']
   * @param {string} [value.href='']
   * @param {string} [value.source='registry']
   * @param {boolean} [value.persist=true]
   * @returns {Object|null} The stored entry, or null when the name is unusable
   */
  set(accountKey, value) {
    const requested = assertNonEmptyString(accountKey, 'accountKey', 'CompanyRegistry.set');

    // Write through the same case-insensitive identity the loader uses, so a
    // new scrape that spells the account differently updates the existing entry
    // instead of creating a second one.
    const existing = this._canonicalOf(requested);
    const key = existing === null ? requested : existing;

    if (!value || typeof value !== 'object') {
      throw new ValidationError('Registry value must be an object', { value });
    }

    const companyName = normalizeCompanyName(value.companyName);
    if (!isUsableCompanyName(companyName, key)) {
      defaultLogger.warn(`Refused to store an unusable company name for account ${key}.`);
      return null;
    }

    if (!this.entries[key] && Object.keys(this.entries).length >= MAX_REGISTRY_ENTRIES) {
      defaultLogger.warn(`Company registry reached its ${MAX_REGISTRY_ENTRIES} bound; not storing ${key}.`);
      return null;
    }

    this.entries[key] = {
      accountKey: key,
      companyName,
      companyId: value.companyId ? String(value.companyId) : '',
      href: value.href ? String(value.href) : '',
      source: value.source ? String(value.source) : 'registry',
      observedAt: new Date().toISOString()
    };

    if (value.persist !== false) {
      this.save();
    }

    return this.entries[key];
  }

  /**
   * Finds the stored key that differs from `key` only by case, if any.
   *
   * @param {string} key
   * @returns {string|null} the stored spelling, or null when there is no match
   */
  _canonicalOf(key) {
    if (typeof key !== 'string' || key.trim().length === 0) return null;
    const folded = key.trim().toLowerCase();
    for (const stored of Object.keys(this.entries)) {
      if (stored.trim().toLowerCase() === folded) return stored;
    }
    return null;
  }

  /**
   * Every entry as an array.
   * @returns {Array<Object>}
   */
  all() {
    return Object.keys(this.entries).map((key) => this.entries[key]);
  }

  /**
   * @returns {number}
   */
  get size() {
    return Object.keys(this.entries).length;
  }
}

/**
 * Resolves the authoritative company name for a portal account.
 *
 * Tiers, in order of trust:
 *   1. ETA Workspace company link (authoritative, observed this run)
 *   2. SAP UserProfile exact title element (observed this run)
 *   3. Persistent registry (observed on an earlier run)
 *   4. KNOWN_ACCOUNT_ALIASES (curated)
 *   5. The account label from accounts.txt
 *
 * It never returns the "غير متاح" placeholder: either a real source is found, or
 * the name is left empty for the caller to handle explicitly.
 *
 * @param {Object} params
 * @param {string} params.portalAccountId
 * @param {string} [params.accountLabel='']
 * @param {{companyName: string, companyId?: string, href?: string}} [params.workspaceCompany=null]
 * @param {string} [params.sapProfileName='']
 * @param {Object|null} [params.registry=null] - CompanyRegistry-like `{ get(key) }`
 * @param {Record<string, string>} [params.aliases={}] - KNOWN_ACCOUNT_ALIASES
 * @returns {{name: string, source: string, companyId: string, href: string}}
 */
function resolveCompanyName(params = {}) {
  const accountId = assertNonEmptyString(params.portalAccountId, 'portalAccountId', 'resolveCompanyName');
  const aliases = (params.aliases && typeof params.aliases === 'object') ? params.aliases : {};

  const result = (name, source, extra) => Object.assign({
    name: normalizeCompanyName(name),
    source,
    companyId: '',
    href: ''
  }, extra || {});

  // Tier 1 - ETA Workspace company link
  const workspace = params.workspaceCompany;
  if (workspace && typeof workspace === 'object' && isUsableCompanyName(workspace.companyName, accountId)) {
    return result(workspace.companyName, 'workspace_link', {
      companyId: workspace.companyId || '',
      href: workspace.href || ''
    });
  }
  if (typeof workspace === 'string' && isUsableCompanyName(workspace, accountId)) {
    return result(workspace, 'workspace_link');
  }

  // Tier 2 - SAP UserProfile exact title element
  if (isUsableCompanyName(params.sapProfileName, accountId)) {
    return result(params.sapProfileName, 'sap_profile');
  }

  // Tier 3 - persistent registry
  const registryEntry = (params.registry && typeof params.registry.get === 'function')
    ? params.registry.get(accountId)
    : null;
  if (registryEntry && isUsableCompanyName(registryEntry.companyName, accountId)) {
    return result(registryEntry.companyName, 'registry', {
      companyId: registryEntry.companyId || '',
      href: registryEntry.href || ''
    });
  }

  // Tier 4 - curated aliases
  const alias = aliases[accountId];
  if (isUsableCompanyName(alias, accountId)) {
    return result(alias, 'alias');
  }

  // Tier 5 - the label configured in accounts.txt
  if (isUsableCompanyName(params.accountLabel, accountId)) {
    return result(params.accountLabel, 'account_label');
  }

  // No usable source. An invented name is worse than an honest blank.
  return result('', 'unresolved');
}

module.exports = {
  WORKSPACE_COMPANY_LINK_SELECTOR,
  COMPANY_PLACEHOLDER,
  NAME_SOURCES,
  MAX_COMPANY_NAME_LENGTH,
  MAX_REGISTRY_ENTRIES,
  normalizeCompanyName,
  collapseRepeatedNamePhrase,
  isUsableCompanyName,
  isPlaceholderName,
  parseCompanyHref,
  parseWorkspaceCompanyLinks,
  pickBestCompanyLink,
  CompanyRegistry,
  resolveCompanyName
};