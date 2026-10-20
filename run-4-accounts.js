'use strict';

/**
 * 4-Account Live Test & Upgrade Runner under Watch.
 * Targets:
 *   1. marwanhamada
 *   2. 205971997
 *   3. 315240679
 *   4. 533158788
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 */

const { getDatabase } = require('./db/connect');
const { runAccount } = require('./harness/run-account');
const { ingestAccount } = require('./harness/ingest');
const { now } = require('./db/queries/shared');

const TARGET_ACCOUNTS = ['marwanhamada', '205971997', '315240679', '533158788'];

async function main() {
  const db = getDatabase();
  console.log(`\n======================================================`);
  console.log(`[TEST-WATCH] Starting 4-Account Live Verification & Upgrade`);
  console.log(`[TEST-WATCH] Time: ${new Date().toISOString()}`);
  console.log(`[TEST-WATCH] Accounts: ${TARGET_ACCOUNTS.join(', ')}`);
  console.log(`======================================================\n`);

  const summary = [];

  for (let i = 0; i < TARGET_ACCOUNTS.length; i += 1) {
    const accountKey = TARGET_ACCOUNTS[i];
    console.log(`\n------------------------------------------------------`);
    console.log(`[${i + 1}/${TARGET_ACCOUNTS.length}] Scanning account: ${accountKey}...`);
    const start = Date.now();

    try {
      const result = await runAccount(accountKey, { timeoutMs: 180000 });
      const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

      console.log(`[${i + 1}/${TARGET_ACCOUNTS.length}] Scan completed in ${elapsedSec}s`);
      console.log(`  - Login: ${result.login && result.login.success ? 'SUCCESS' : 'FAILED'}`);
      console.log(`  - Tasks: ${result.tasks ? result.tasks.length : 0}`);
      console.log(`  - Obligations: ${result.obligations ? result.obligations.length : 0}`);
      console.log(`  - Payments: ${result.payments ? result.payments.length : 0}`);
      console.log(`  - Messages: ${result.messages ? result.messages.length : 0}`);

      // Ingest into database
      ingestAccount(result, db);
      const { stable } = require('./harness/ingest');
      const companyId = stable('company', accountKey.toLowerCase());
      console.log(`  - Ingestion: companyId=${companyId}`);

      // Query database for updated company record
      const compRow = db.prepare('SELECT id, name, tax_registration_number, status FROM companies WHERE id=?')
        .get(companyId);
      if (compRow) {
        console.log(`  - DB Company Name: "${compRow.name}"`);
        console.log(`  - DB Tax Number: "${compRow.tax_registration_number || 'N/A'}"`);
        console.log(`  - DB Status: ${compRow.status}`);
      }

      // Query database for obligations count for this company
      const obCount = db.prepare('SELECT COUNT(*) AS n FROM obligations WHERE company_id=?')
        .get(companyId);
      console.log(`  - DB Total Obligations: ${obCount ? obCount.n : 0}`);

      summary.push({
        account: accountKey,
        success: true,
        elapsedSec,
        tasks: result.tasks ? result.tasks.length : 0,
        obligations: result.obligations ? result.obligations.length : 0,
        payments: result.payments ? result.payments.length : 0,
        messages: result.messages ? result.messages.length : 0,
        companyName: compRow ? compRow.name : 'N/A'
      });
    } catch (err) {
      const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`[${i + 1}/${TARGET_ACCOUNTS.length}] Scan failed after ${elapsedSec}s: ${err.message}`);
      summary.push({
        account: accountKey,
        success: false,
        elapsedSec,
        error: err.message
      });
    }
  }

  console.log(`\n======================================================`);
  console.log(`[TEST-WATCH] Summary of 4-Account Live Scan`);
  console.log(`======================================================`);
  console.table(summary);
  console.log(`======================================================\n`);
}

main().catch((fatal) => {
  console.error('[FATAL]', fatal);
  process.exit(1);
});
