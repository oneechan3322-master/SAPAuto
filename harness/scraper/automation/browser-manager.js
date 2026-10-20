/**
 * Playwright Browser and Isolated Context Lifecycle Manager.
 * Adheres to RULE 1, RULE 2, RULE 3, RULE 5 (RESOURCE CLEANUP), RULE 6 (BOUNDED TIME).
 */

const { chromium } = require('playwright');
const { AutomationError, ValidationError } = require('../common/errors');
const { assertNonEmptyString, assertNumberInRange } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');

class BrowserManager {
  /**
   * @param {Object} options
   * @param {boolean} [options.headed=true]
   * @param {number} [options.slowMoMs=100]
   */
  constructor(options = {}) {
    this.headed = Boolean(options.headed);
    this.slowMoMs = typeof options.slowMoMs === 'number' ? options.slowMoMs : 100;
    this.browser = null;
    this.activeContexts = new Set();
  }

  /**
   * Initializes the Chromium browser instance.
   */
  async init() {
    if (this.browser) {
      return this.browser;
    }

    try {
      defaultLogger.info(`Launching browser (headed=${this.headed}, slowMo=${this.slowMoMs}ms)...`);
      const launchOptions = {
        headless: !this.headed,
        slowMo: this.slowMoMs,
        args: [
          '--disable-web-security',
          '--allow-running-insecure-content',
          '--ignore-certificate-errors',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      };

      // Try Chrome first, then Edge, then default Chromium
      try {
        this.browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
      } catch (chromeErr) {
        defaultLogger.warn(`Chrome channel unavailable (${chromeErr.message}). Falling back to Edge...`);
        try {
          this.browser = await chromium.launch({ ...launchOptions, channel: 'msedge' });
        } catch (edgeErr) {
          defaultLogger.warn(`Edge channel unavailable (${edgeErr.message}). Falling back to Chromium...`);
          this.browser = await chromium.launch(launchOptions);
        }
      }

      if (!this.browser) {
        throw new AutomationError('Browser failed to launch, returned null/undefined');
      }

      return this.browser;
    } catch (err) {
      throw new AutomationError(`Failed to initialize browser: ${err.message}`, {
        headed: this.headed,
        slowMoMs: this.slowMoMs
      }, err);
    }
  }

  /**
   * Creates a dedicated, isolated browser context for an account.
   * Ensures 100% cookie and local storage isolation between different accounts.
   * @param {string} accountIdentifier - Username or unique label
   * @returns {Promise<import('playwright').BrowserContext>}
   */
  async createIsolatedContext(accountIdentifier) {
    const accId = assertNonEmptyString(accountIdentifier, 'accountIdentifier', 'createIsolatedContext');

    if (!this.browser) {
      await this.init();
    }

    try {
      defaultLogger.info(`Creating fresh isolated browser context for account: ${accId}`);
      const context = await this.browser.newContext({
        ignoreHTTPSErrors: true,
        locale: 'ar-EG',
        timezoneId: 'Africa/Cairo',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1400, height: 900 },
        acceptDownloads: true
      });

      this.activeContexts.add(context);
      return context;
    } catch (err) {
      throw new AutomationError(`Failed to create browser context for account ${accId}: ${err.message}`, {
        accountIdentifier: accId
      }, err);
    }
  }

  /**
   * Safely closes an isolated browser context and purges its temporary state.
   * @param {import('playwright').BrowserContext} context
   * @param {string} accountIdentifier
   */
  async closeContext(context, accountIdentifier) {
    if (!context) {
      return;
    }

    try {
      defaultLogger.info(`Closing isolated context for account: ${accountIdentifier}`);
      await context.close();
      this.activeContexts.delete(context);
    } catch (err) {
      defaultLogger.error(`Error closing context for account ${accountIdentifier}: ${err.message}`, {
        accountIdentifier
      }, err);
    }
  }

  /**
   * Cleans up all resources, active contexts, and shuts down the browser.
   */
  async destroy() {
    defaultLogger.info('Destroying browser manager and closing all active contexts...');

    for (const context of this.activeContexts) {
      try {
        await context.close();
      } catch (ctxErr) {
        defaultLogger.warn(`Warning closing orphan context: ${ctxErr.message}`);
      }
    }
    this.activeContexts.clear();

    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        defaultLogger.info('Browser successfully closed.');
      } catch (browserErr) {
        defaultLogger.error(`Failed to cleanly close browser: ${browserErr.message}`, {}, browserErr);
      }
    }
  }
}

module.exports = {
  BrowserManager
};
