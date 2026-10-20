/**
 * ETA Portal SAP MCF Routes and Constants.
 * Centralized definition of all portal routes and filter options.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 7: Fail-safe defaults
 */

const { ValidationError } = require('../../common/errors');

const SAP_PORTAL_BASE = 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar';
// Workspace exposes this as a separate external SAP application. It is a
// destination only; it does not share the Workspace payments data contract.
const SAP_PAYROLL_PORTAL_URL = 'https://uptp.eta.gov.eg/sap/bc/ui5_ui5/sap/ZMCF_PAYROLL/index.html?sap-client=300&sap-language=AR';
// The Payroll portal's filing-obligations view is the supported destination for
// now. Keep it explicit: this route belongs to a different SAP application
// from the MCF filing-obligations route above.
const SAP_PAYROLL_FILING_OBLIGATIONS_URL = `${SAP_PAYROLL_PORTAL_URL}#/filing_obligations`;

const PORTAL_ROUTES = Object.freeze({
  DOCUMENTS: `${SAP_PORTAL_BASE}#/documents`,
  FILING_OBLIGATIONS: `${SAP_PORTAL_BASE}#/filing_obligations`,
  FORMS: `${SAP_PORTAL_BASE}#/forms`,
  MESSAGES: `${SAP_PORTAL_BASE}#/messages`,
  MESSAGES_AL: `${SAP_PORTAL_BASE}#/messages/AL`,
  USER_PROFILE: `${SAP_PORTAL_BASE}#/user_profile`
});

/**
 * Hash-only routes.
 *
 * Separate from PORTAL_ROUTES because `window.location.hash = ...` wants the
 * fragment alone. Assigning the full absolute URL to `hash` produces a broken
 * route on every portal screen.
 *
 * `MESSAGES_AL_FIRST` keeps its encoded space deliberately: the `%20` before
 * the index is part of the SAP backend record key, not stray whitespace.
 * Decoding it yields `#/messages/AL/1`, which does not exist.
 */
const PORTAL_HASHES = Object.freeze({
  DOCUMENTS: '#/documents',
  FILING_OBLIGATIONS: '#/filing_obligations',
  FORMS: '#/forms',
  MESSAGES: '#/messages',
  MESSAGES_AL: '#/messages/AL',
  MESSAGES_AL_FIRST: '#/messages/AL/%201'
});

/**
 * Filter options for #/filing_obligations
 */
const FILING_OBLIGATION_FILTERS = Object.freeze({
  NOT_FILED: 'notFiled',       // لم يتم التقديم (default)
  ALL: 'all'                   // الكل
});

/**
 * Filter options for #/forms
 */
const FORMS_FILTERS = Object.freeze({
  DRAFT: 'draft',              // مسودة
  SUBMITTED: 'submitted',      // تم تقديمه
  UNDER_REVIEW: 'underReview',  // تحت المراجعة
  FINALIZED: 'finalized',      // مغلق نهائي
  EDITABLE: 'editable'         // قابل للتعديل
});

/**
 * ETA Workspace base.
 *
 * A different portal from the SAP MCF one above: this is the Angular/F5 Workspace
 * app, and it addresses a company by its workspace id, not by a route hash.
 */
const WORKSPACE_BASE = 'https://workspace.eta.gov.eg';

/**
 * Builds the Workspace payments URL for one company.
 *
 * The id goes into the path, so anything that is not a bare digit string is
 * rejected rather than escaped. A tampered id would otherwise turn a read-only
 * GET into a request for a different company — or, with a slash and a query
 * string in the value, into some other endpoint entirely.
 *
 * @param {string} companyId - Workspace company id, digits only.
 * @returns {string} Absolute payments URL.
 * @throws {ValidationError} When the id is not a non-empty digit string.
 */
function workspaceCompanyPaymentsUrl(companyId) {
  if (typeof companyId !== 'string' || !/^\d+$/.test(companyId.trim())) {
    throw new ValidationError(
      `workspaceCompanyPaymentsUrl requires a digits-only company id, got: ${JSON.stringify(companyId)}`
    );
  }
  return `${WORKSPACE_BASE}/workspace/company/${companyId.trim()}/payments`;
}

module.exports = {
  SAP_PORTAL_BASE,
  SAP_PAYROLL_PORTAL_URL,
  SAP_PAYROLL_FILING_OBLIGATIONS_URL,
  WORKSPACE_BASE,
  workspaceCompanyPaymentsUrl,
  PORTAL_ROUTES,
  PORTAL_HASHES,
  FILING_OBLIGATION_FILTERS,
  FORMS_FILTERS
};
