/**
 * Statutory penalty bands for late filing.
 *
 * Why this module exists: `urgency` treats "overdue" as one flat state, but the
 * cost of being late is not flat. Under the Unified Tax Procedures Law the
 * penalty band changes at 60 days past due, and the two bands are an order of
 * magnitude apart. A task at -59 days and a task at -61 days look identical in
 * the current model and are not comparable in reality.
 *
 * Statutory ranges (PwC, unified tax procedures law):
 *   - Late filing up to 60 days past due: EGP 3,000 - 50,000.
 *   - Beyond 60 days: EGP 50,000 - 2,000,000.
 *   - Repeat offences can be multiplied (doubled or tripled); the larger band's
 *     recurrence is measured over a three-year window.
 *   - Penalties may be reduced by 50% when settled with the ETA before the case
 *     reaches the Appeal Committee.
 *   - Statute of limitations: five years, six where evasion is involved.
 *
 * This is decision support for a tax office, not a tax opinion. Every band
 * therefore carries the range *and* its basis, and `advisory` is false: nothing
 * here asserts what a company will actually owe, only what the statute says the
 * band is. Callers must present the range with the source attached.
 *
 * Adheres to RULE 3 (NO SILENT FAILURES), RULE 7 (FAIL-SAFE DEFAULTS).
 */

/** Days past due at which the statutory band changes. */
const BAND_BOUNDARY_DAYS = 60;

/** @typedef {'not_late'|'within_60'|'beyond_60'} PenaltyBand */

const BANDS = Object.freeze({
  not_late: Object.freeze({
    band: 'not_late',
    daysOverdue: 0,
    label: 'within deadline',
    labelAr: 'قبل الموعد',
    statutoryRange: null,
    basis: null,
    advisory: false
  }),
  within_60: Object.freeze({
    band: 'within_60',
    daysOverdue: null,
    label: 'within 60 days past due',
    labelAr: 'تأخير أقل من 60 يوماً',
    statutoryRange: 'EGP 3,000 - 50,000',
    basis: 'Unified Tax Procedures Law late-filing band, up to 60 days past due (PwC).',
    advisory: false
  }),
  beyond_60: Object.freeze({
    band: 'beyond_60',
    daysOverdue: null,
    label: 'beyond 60 days past due',
    labelAr: 'تأخير أكثر من 60 يوماً',
    statutoryRange: 'EGP 50,000 - 2,000,000',
    basis: 'Unified Tax Procedures Law late-filing band beyond 60 days past due (PwC). Repeat offences may be multiplied; the larger band recurs over a three-year window.',
    advisory: false
  })
});

/**
 * Classifies how late an item is for penalty purposes.
 *
 * The boundary is inclusive at 60: an item 60 days past due is still in the
 * lower band, and 61 days past due has crossed into the higher one.
 *
 * @param {number} daysLeft Negative means overdue. See `evaluateUrgency`.
 * @returns {{band: PenaltyBand, daysOverdue: number, label: string, labelAr: string, statutoryRange: string|null, basis: string|null, advisory: boolean}}
 */
function evaluatePenaltyBand(daysLeft) {
  if (!Number.isFinite(daysLeft)) {
    // An unknown deadline is not evidence of lateness. Reporting it as overdue
    // would invent a liability.
    return { ...BANDS.not_late };
  }

  if (daysLeft >= 0) {
    return { ...BANDS.not_late };
  }

  const daysOverdue = Math.abs(Math.trunc(daysLeft));

  if (daysOverdue <= BAND_BOUNDARY_DAYS) {
    return { ...BANDS.within_60, daysOverdue };
  }

  return { ...BANDS.beyond_60, daysOverdue };
}

/**
 * Classifies for an item that may already be satisfied.
 *
 * A submitted or closed obligation cannot be penalised for lateness, so it is
 * reported as `not_late` regardless of its deadline.
 *
 * @param {number} daysLeft
 * @param {Object} [item]
 * @param {boolean} [item.submitted]
 * @param {string} [item.status]
 * @returns {ReturnType<typeof evaluatePenaltyBand>}
 */
function evaluatePenaltyBandForObligation(daysLeft, item = {}) {
  const submitted = item && (item.submitted === true || item.status === 'submitted');
  if (submitted) {
    return { ...BANDS.not_late };
  }
  return evaluatePenaltyBand(daysLeft);
}

/**
 * One-line, non-advisory description for a digest or card.
 * @param {ReturnType<typeof evaluatePenaltyBand>} band
 * @returns {string}
 */
function describePenaltyBand(band) {
  if (!band || band.band === 'not_late') {
    return '';
  }
  return `${band.labelAr} (${band.daysOverdue} يوم) — نطاق الغرامة التقديري: ${band.statutoryRange}`;
}

module.exports = {
  BAND_BOUNDARY_DAYS,
  BANDS,
  evaluatePenaltyBand,
  evaluatePenaltyBandForObligation,
  describePenaltyBand
};
