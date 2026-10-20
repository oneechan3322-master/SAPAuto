'use strict'

/**
 * Account Verifier Module.
 * Connects to ETA Keycloak with the account credentials and extracts the
 * authoritative company name from the ETA Workspace dashboard without running
 * a full scan.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 5: Resource acquisition/release (always close context/browser)
 * - RULE 6: Bounded operations (explicit timeouts)
 * - RULE 7: Fail-safe defaults
 */

const { BrowserManager } = require('./scraper/automation/browser-manager')
const { loginToKeycloak } = require('./scraper/automation/login')
const { DocumentsService } = require('./scraper/automation/documents')
const { PdfDownloader } = require('./scraper/automation/pdf-downloader')
const { loadScanConfig } = require('./scraper/config')
const { defaultLogger } = require('./scraper/common/logger')

const NOOP_SENT_TRACKER = Object.freeze({
  hasBeenSent: () => false,
  getSentRecord: () => null,
  markSent: () => {}
})

/**
 * Verifies credentials and retrieves company name from ETA Workspace.
 * @param {string} username
 * @param {string} password
 * @param {Object} [options={}]
 * @returns {Promise<{ ok: boolean, companyName?: string, companyId?: string, error?: string }>}
 */
async function verifyAndFetchCompanyName(username, password, options = {}) {
  if (typeof username !== 'string' || !username.trim()) {
    return { ok: false, error: 'اسم المستخدم مطلوب للتحقق' }
  }
  if (typeof password !== 'string' || !password.trim()) {
    return { ok: false, error: 'كلمة المرور مطلوبة للتحقق' }
  }

  const config = options.config || loadScanConfig()
  const timeoutMs = options.timeoutMs || 45000

  const browserManager = new BrowserManager({
    headed: false,
    slowMoMs: 50
  })

  const docService = new DocumentsService({
    pdfDownloader: new PdfDownloader(config.downloadsDir),
    sentTracker: NOOP_SENT_TRACKER,
    maxDocs: 1
  })

  try {
    await browserManager.init()
    const context = await browserManager.createIsolatedContext(username)
    try {
      const page = await context.newPage()

      defaultLogger.info(`[Verifier] Attempting ETA login for ${username}...`)
      await loginToKeycloak(page, username.trim(), password.trim(), {
        timeoutMs: Math.min(timeoutMs, 30000)
      })

      defaultLogger.info(`[Verifier] Login successful for ${username}. Reading workspace company...`)
      const workspaceCompany = await docService.scrapeWorkspaceCompany(page, username.trim(), {
        timeoutMs: 15000,
        navigateIfNeeded: !page.url().includes('workspace.eta.gov.eg')
      })

      if (workspaceCompany && workspaceCompany.companyName) {
        defaultLogger.info(`[Verifier] Resolved company name for ${username}: "${workspaceCompany.companyName}"`)
        return {
          ok: true,
          companyName: workspaceCompany.companyName,
          companyId: workspaceCompany.companyId
        }
      }

      return {
        ok: true,
        companyName: username.trim(),
        warning: 'تم التحقق من الحساب بنجاح ولكن تعذر قراءة اسم الشركة من الرابط المباشر'
      }
    } finally {
      await browserManager.closeContext(context).catch(() => null)
    }
  } catch (err) {
    defaultLogger.warn(`[Verifier] Verification failed for ${username}: ${err.message}`)
    return {
      ok: false,
      error: err.message.includes('rejected') || err.message.includes('auth')
        ? 'بيانات تسجيل الدخول غير صحيحة، رفضت بوابة الضرائب المصادقة'
        : `فشل التحقق من الحساب عبر البوابة: ${err.message}`
    }
  } finally {
    await browserManager.close().catch(() => null)
  }
}

module.exports = {
  verifyAndFetchCompanyName
}
