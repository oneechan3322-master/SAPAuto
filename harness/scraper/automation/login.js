/**
 * Keycloak Authentication Automation for Egyptian Tax Authority (ETA).
 * Adheres to RULE 1, RULE 2, RULE 3, RULE 4, RULE 6, RULE 7, RULE 10.
 */

const { AuthError, ValidationError, AutomationError } = require('../common/errors');
const { assertNonEmptyString } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');

const DEFAULT_AUTH_URL =
  'https://auth.eta.gov.eg:8080/auth/realms/e-tax/protocol/openid-connect/auth?client_id=etax-sso&redirect_uri=https%3A%2F%2Fworkspace.eta.gov.eg%2F&state=dcfa84c0-1b19-4e8f-810f-24a4f0ed0b4d&response_mode=fragment&response_type=code&scope=openid&nonce=3cf27fa5-da7e-4ae3-8437-c39ec225e440&ui_locales=ar&code_challenge=v0ZcOk2Kxj68P98zhFiz5lTGe1qkL9mY3xPvbGQawl0&code_challenge_method=S256&referrer=etax-sso&referrer_uri=https%3A%2F%2Fworkspace.eta.gov.eg%2F';

const FALLBACK_WORKSPACE_URL = 'https://workspace.eta.gov.eg/';

/**
 * Failure classification for the login attempt.
 *
 * Only `credentials_rejected` may feed the login-failure backoff. Navigation
 * timeouts and a missing login form are our problem or the network's, and
 * counting them as rejected logins would lock out healthy accounts.
 * @type {'credentials_rejected'|'login_form_unavailable'|'navigation_failed'}
 */

/**
 * Logs into ETA portal using Keycloak form.
 *
 * @param {import('playwright').Page} page
 * @param {string} username
 * @param {string} password
 * @param {Object} [options={}]
 * @param {number} [options.timeoutMs=60000]
 * @param {string} [options.authUrl]
 * @returns {Promise<boolean>}
 */
async function loginToKeycloak(page, username, password, options = {}) {
  if (!page || typeof page.goto !== 'function') {
    throw new ValidationError('A valid Playwright Page instance is required', { page });
  }
  const u = assertNonEmptyString(username, 'username', 'loginToKeycloak');
  const p = assertNonEmptyString(password, 'password', 'loginToKeycloak');
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 60000;
  const targetUrl = options.authUrl || DEFAULT_AUTH_URL;
  /** @type {'credentials_rejected'|'login_form_unavailable'|'navigation_failed'} */
  let stage = 'navigation_failed';

  defaultLogger.info(`Navigating to ETA Keycloak login for user: ${u}...`);

  try {
    // 1. Navigate to auth URL with explicit timeout
    let navResponse = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    // Check if the auth URL expired or failed with error status
    if (navResponse && navResponse.status() >= 400) {
      defaultLogger.warn(`Initial auth URL returned status ${navResponse.status()}. Trying workspace fallback...`);
      navResponse = await page.goto(FALLBACK_WORKSPACE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });
    }

    // 2. Wait for username input field
    const userInputSelector = 'input#username, input[name="username"]';
    stage = 'login_form_unavailable';
    await page.waitForSelector(userInputSelector, { state: 'visible', timeout: timeoutMs });

    defaultLogger.info(`Filling credentials for ${u}...`);

    // 3. Clear and type credentials
    await page.fill(userInputSelector, '');
    await page.fill(userInputSelector, u);

    const passwordSelector = 'input#password, input[name="password"]';
    await page.fill(passwordSelector, '');
    await page.fill(passwordSelector, p);

    // 4. Click Submit button
    const submitSelector = 'input#kc-login, button[type="submit"], input[type="submit"]';
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch((e) => {
        defaultLogger.debug(`Navigation wait caught: ${e.message}`);
      }),
      page.click(submitSelector)
    ]);

    // 5. Verify outcome
    stage = 'credentials_rejected';
    // Check if error banner appeared on page
    const alertSelector = '.alert-error, .alert.alert-danger, .kc-feedback-text, span.kc-feedback-text';
    const alertElem = await page.$(alertSelector);
    if (alertElem) {
      const errorText = await alertElem.innerText();
      if (!options._retriedSeparator && (u.includes('-') || u.includes('_'))) {
        const altUsername = u.includes('-') ? u.replace(/-/g, '_') : u.replace(/_/g, '-');
        defaultLogger.info(`Retrying login with alternative username separator: ${altUsername}...`);
        return loginToKeycloak(page, altUsername, p, { ...options, _retriedSeparator: true });
      }
      // The banner is portal-supplied text: keep it in the log context only.
      // It must never be persisted or sent to a model as a reason code.
      throw new AuthError(`Keycloak rejected the login attempt for ${u}: ${errorText.trim()}`, {
        username: u,
        reason: 'credentials_rejected'
      });
    }

    // Check if we are still on the login form
    const stillOnLoginForm = await page.$('form#kc-form-login');
    if (stillOnLoginForm) {
      throw new AuthError(`Authentication failed for ${u}: Still on login page after submit`, {
        username: u,
        reason: 'credentials_rejected',
        currentUrl: page.url()
      });
    }

    defaultLogger.info(`Keycloak login successful for ${u}. Current URL: ${page.url()}`);
    return true;
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    // Everything else is a navigation or form-availability problem, not a
    // rejected credential. Classify it as such so the backoff register is
    // never polluted by network noise.
    const context = {
      username: u,
      reason: stage,
      currentUrl: (() => {
        try {
          return page.url();
        } catch (urlErr) {
          return null;
        }
      })()
    };
    if (stage === 'credentials_rejected') {
      throw new AuthError(`Keycloak login error for ${u}: ${err.message}`, context, err);
    }
    throw new AutomationError(`ETA portal unreachable for ${u}: ${err.message}`, context, err);
  }
}

module.exports = {
  loginToKeycloak,
  DEFAULT_AUTH_URL,
  FALLBACK_WORKSPACE_URL
};
