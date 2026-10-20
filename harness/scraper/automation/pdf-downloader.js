/**
 * PDF Downloader for SAP Documents.
 * Handles row-click downloads, button triggers, and print fallback.
 * Adheres to RULE 1, RULE 2, RULE 3, RULE 5, RULE 6, RULE 7, RULE 10.
 */

const fs = require('fs');
const path = require('path');
const { AutomationError } = require('../common/errors');
const { assertNonEmptyString } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');

function getAvailableDownloadPath(downloadsDir, suggestedName) {
  const parsed = path.parse(suggestedName);
  const extension = parsed.ext || '.pdf';
  const baseName = parsed.name || 'document';

  for (let index = 0; index < 10000; index++) {
    const suffix = index === 0 ? '' : ` (${index + 1})`;
    const candidate = path.join(downloadsDir, `${baseName}${suffix}${extension}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new AutomationError(`Could not find an available filename for ${suggestedName}`);
}

class PdfDownloader {
  /**
   * @param {string} downloadsDir - Local directory where downloaded PDFs are saved
   */
  constructor(downloadsDir) {
    this.downloadsDir = assertNonEmptyString(downloadsDir, 'downloadsDir', 'PdfDownloader.constructor');
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
  }

  /**
   * Downloads the PDF by clicking on the document row in SAP MCF documents table.
   *
   * @param {import('playwright').Page} page - Active page
   * @param {import('playwright').ElementHandle} rowElement - The table row element to click
   * @param {string} documentId - Document identifier
   * @param {number} [timeoutMs=15000] - Download timeout
   * @returns {Promise<string>} Saved PDF file path
   */
  async downloadRowPdf(page, rowElement, documentId, timeoutMs = 15000) {
    const docId = assertNonEmptyString(documentId, 'documentId', 'PdfDownloader.downloadRowPdf');
    defaultLogger.info(`Triggering PDF download for row: ${docId}...`);

    try {
      const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs }).catch(() => null);

      // Click the row to trigger SAP download
      await rowElement.click();

      const download = await downloadPromise;
      if (download) {
        let suggestedName = download.suggestedFilename() || `doc_${docId}.pdf`;
        // Ensure .pdf extension
        if (!suggestedName.toLowerCase().endsWith('.pdf')) {
          suggestedName += '.pdf';
        }
        // SAP can suggest the same filename for multiple notifications. Never
        // overwrite an earlier PDF; attachments must remain one file per row.
        const targetPath = getAvailableDownloadPath(this.downloadsDir, suggestedName);
        await download.saveAs(targetPath);

        if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
          defaultLogger.info(`PDF downloaded successfully: ${suggestedName} (${fs.statSync(targetPath).size} bytes)`);
          return targetPath;
        }
      }

      defaultLogger.warn(`Row click did not trigger download event directly for ${docId}`);
      return '';
    } catch (err) {
      defaultLogger.error(`Error downloading row PDF for ${docId}: ${err.message}`, { documentId: docId }, err);
      return '';
    }
  }
}

module.exports = {
  PdfDownloader,
  getAvailableDownloadPath
};
