# SAPAuto V8 — Plan 2.1: Full-Name Display and 26-Account Payment Recheck

## 1. Purpose

This plan defines the next controlled operating run:

1. Stop instructing the assistant to shorten answers.
2. Preserve full verified company names wherever they are displayed.
3. Recheck payment observations across all **26 configured portal accounts**.
4. Keep the entire portal run read-only: no submissions, acknowledgements, payment actions, message delivery, or email sending.
5. Produce a reconciled, auditable payment result that distinguishes source facts from missing/unknown information.

This document is a plan only. It does not authorise a portal run by itself.

---

## 2. Confirmed baseline

### 2.1 Account scope

The currently configured source contains exactly 26 portal accounts. The run must use this configured list as a fixed snapshot for the cycle. It must not silently add accounts discovered elsewhere, and it must not skip an account without recording why.

### 2.2 Payment scanner boundary

The current bridge path calls the legacy scanner per account with:

```text
--account <portal-account-id>
--json-out <temporary-local-file>
--no-email
```

The scanner contract must return arrays for `tasks`, `obligations`, `payments`, `messages`, and `diffs`, in addition to a successful login result. Payment collection is observational only. The portal action column remains out of scope.

### 2.3 Trust boundary

- A portal account identifier is an identifier, not a company name.
- A full company name must come from the verified portal/workspace source captured in records or from an administrator-approved manual name.
- A missing company name must display as `اسم غير مسجّل`; it must not become “الشركة 1”, an account key, initials from a placeholder, or an AI guess.
- Payment source status is never the same thing as local review status.

---

## 3. Full-name and sentence-display rules

### 3.1 Assistant response rule

The assistant should answer in Arabic with the detail appropriate to the question. It must not receive a blanket instruction to be brief, to shorten sentences, or to omit necessary explanation.

It must still remain structured:

- Lead with the direct answer.
- State source-backed facts before interpretation.
- State uncertainty explicitly.
- Use short sections or bullets for long operational answers.
- Avoid repeating the same fact.

This is not permission to remove validation limits, log limits, request-size limits, or safety limits. Those protect the system and are not user-visible sentence shortening.

### 3.2 Full company-name rule

Every company display must render the full available trusted name.

Required locations:

- company list;
- company header/detail view;
- payment rows and payment detail;
- task, obligation, message, reminder, failure, and report rows;
- dashboard priority items;
- exports;
- AI source citations and proposals;
- attention/alert items;
- mobile layouts.

Allowed presentation behaviour:

- multi-line wrapping;
- responsive row height;
- an accessible full-text tooltip only as an additional aid;
- an explicit “show more / show less” control for very long supporting descriptions, never for the identity itself.

Not allowed:

- ellipsis replacing part of a verified company name;
- CSS line-clamp on the company-name field;
- JavaScript slicing, truncation, or abbreviation of the company-name field;
- initials made from a placeholder or account key;
- a fixed-height card that clips the name.

### 3.3 Layout acceptance rule

Long Arabic names must increase layout height rather than disappear. The company name is primary identity information; cards, tables, and mobile views must adapt around it.

The preferred payment design remains a table/workbench, not the current card wall. Until the workbench is delivered, existing payment cards must still wrap full company names and show the payment source facts without visual clipping.

---

## 4. Payment recheck scope

### 4.1 What to recheck

For each of the 26 accounts, retrieve only the payment observations that are available through the existing read-only scanner route:

- claim/payment reference;
- amount and currency when present;
- due date when present;
- source payment status when present;
- company/workspace name when present;
- portal account identifier;
- scan timestamp;
- scan result and error category.

### 4.2 What must not happen

The run must not:

- click, submit, confirm, or initiate a payment;
- mark a payment paid on the portal;
- submit payroll/tax forms;
- accept terms or acknowledgements;
- send an email, WhatsApp, SMS, or report;
- send source data to Mistral, OpenCode, or any cloud provider;
- use browser credentials as output/log data;
- download PDFs if the row-click/download safety question remains unresolved.

### 4.3 Payment-state rules

The recheck records four separate concepts:

| Concept | Meaning |
|---|---|
| Source status | What the portal supplied at scan time |
| Due-date knowledge | Known date, missing date, invalid date, or conflicting date |
| Local review status | Not reviewed, needs review, evidence pending, or administrator-marked paid locally |
| Attention state | Derived display state only: overdue, due today, due soon, normal, or unknown |

If the source status is absent or unknown, the interface must say so. It must not infer “paid”, “unpaid”, “overdue”, or “normal” solely from an amount or an old date.

---

## 5. Pre-run safety gate

The operator must complete this checklist before requesting the cycle.

### 5.1 Environment and bridge

- Confirm the bridge is in `stopped` or an explicitly approved ready state.
- Confirm the local browser/agent is running on the authorised office machine.
- Confirm no automatic scan schedule is about to overlap the requested cycle.
- Confirm the configured account snapshot count is 26.
- Confirm the source application is configured for `--no-email` output.
- Confirm message mode is dry-run and no delivery worker is active.
- Confirm Mistral cloud review is disabled for the cycle.
- Confirm OpenCode is not involved in the operational scan.
- Confirm a fresh local database backup exists and is readable.

### 5.2 Portal safety

- Confirm the office has authority to view all 26 accounts.
- Confirm the portal session policy permits a read-only scan.
- Confirm the document-row/download safety gate has not been bypassed; payment scanning must not rely on any unsafe row interaction.
- Confirm a human operator is available to stop the scan if portal behaviour changes.

### 5.3 Quality baseline

Before the scan, record:

- current number of companies;
- current number of payments;
- number of payments with known status;
- number of payments with unknown status;
- current latest successful scan time per account;
- number of accounts currently parked because of repeated failures.

This is the baseline for reconciliation, not a target to overwrite.

---

## 6. Execution plan

### Stage 1 — source and account preflight

1. List configured accounts through the same source adapter the harness will use.
2. Assert exactly 26 unique account identifiers after case-normalisation.
3. Produce an in-memory manifest with account position, identifier, and run ID.
4. Refuse the run if the count differs from 26 or duplicates are found.
5. Record a cycle-start audit event with the manifest fingerprint, not credentials.

### Stage 2 — sequential read-only account scans

Process one account at a time. Do not run parallel portal sessions unless a later approved design explicitly adds safe per-account isolation.

For each account:

1. Start a fresh isolated session.
2. Authenticate locally without logging credentials.
3. Navigate only through the approved read-only payment observation flow.
4. Capture the structured result into a temporary protected local file.
5. Validate the result contract before ingestion.
6. Ingest idempotently into the local database.
7. Record account outcome: completed, login rejected, session expired, selector failure, source unavailable, validation failure, or timeout.
8. Close the isolated session and delete temporary scan output.

No account should block later accounts merely because it fails. The cycle continues unless the bridge stop control is used or a safety condition is triggered.

### Stage 3 — failure policy

- First or second account failure: record the failure and continue.
- Third consecutive failure for one account: park only that account according to existing policy and record the park event.
- Portal-wide selector change or unexpected state: stop the relevant scan action, preserve redacted evidence, mark the cycle degraded, and require human review.
- Any indication of a portal write/action: immediately stop the entire cycle, preserve redacted evidence, and mark the result `safety_stop`.
- Stop request: finish only the current non-mutating read operation, close the browser, leave remaining accounts queued, and write a stop acknowledgement.

### Stage 4 — payment reconciliation

After all accounts finish or the cycle stops safely:

1. Count accounts attempted, completed, failed, parked, skipped, and remaining.
2. Count payment records observed, inserted, updated, unchanged, and no-longer-visible.
3. Count payment records by source status: known active, completed/paid according to source, partial, unknown, and missing.
4. Count payment dates: overdue known date, due today, due within seven days, future, missing, invalid.
5. Count company identities: manual, verified source, and unregistered.
6. Compare the latest result to the pre-run baseline without deleting historical source observations.
7. Generate an internal reconciliation report and audit links.

No statement such as “all payments are correct” is allowed. The report must name the verified scope and list the unresolved/failed accounts.

---

## 7. Required result report

The final report must contain:

```text
Payment recheck run: <run ID>
Configured accounts: 26
Attempted: <n>
Completed: <n>
Failed: <n>
Parked: <n>
Stopped early: yes/no
Portal writes: 0
Emails/messages sent: 0
Cloud AI requests: 0

Payments observed: <n>
New records: <n>
Updated records: <n>
Unchanged records: <n>
Source status unknown: <n>
Due date unknown/invalid: <n>
Known overdue source-active payments: <n>

Company identity:
  verified source name: <n>
  manual name: <n>
  unregistered name: <n>

Exceptions requiring administrator review:
  <account + non-sensitive error category + next action>
```

The report may include account identifiers needed for follow-up but must never include passwords, API keys, cookies, tokens, or raw portal session data.

---

## 8. Test plan before any live cycle

### 8.1 Automated tests

The complete project test suite must pass before the portal run. The test gate includes:

- assistant prompt has no instruction to shorten answers;
- company names never use CSS/JS truncation or placeholder-generated initials;
- company names wrap fully on desktop and mobile fixtures;
- account manifest accepts exactly 26 configured unique accounts and rejects a count mismatch or duplicate;
- scan uses `--no-email`;
- result contract includes a payments array;
- payment ingestion remains idempotent;
- missing amount/status/date remains unknown rather than zero/paid/overdue;
- source status and local review state remain distinct;
- local run emits no cloud-AI request and no outbound message;
- full MCP test suite passes, including authenticated protocol behaviour.

### 8.2 Manual UI verification

Verify at desktop and mobile widths:

- the long company names in the supplied screenshots render completely;
- no name has an ellipsis, clipping, or fixed-height cut-off;
- company identity labels show whether the name is source, manual, or unregistered;
- the payment screen distinguishes source status from local review;
- “unknown” is visibly different from “paid” and “overdue”.

### 8.3 Live pilot order

Before scanning all 26 accounts, run one authorised low-risk account and verify:

- no portal state changed;
- payment rows were observed/ingested;
- company name remains full and correctly sourced;
- no email/message/cloud request was created;
- reconciliation report fields populate correctly.

Only after that evidence is approved should the 26-account cycle begin.

---

## 9. Acceptance criteria

Plan 2.1 is complete only when:

1. The assistant no longer receives a “be brief” instruction.
2. Verified company names display in full on all required surfaces.
3. No account key or list position becomes a company name.
4. The full automated test suite is green, including MCP protocol tests.
5. A documented one-account read-only pilot proves payment observation and no external side effect.
6. The full 26-account scan completes, stops safely, or reports failures honestly with no silent skips.
7. The final reconciliation report records `portal writes: 0`, `emails/messages sent: 0`, and `cloud AI requests: 0`.
8. Every payment remains source-honest: unknown source data is not converted into a confident status.

---

## 10. Explicit non-goals

- Redesigning the entire payment page during the recheck run.
- Turning on Mistral, OpenCode, email, WhatsApp, SMS, or automated reports.
- Performing payment actions in ETA/SAP.
- Downloading PDFs through any unverified row-click path.
- Treating a scan failure as a payment absence.
- Declaring 26 accounts “healthy” unless each account has a recorded result.
