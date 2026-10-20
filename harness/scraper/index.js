'use strict'

/**
 * V8-native portal scanner (plan 4.1 §4).
 *
 * Single-account port of the legacy orchestrator's per-account flow, with the
 * same rules it followed:
 *   login -> workspace company -> documents -> obligations -> messages ->
 *   payments -> secretary tasks.
 *
 * Deliberate differences, all in V8's favor:
 *   - One account per call: V8's harness loop owns iteration, parking, and
 *     failure accounting (account_status), so the legacy login-failure register
 *     is not used here.
 *   - No email, no dashboard, no AI supervision: V8 delivers through its own
 *     channels and assistant.
 *   - No "sent" tracking: with no outbound mail, every document is read fresh;
 *     V8's ingest dedupes by natural key.
 *   - Registers (obligations/payments/messages/company-registry) live under
 *     v8/data, never in the working directory.
 *
 * The result object honors the exact contract harness/run-account.js validates
 * and harness/ingest.js maps: {account, login, tasks, obligations, payments,
 * messages, diffs}.
 */

const path = require('node:path')
const { AuthError } = require('./common/errors')
const { defaultLogger } = require('./common/logger')
const { BrowserManager } = require('./automation/browser-manager')
const { loginToKeycloak } = require('./automation/login')
const { DocumentsService } = require('./automation/documents')
const { PdfDownloader } = require('./automation/pdf-downloader')
const { PaymentsScraper } = require('./automation/portal/payments-scraper')
const { CompanyRegistry, resolveCompanyName } = require('./config/company-registry')
const { KNOWN_ACCOUNT_ALIASES } = require('./config/accounts-parser')
const { TaskEngine } = require('./tasks/task-engine')
const { ObligationStore } = require('./obligations/obligation-store')
const { PaymentsStore } = require('./storage/payments-store')
const { MessageStore } = require('./messages/message-store')
const { SentTracker } = require('./storage/sent-tracker')
const { loadScanConfig } = require('./config')

/* With no summary email there is nothing "already sent"; the interface stays so
   DocumentsService runs unmodified. */
const NOOP_SENT_TRACKER = Object.freeze({
  hasBeenSent: () => false,
  getSentRecord: () => null,
  markSent: () => {}
})

function emptyResult(username, label, login) {
  return {
    account: { key: username, label },
    login,
    tasks: [],
    obligations: [],
    payments: [],
    messages: [],
    diffs: []
  }
}

/**
 * Scans one configured account, read-only.
 *
 * @param {string} accountKey Portal username (the accounts table key).
 * @param {{credentials?: {username: string, label: string, password: string},
 *   config?: Object}} [options] `credentials` lets tests inject an account
 *   without touching the database; production resolves them from the accounts
 *   store.
 * @returns {Promise<Object>} The scan result contract.
 */
async function scanAccount(accountKey, options = {}) {
  if (typeof accountKey !== 'string' || !accountKey.trim()) {
    throw new Error('Account key is required')
  }
  const username = accountKey.trim()
  const config = options.config || loadScanConfig()
  const credentials = options.credentials ||
    require('../accounts').getCredentials(username)
  const label = credentials.label || credentials.username

  const stores = {
    obligations: new ObligationStore(path.join(config.dataDir, 'obligations.json')),
    payments: new PaymentsStore(path.join(config.dataDir, 'payments.json')),
    messages: new MessageStore(path.join(config.dataDir, 'messages.json')),
    registry: new CompanyRegistry(path.join(config.dataDir, 'company-registry.json'))
  }
  const docService = new DocumentsService({
    pdfDownloader: new PdfDownloader(config.downloadsDir),
    sentTracker: NOOP_SENT_TRACKER,
    maxDocs: config.maxDocsPerAccount
  })
  const browserManager = new BrowserManager({
    headed: config.headedMode,
    slowMoMs: config.slowMoMs
  })
  const monthKey = SentTracker.getMonthKey(new Date())

  try {
    await browserManager.init()
    const context = await browserManager.createIsolatedContext(label)
    try {
      const page = await context.newPage()

      await loginToKeycloak(page, credentials.username, credentials.password, {
        timeoutMs: config.keycloakTimeoutMs
      })

      const workspaceCompany = await docService.scrapeWorkspaceCompany(page, credentials.username, {
        timeoutMs: Math.min(config.sapTimeoutMs, 15000),
        navigateIfNeeded: !page.url().includes('workspace.eta.gov.eg')
      })

      await docService.navigateToDocuments(page, config.sapTimeoutMs)
      const accountDocs = await docService.processAccountDocuments(
        page, context, label, monthKey)

      // Company name resolution tiers: workspace link -> registry -> alias ->
      // SAP UserProfile, exactly as the legacy orchestrator ordered them.
      let resolved = resolveCompanyName({
        portalAccountId: credentials.username,
        accountLabel: label,
        workspaceCompany,
        registry: stores.registry,
        aliases: KNOWN_ACCOUNT_ALIASES
      })
      if (!resolved.name) {
        const profileTitle = await docService.scrapeAccountTitle(
          page, credentials.username, config.sapTimeoutMs)
        resolved = resolveCompanyName({
          portalAccountId: credentials.username,
          accountLabel: label,
          workspaceCompany,
          sapProfileName: profileTitle,
          registry: stores.registry,
          aliases: KNOWN_ACCOUNT_ALIASES
        })
      }
      if (resolved.name &&
          (resolved.source === 'workspace_link' || resolved.source === 'sap_profile')) {
        stores.registry.set(credentials.username, {
          companyName: resolved.name,
          companyId: resolved.companyId,
          href: resolved.href,
          source: resolved.source
        })
      }

      const companyName = resolved.name || label || credentials.username

      // Filing obligations: the pending view drives the register; the complete
      // view reconciles it, but only when that read is known to be complete —
      // a partial read must never mark live obligations as missing.
      try {
        const pendingRows = await docService.scrapeAccountObligations(
          page, credentials.username, companyName, { timeoutMs: 15000 })
        if (pendingRows && pendingRows.length > 0) {
          await stores.obligations.ingestPortalObligationsSerialized({
            companyKey: credentials.username,
            companyName,
            scrapedRows: pendingRows
          })
        }
        let allRows = []
        let allReadComplete = false
        try {
          const allResult = await docService.scrapeAllObligations(
            page, credentials.username, companyName, { timeoutMs: 15000 })
          allRows = (allResult && allResult.rows) || []
          allReadComplete = Boolean(allResult && allResult.complete === true)
        } catch (allError) {
          defaultLogger.warn(
            `Could not read the complete obligations view for ${label}: ${allError.message}`)
        }
        if (allReadComplete) {
          await stores.obligations.reconcilePortalObligationsSerialized({
            companyKey: credentials.username,
            scrapedRows: allRows,
            complete: true
          })
        } else {
          defaultLogger.warn(
            `Skipping obligation reconciliation for ${label}: the complete view could not be read.`)
        }
      } catch (obligationError) {
        defaultLogger.warn(
          `Non-blocking failure scanning obligations for ${label}: ${obligationError.message}`)
      }

      // Portal messages and alerts.
      try {
        const scrapedMessages = await docService.scrapeAccountMessages(
          page, credentials.username, companyName, {
            timeoutMs: 15000,
            existingMessages: stores.messages.getAccountMessages(credentials.username)
          })
        if (scrapedMessages && scrapedMessages.length > 0) {
          stores.messages.ingestBatch(scrapedMessages)
        }
      } catch (messageError) {
        defaultLogger.warn(
          `Non-blocking failure scanning messages for ${label}: ${messageError.message}`)
      }

      // Payment claims from ETA Workspace: account-local and non-fatal. A
      // partial read records "unread" instead of pretending nothing is owed.
      if (!resolved.companyId) {
        defaultLogger.warn(
          `Payments not read for ${label}: the company registry has no Workspace company id.`)
      } else {
        try {
          const paymentsResult = await new PaymentsScraper().scrape(
            page, resolved.companyId, {
              companyKey: credentials.username,
              companyName,
              timeoutMs: 45000,
              logger: defaultLogger
            })
          if (paymentsResult && paymentsResult.complete === true) {
            await stores.payments.ingestPaymentsSerialized({
              companyKey: credentials.username,
              companyId: resolved.companyId,
              companyName,
              rows: paymentsResult.rows || [],
              complete: true,
              unfiltered: paymentsResult.unfiltered === true,
              filterLabel: paymentsResult.filterLabel || '',
              asOf: new Date()
            })
          } else {
            const reason = paymentsResult && paymentsResult.reason
              ? paymentsResult.reason
              : ((paymentsResult && paymentsResult.rows && paymentsResult.rows.length > 0)
                ? 'partial_read'
                : 'table_not_found')
            await stores.payments.recordUnread({ companyId: resolved.companyId, reason })
            defaultLogger.warn(
              `Payments for ${label} were not fully read (${reason}); claims are left as they were.`)
          }
        } catch (paymentError) {
          defaultLogger.warn(
            `Non-blocking failure scanning payments for ${label}: ${paymentError.message}`)
          await stores.payments.recordUnread({
            companyId: resolved.companyId,
            reason: 'scrape_failed'
          }).catch(() => {})
        }
      }

      // Secretary tasks from this account's document summaries.
      const taskEngine = new TaskEngine({
        activeUsernames: new Set([credentials.username])
      })
      const taskResult = taskEngine.processSummaries([{
        account: companyName,
        profileNameStatus: resolved.name ? 'verified_eta_profile' : 'unavailable',
        companyNameSource: resolved.source,
        companyId: resolved.companyId || '',
        username: credentials.username,
        docs: accountDocs
      }])

      return {
        account: { key: credentials.username, label: companyName },
        login: { success: true, rejected: false, skipped: false },
        tasks: taskResult.tasks,
        obligations: stores.obligations.getCompanyObligations(credentials.username),
        payments: stores.payments.getAllPayments().filter((item) =>
          item.accountKey === credentials.username ||
          item.companyKey === credentials.username ||
          (resolved.companyId && item.companyId === resolved.companyId)),
        messages: stores.messages.getAccountMessages(credentials.username),
        diffs: []
      }
    } finally {
      // Context cleanup is guaranteed even when the scan throws (RULE 5).
      await browserManager.closeContext(context, label)
    }
  } catch (error) {
    // A rejected login is returned as a failed result, matching the contract
    // the harness expects: it turns `login.success !== true` into the account
    // failure and backoff. Everything else propagates.
    if (error instanceof AuthError) {
      defaultLogger.warn(`Login rejected for ${label}: ${error.message}`)
      return emptyResult(credentials.username, label, {
        success: false, rejected: true, skipped: false
      })
    }
    throw error
  } finally {
    await browserManager.destroy()
  }
}

module.exports = { NOOP_SENT_TRACKER, emptyResult, scanAccount }

