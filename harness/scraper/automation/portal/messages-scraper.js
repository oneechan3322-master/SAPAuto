/**
 * Portal Messages & Notifications Scraper.
 * Specialized scraper for ETA portal route `#/messages` and `#/messages/AL/...`.
 *
 * Scrapes official portal messages, alerts, and letters:
 * - درجة الخطورة (Severity: e.g. معلومات, تنبيه, هام)
 * - النوع (Type)
 * - الموضوع (Subject: e.g. إقرار بالمستندات المقدمة)
 * - نص الرسالة (Message Body)
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 10: Defensive redundancy (IDs + semantic label matching)
 */

const { defaultLogger } = require('../../common/logger');
const { assertNonEmptyString } = require('../../common/assertions');
const { PORTAL_ROUTES, PORTAL_HASHES } = require('./portal-urls');
const {
  readLabelledField,
  supportsUi5Helpers,
  navigateToHash,
  waitForTableStable,
  extractUi5Table,
  normalizeArabic
} = require('./ui5-helpers');

const MAX_MESSAGES_COUNT = 50;

/**
 * The visible labels of each field on a message detail view.
 *
 * Several spellings per field, because the portal is inconsistent about hamza
 * and about whether a label carries a trailing colon. `readLabelledField`
 * normalises before matching, so these need not be pre-normalised here.
 *
 * This replaces the generated input and textarea ids the scraper used before,
 * which come from a global counter and change whenever the view is opened in a
 * different order.
 */
const DETAIL_FIELD_LABELS = Object.freeze({
  severity: ['درجة الخطورة', 'الأهمية'],
  msgType: ['نوع الرسالة', 'النوع'],
  subject: ['الموضوع', 'عنوان الرسالة'],
  body: ['نص الرسالة', 'الرسالة', 'النص']
});

class MessagesScraper {
  /**
   * Scrapes official messages and letters from ETA portal.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} [companyName]
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs=15000]
   * @returns {Promise<Array<Object>>}
   */
  async scrape(page, accountKey, companyName = '', options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      defaultLogger.warn('MessagesScraper.scrape called without valid Playwright page.');
      return [];
    }
    const safeKey = assertNonEmptyString(accountKey, 'accountKey', 'MessagesScraper.scrape');
    const safeCompany = companyName || safeKey;
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;

    const scrapedMessages = [];

    try {
      defaultLogger.info(`[MessagesScraper] Scanning #/messages for ${safeCompany} (${safeKey})...`);

      const currentUrl = String(await page.url());

      // Already on a detail view: read the labels rather than navigating away.
      if (currentUrl.includes('#/messages/AL/')) {
        const detailMessage = await this._extractMessageDetails(page, safeKey, safeCompany);
        if (detailMessage) {
          scrapedMessages.push(detailMessage);
          return scrapedMessages;
        }
        // The route looked like a detail view but held nothing readable. That is
        // a miss, not an empty inbox, so it is logged rather than returning [].
        defaultLogger.warn(`[MessagesScraper] ${safeKey}: on a message detail route but read no fields.`);
      }

      await navigateToHash(page, PORTAL_HASHES.MESSAGES_AL, 3000);

      if (supportsUi5Helpers(page)) {
        await waitForTableStable(page, { timeoutMs }).catch(() => null);
      }

      // The list view: each entry is a row or a list item.
      const rowSelector = 'tr.sapMListTblRow:not(.sapMListTblHeader), div.sapMLIB';
      const list = await extractUi5Table(page, rowSelector, MAX_MESSAGES_COUNT).catch(() => null);

      const entryTexts = [];
      if (list && list.ok && list.rows.length > 0) {
        for (const cells of list.rows) {
          const text = cells.filter(Boolean).join(' ').trim();
          if (text.length > 0) entryTexts.push(text);
        }
      } else if (list && list.ok) {
        // No list rows: the view may already be showing a single message.
        const singleMsg = await this._extractMessageDetails(page, safeKey, safeCompany);
        if (singleMsg) {
          scrapedMessages.push(singleMsg);
        }
      } else {
        defaultLogger.warn(`[MessagesScraper] ${safeKey}: could not read the message list.`);
      }

      if (entryTexts.length > 0) {
        defaultLogger.info(`[MessagesScraper] Found ${entryTexts.length} message entry(s) for ${safeKey}.`);
        const limit = Math.min(entryTexts.length, MAX_MESSAGES_COUNT);

        // Check which messages are already known and detailed
        const knownDetailIds = new Set();
        if (options && options.knownDetailIds instanceof Set) {
          for (const id of options.knownDetailIds) knownDetailIds.add(id);
        } else if (options && Array.isArray(options.existingMessages)) {
          for (const m of options.existingMessages) {
            if (m && m.body && String(m.body).trim().length > 0) {
              knownDetailIds.add(m.id || m.portalMessageId);
            }
          }
        }

        // Identify which items are NEW (not already read inside)
        const maxDeepRead = Math.min(3, limit);
        let deepReadCount = 0;

        for (let i = 0; i < limit; i++) {
          const msgId = `${safeKey}::msg::${i + 1}`;
          const isKnown = knownDetailIds.has(msgId);

          let detail = null;
          if (!isKnown && deepReadCount < maxDeepRead) {
            try {
              const currentRows = await page.$$(rowSelector);
              if (currentRows[i]) {
                defaultLogger.info(`[MessagesScraper] Reading inside new message #${i + 1} for ${safeKey}...`);
                await currentRows[i].click({ timeout: 3500 }).catch(() => null);
                await page.waitForTimeout(1200);
                detail = await this._extractMessageDetails(page, safeKey, safeCompany);
                deepReadCount++;
                // Navigate back to the list
                await navigateToHash(page, PORTAL_HASHES.MESSAGES_AL, 2000).catch(() => null);
                if (supportsUi5Helpers(page)) {
                  await waitForTableStable(page, { timeoutMs: 5000 }).catch(() => null);
                }
              }
            } catch (clickErr) {
              defaultLogger.warn(`[MessagesScraper] Could not deep-read message #${i + 1}: ${clickErr.message}`);
              await navigateToHash(page, PORTAL_HASHES.MESSAGES_AL, 2000).catch(() => null);
            }
          }

          scrapedMessages.push({
            id: msgId,
            portalMessageId: msgId,
            accountKey: safeKey,
            company: safeCompany,
            title: (detail && detail.subject) ? detail.subject : entryTexts[i],
            subject: (detail && detail.subject) ? detail.subject : entryTexts[i],
            body: (detail && detail.body) ? detail.body : '',
            severity: (detail && detail.severity) ? detail.severity : 'معلومات',
            msgType: (detail && detail.msgType) ? detail.msgType : '',
            rawSummary: entryTexts[i],
            scrapedAt: new Date().toISOString()
          });
        }
      }

      if (list && list.total > entryTexts.length) {
        defaultLogger.warn(`[MessagesScraper] ${safeKey}: listed ${entryTexts.length} of ${list.total} entries; the rest were not read.`);
      }
    } catch (err) {
      defaultLogger.warn(`[MessagesScraper] Error scraping messages for ${safeKey}: ${err.message}`);
    }

    return scrapedMessages;
  }

  /**
   * Extracts detailed message fields from the active view.
   *
* Fields are located by their visible label rather than by the generated input
 * ids the portal used previously, which come from a global counter and change
 * between sessions and view orders.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} companyName
   * @returns {Promise<Object|null>}
   */
  async _extractMessageDetails(page, accountKey, companyName) {
    try {
      const readField = async (labels) => {
        if (!supportsUi5Helpers(page)) {
          return { ok: false, value: '', reason: 'helpers_unavailable' };
        }
        // Colon-suffixed variants first, then the bare label. Matching the bare
        // form alone would also match a heading that merely contains the word.
        const candidates = [];
        for (const label of labels) {
          candidates.push(`${label}:`);
          candidates.push(label);
        }
        return readLabelledField(page, { labels: candidates });
      };

      const severity = await readField(DETAIL_FIELD_LABELS.severity);
      const msgType = await readField(DETAIL_FIELD_LABELS.msgType);
      const subject = await readField(DETAIL_FIELD_LABELS.subject);
      const body = await readField(DETAIL_FIELD_LABELS.body);

      const extracted = {
        severity: severity.value,
        msgType: msgType.value,
        subject: subject.value,
        body: body.value
      };

      // No subject and no body means nothing readable was on screen. Returning
      // null lets the caller decide, and it logs rather than inventing a
      // message.
      if (!extracted.subject && !extracted.body) {
        const missing = ['subject', 'body'].filter((key) => !extracted[key]);
        defaultLogger.warn(`[MessagesScraper] ${accountKey}: no message detail fields found (missing: ${missing.join(', ')}).`);
        return null;
      }

      return {
        // Subject-derived id, as before. Changing it would orphan every
        // previously-saved message.
        id: `${accountKey}::msg::${encodeURIComponent((extracted.subject || 'general').slice(0, 30))}`,
        accountKey,
        company: companyName,
        severity: extracted.severity || 'معلومات',
        msgType: extracted.msgType || '',
        subject: extracted.subject || 'إشعار من مصلحة الضرائب',
        body: extracted.body || '',
        scrapedAt: new Date().toISOString()
      };
    } catch (err) {
      defaultLogger.warn(`[MessagesScraper] Failed extracting message details: ${err.message}`);
      return null;
    }
  }
}

module.exports = {
  MessagesScraper,
  MAX_MESSAGES_COUNT,
  DETAIL_FIELD_LABELS
};
