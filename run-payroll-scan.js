'use strict';

/**
 * 4-Account Payroll (ZMCF_PAYROLL) Live Scan & Sync under Watch.
 * Targets:
 *   1. marwanhamada
 *   2. 205971997
 *   3. 315240679
 *   4. 533158788
 *
 * Saves data directly into v8/data/payroll.json and v8/data/payroll.csv
 * for immediate presentation on /payroll launcher interface.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BrowserManager } = require('./harness/scraper/automation/browser-manager');
const { loginToKeycloak } = require('./harness/scraper/automation/login');
const { getCredentials } = require('./harness/accounts');
const { PayrollScraper } = require('./harness/scraper/automation/portal/payroll-scraper');
const { getDatabase } = require('./db/connect');

const TARGET_ACCOUNTS = ['marwanhamada', '205971997', '315240679', '533158788'];

async function runPayrollScan() {
  const db = getDatabase();
  console.log(`\n======================================================`);
  console.log(`[PAYROLL-WATCH] Starting 4-Account Payroll Live Scan (ZMCF_PAYROLL)`);
  console.log(`[PAYROLL-WATCH] Time: ${new Date().toISOString()}`);
  console.log(`[PAYROLL-WATCH] Accounts: ${TARGET_ACCOUNTS.join(', ')}`);
  console.log(`======================================================\n`);

  const bm = new BrowserManager({ headed: false, slowMoMs: 50 });
  const scraper = new PayrollScraper();
  const accountResults = [];
  const allObligationsFlat = [];

  for (let i = 0; i < TARGET_ACCOUNTS.length; i += 1) {
    const accountKey = TARGET_ACCOUNTS[i];
    console.log(`\n------------------------------------------------------`);
    console.log(`[${i + 1}/${TARGET_ACCOUNTS.length}] Processing Payroll for account: ${accountKey}...`);
    const start = Date.now();

    let context = null;
    try {
      const creds = getCredentials(accountKey);
      context = await bm.createIsolatedContext(accountKey);
      const page = await context.newPage();

      // Get verified company name from SQLite
      const compRow = db.prepare('SELECT id, name, portal_name FROM companies WHERE account_key=?').get(accountKey);
      const companyName = (compRow && (compRow.name || compRow.portal_name)) || creds.label || accountKey;

      console.log(`  - Company: "${companyName}"`);
      console.log(`  - Authenticating Keycloak SSO...`);
      await loginToKeycloak(page, creds.username, creds.password, 30000);

      console.log(`  - Accessing ZMCF_PAYROLL & extracting obligations...`);
      const scanResult = await scraper.scrape(page, accountKey, companyName, { timeoutMs: 40000 });
      const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

      console.log(`  ✓ Scan completed in ${elapsedSec}s`);
      console.log(`  - Obligations count: ${scanResult.obligations.length}`);
      console.log(`  - Submitted filings: ${scanResult.summary.submittedFilings}`);
      console.log(`  - Unsubmitted filings: ${scanResult.summary.unsubmittedFilings}`);

      accountResults.push(scanResult);
      for (const ob of scanResult.obligations) {
        allObligationsFlat.push(ob);
      }
    } catch (err) {
      const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`  ✖ Failed after ${elapsedSec}s: ${err.message}`);
      accountResults.push({
        accountKey,
        company: accountKey,
        scannedAt: new Date().toISOString(),
        summary: { submittedFilings: 0, unsubmittedFilings: 0 },
        obligations: []
      });
    } finally {
      if (context) {
        await bm.closeContext(context, accountKey).catch(() => {});
      }
    }
  }

  await bm.destroy().catch(() => {});

  // Construct standard payload for v8/data/payroll.json
  const payrollPayload = {
    version: 1,
    scannedAt: new Date().toISOString(),
    accounts: accountResults
  };

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const jsonOutPath = path.join(dataDir, 'payroll.json');
  fs.writeFileSync(jsonOutPath, JSON.stringify(payrollPayload, null, 2), 'utf8');
  console.log(`\n[PAYROLL-WATCH] Saved live payroll data to: ${jsonOutPath}`);

  // Construct CSV export with UTF-8 BOM
  const csvHeaders = ['الحساب', 'الشركة', 'النموذج', 'نوع الإيرادات', 'الفترة', 'من', 'إلى', 'كائن العقد', 'تاريخ الاستحقاق', 'تاريخ الاستلام', 'حالة التقديم'];
  const csvLines = [csvHeaders.join(',')];
  for (const ob of allObligationsFlat) {
    const row = [
      `"${ob.accountKey}"`,
      `"${(ob.company || '').replace(/"/g, '""')}"`,
      `"${(ob.form || '').replace(/"/g, '""')}"`,
      `"${(ob.revenueType || '').replace(/"/g, '""')}"`,
      `"${(ob.period || '').replace(/"/g, '""')}"`,
      `"${ob.periodFrom || ''}"`,
      `"${ob.periodTo || ''}"`,
      `"${ob.contractObject || ''}"`,
      `"${ob.dueDate || ''}"`,
      `"${ob.receiptDate || ''}"`,
      `"${ob.submitted ? 'تم التقديم' : 'لم يتم التقديم'}"`
    ];
    csvLines.push(row.join(','));
  }

  const csvOutPath = path.join(dataDir, 'payroll.csv');
  fs.writeFileSync(csvOutPath, '\uFEFF' + csvLines.join('\n'), 'utf8');
  console.log(`[PAYROLL-WATCH] Saved CSV export to: ${csvOutPath}`);

  console.log(`\n======================================================`);
  console.log(`[PAYROLL-WATCH] 4-Account Payroll Scan Summary`);
  console.log(`======================================================`);
  console.table(accountResults.map(a => ({
    account: a.accountKey,
    company: a.company,
    totalObligations: a.obligations.length,
    submitted: a.summary.submittedFilings,
    unsubmitted: a.summary.unsubmittedFilings
  })));
  console.log(`======================================================\n`);
}

runPayrollScan().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
