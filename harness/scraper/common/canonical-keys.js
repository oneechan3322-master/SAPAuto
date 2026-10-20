/**
 * Case-insensitive identity for portal accounts.
 *
 * The ETA portal returns an account's label with inconsistent capitalisation
 * between runs ("HashimSabry" on one scrape, "hashimsabry" on the next). Task ids
 * and registry keys are built from that label, so the same taxpayer produced two
 * distinct keys, two registry entries, and two rows in the dashboard.
 *
 * The rule here is deliberately narrow: identities that differ ONLY by case are
 * one account. Anything else — "Trans_gulf" vs "TransGulfM", "315240679" vs
 * "205971997" — stays separate, because those are genuinely different portals.
 */

/**
 * Builds a case-insensitive lookup from a list of spellings.
 *
 * First spelling seen wins, so callers should order the input by trust (an
 * accounts.txt spelling before a scraped one).
 *
 * @param {Array<string>} candidates
 * @returns {Map<string, string>} lowercased -> first-seen spelling
 */
function buildCanonicalKeys(candidates) {
  const canonical = new Map();
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const folded = trimmed.toLowerCase();
    if (!canonical.has(folded)) canonical.set(folded, trimmed);
  }
  return canonical;
}

/**
 * Resolves one spelling through a canonical map.
 *
 * @param {Map<string, string>|null|undefined} canonical
 * @param {string} key
 * @returns {string} the canonical spelling, or the input unchanged when unmapped
 */
function canonicalKey(canonical, key) {
  if (!canonical || typeof key !== 'string') return key;
  const hit = canonical.get(key.trim().toLowerCase());
  return hit === undefined ? key : hit;
}

/**
 * Collapses case-variant duplicates in a record keyed by account.
 *
 * Later entries are merged onto the canonical key rather than dropped, so a
 * document seen under both spellings survives as one record. The surviving key
 * is the first-seen (canonical) spelling.
 *
 * @param {Record<string, Object>} byKey
 * @param {Map<string, string>|null} [canonical=null]
 * @returns {{merged: Record<string, Object>, collisions: Array<{folded: string, spellings: string[], kept: string}>}}
 */
function mergeCaseVariantKeys(byKey, canonical = null) {
  // Only an object's keys are identities. An array is a positional list, so its
  // keys ("0", "1", ...) are not account ids and must be left exactly as they
  // are; folding them would destroy the list.
  if (!byKey || typeof byKey !== 'object' || Array.isArray(byKey)) {
    return { merged: byKey, collisions: [] };
  }

  const source = byKey;
  const merged = {};
  const groups = new Map();

  for (const key of Object.keys(source)) {
    const folded = key.trim().toLowerCase();
    if (!groups.has(folded)) groups.set(folded, []);
    groups.get(folded).push(key);
  }

  const collisions = [];

  for (const [folded, spellings] of groups) {
    const target = canonicalKey(canonical, spellings[0]);
    merged[target] = source[spellings[0]];

    if (spellings.length > 1) {
      collisions.push({ folded, spellings, kept: target });
      for (let i = 1; i < spellings.length; i += 1) {
        // Fold the variant onto the canonical key so neither document is lost.
        // The canonical record wins on conflict: it is the spelling this system
        // settled on, and a duplicate must never overwrite it.
        merged[target] = Object.assign({}, source[spellings[i]], merged[target]);
      }
    }
  }

  return { merged, collisions };
}

module.exports = {
  buildCanonicalKeys,
  canonicalKey,
  mergeCaseVariantKeys
};
