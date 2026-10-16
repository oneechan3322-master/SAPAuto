# SAPAuto V8 — Plan 2.4: Make the Working Product Worthy of the Firm

## 1. Why this plan exists

The current app is not yet acceptable as the daily system for a large accounting firm.

Three visible failures make that clear:

1. **Payroll is absent.** A firm cannot use one operating tool while payroll work is outside it.
2. **Company identity is not presented with enough care.** Long Arabic/English legal names must never be shortened, clipped, fabricated, or visually treated as secondary data.
3. **The interface contains placeholder features and an old card-heavy layout.** A “coming soon” WhatsApp tile does not help an accountant and must not be presented as a usable capability.

This plan is a correction plan. It does not describe imagined future features as if they already work. Each feature is either:

- **working and verified**;
- **not enabled**, with no false affordance; or
- **in controlled beta**, visibly labeled with its limits.

## 2. Product standard

The target is a calm, fast **accountant command centre**, not a collection of dashboard cards.

At 9:00 AM, an accountant should be able to see across every assigned company:

- what has changed at ETA;
- which filings, payments, payroll actions, documents, and client requests need attention;
- what is overdue or lacks evidence;
- the exact full legal company name and its source;
- who owns the next step; and
- what is fact, what is office review, and what is AI assistance.

No screen may hide a material amount, deadline, status, legal name, or source limitation behind truncation, generic labels, vague colours, or a decorative card.

---

## 3. Immediate product decisions

### 3.1 Payroll is a first-class work area

Create a real payroll workspace. It is not a future tile, a generic task list, or an AI chat prompt.

**Initial payroll scope:**

- company payroll profile and payroll owner;
- monthly payroll period register;
- employee count and payroll input checklist;
- payroll run status: `not_started`, `waiting_for_client`, `in_preparation`, `ready_for_review`, `approved`, `filed_or_paid`, `blocked`, `exception`;
- statutory/tax/social-insurance work items only when their source, deadline, and firm procedure have been approved;
- payment/filing evidence attachment and reviewer sign-off;
- exceptions, missing inputs, and client questions;
- payroll calendar and escalation queue; and
- immutable activity history.

**Not in the first payroll release:** salary calculation engine, bank payment execution, direct government submission, or automatic legal/tax conclusions. Those need a separately approved legal and accounting specification.

### 3.2 Full company names are non-negotiable

For every page, notification, export, dialog, and search result:

- display the complete verified name by default;
- allow multi-line wrapping and increase row/card height as required;
- never use CSS line clamp, ellipsis, character slicing, generated abbreviations, or AI paraphrasing;
- include the full text in accessible labels and copy actions;
- show name provenance: `portal verified`, `manually verified`, `unverified`, or `conflict`;
- show unknown/conflicting identity as a data-quality warning, never as a guessed company name; and
- use a short internal reference only as a secondary label, never as the displayed legal name.

A tooltip is supplementary, not the solution. The full name must be readable directly on screen.

### 3.3 Remove fake availability

The WhatsApp “قريبًا” tile and any equivalent inactive product tile must be removed from the navigation and settings until it is genuinely usable.

When communication capability is built, it must first provide:

- explicit channel connection state;
- a real recipient and consent model;
- preview before send;
- human approval for outbound tax/payroll content;
- delivery/failure audit trail; and
- a disable switch.

Until then, the only valid user experience is **no WhatsApp feature shown**.

---

## 4. Visual redesign — from card wall to accountant workbench

### 4.1 Design direction

Replace oversized repeated cards with a data-dense, modern Arabic-first workspace:

- RTL by default, with correct mixed Arabic/English/numeric alignment;
- one clear page title, total count, source freshness, and visible filters;
- a compact summary strip for urgent/overdue/waiting/review items;
- filterable tables or grouped worklists for the main body;
- a right-side detail drawer or company dossier for context without losing the queue;
- consistent status chips with text, icon, and colour—not colour alone;
- responsive mobile layout that preserves full names and essential facts; and
- no decorative metric that cannot be traced to a real record.

### 4.2 Global control room layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ اليوم: 16 أكتوبر | آخر تحديث | حالة الجسر | بحث شامل | إيقاف آمن     │
├─────────────────────────────────────────────────────────────────────┤
│ يحتاج انتباه: 12 | متأخر: 4 | انتظار عميل: 7 | بيانات قديمة: 3    │
├───────────────┬──────────────────────────────────┬──────────────────┤
│ الفلاتر      │ قائمة العمل الموحدة               │ تفاصيل السجل     │
│ الشركة       │ الشركة | العمل | الاستحقاق | المالك│ الاسم الكامل     │
│ المجال       │ كامل الاسم، لا اختصار             │ المصدر والدليل   │
│ المالك       │ المصدر والحالة بوضوح              │ المهام والملاحظات│
│ حالة المصدر  │                                  │ سجل النشاط       │
└───────────────┴──────────────────────────────────┴──────────────────┘
```

The worklist must combine portal observations, payments, obligations, payroll periods, client requests, and reconciliations while keeping their types and source lanes visible.

### 4.3 Company dossier

Replace generic company cards with a dossier:

- full verified legal name, status, account owner, and identity source in the header;
- a horizontal timeline of source events, office actions, and approvals;
- tabs: **Overview, ETA, Payments, Payroll, Tasks, Documents, Reconciliation, Activity**;
- concise evidence-first summary, never an AI-only summary; and
- “what needs attention” as the opening section.

### 4.4 Payment workspace

The payments page becomes a worklist, not a card gallery:

| Company | Source status | Amount | Due/observed date | Local review | Evidence | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |

Requirements:

- source status and local review remain separate columns;
- unknown/stale source values are explicit and cannot be filtered away silently;
- amounts/currencies are never reformatted into misleading values;
- filters and exports show the exact row count and active criteria;
- a payment cannot be marked paid without reason, evidence, reviewer, and audit event; and
- no operation overwrites the original portal observation.

### 4.5 Payroll workspace

Use a monthly operational board, not cards:

| Company | Payroll month | Input status | Review status | Statutory due basis | Evidence | Owner | Risk/next action |
| --- | --- | --- | --- | --- | --- | --- | --- |

The initial release only displays **approved workflow rules**. If a payroll deadline or tax/social-insurance obligation has not been confirmed by the firm’s designated expert, it is displayed as `needs rule approval`, not calculated or suggested by AI.

---

## 5. Correct the foundation before adding surface features

The Plan 2.3 review identified serious data and control gaps. These must be fixed before relying on payroll or 300+ company operations.

### 5.1 Identity and access control

Implement a single-administrator office model now, designed to extend safely later:

- one authenticated administrator account with MFA/strong local authentication;
- explicit session middleware on every protected route;
- every mutation route requires verified authority;
- actor identity comes from the session, never hard-coded `system` or `local-operator`;
- routes fail closed when authority is missing; and
- a future multi-user/tenant model is designed before any client self-service is exposed.

### 5.2 Evidence and immutable observations

Implement the evidence layer before calling portal data reliable:

- append-only `source_document` / `source_observation` records;
- original normalized payload version plus immutable hash;
- retrieved time, connector run, account/company relation, and parse version;
- object storage or local evidence vault for permitted screenshots/files;
- corrections represented as new versions, never overwrite;
- evidence links visible in the UI; and
- retention/deletion policy and integrity verification jobs.

### 5.3 Cases, approvals, and reconciliation

Create real entities, not only UI state:

- case;
- task;
- approval;
- reconciliation;
- source account;
- source observation/document;
- AI analysis.

Each entity has company scope, creator, timestamps, version/audit trail, and explicit relationships. Every material dashboard count is derived from these records.

### 5.4 Bridge safety and scale

Before going beyond a small pilot:

- enforce a singleton active scan cycle;
- add acknowledged stop control that halts before every next account and prevents a new cycle until reset;
- configure concurrency, per-source rates, retry policy, and dead-letter handling;
- treat portal UI/schema change as an incident, not an empty result;
- expose failed/parked/stale accounts in every global count;
- remove the 26-account and 200-row assumptions; and
- retain each run manifest, account outcome, timing, and error classification.

### 5.5 Correct identity provenance

Remove hard-coded account-ID-to-legal-name aliases from the upstream bridge unless each mapping has verified evidence and an explicit `manual_verified` origin. A hard-coded alias must never appear as portal-sourced identity.

---

## 6. Payroll data model and controls

### 6.1 Entities

- `payroll_profile`: company, service arrangement, owner, approved operating rules, active state.
- `payroll_period`: company, month, source/basis, state, deadlines, freshness, owner.
- `payroll_input_request`: required input, source/client, due date, received evidence, validation state.
- `payroll_run`: versioned preparation record, preparer, reviewer, totals references, evidence links.
- `payroll_obligation`: type, authoritative basis, deadline evidence, source status, local review.
- `payroll_exception`: discrepancy, risk, evidence, assigned owner, resolution.
- `payroll_approval`: approval purpose, reviewer, decision, reason, timestamp.

### 6.2 Safety rules

- One company/month may have multiple versions but exactly one active payroll period.
- No payroll period may be `approved` without a reviewer distinct from the preparer.
- No deadline may be automatically generated unless an approved rule version and authoritative basis are recorded.
- No tax/social-insurance amount is treated as payable from AI extraction alone.
- Payroll data is extra-sensitive: it requires stricter access, redaction, and export controls.
- Any incomplete input or source conflict blocks “ready for review.”

### 6.3 Initial real workflow

1. Admin creates the company payroll profile and assigns an accountant.
2. The system opens the new monthly period from an approved schedule.
3. It creates input requests/checklist items; client-provided files are stored as evidence.
4. Accountant prepares the payroll checklist and links source figures/documents.
5. System flags missing data, deadline risk, and prior-period variance for review.
6. Reviewer accepts, returns, or escalates the period.
7. Completion requires supporting evidence and an audit record.

The AI may identify missing items and draft explanations; it cannot compute or approve a statutory position without the approved rule/evidence workflow.

---

## 7. AI that is useful, not theatrical

### 7.1 Make AI visible only where it adds proof-backed value

Enable these first:

- compare current versus prior portal observation and explain the difference;
- extract fields from uploaded evidence with source citations;
- draft a client information-request checklist;
- summarise a case, preserving full names, dates, IDs, amounts, and uncertainty;
- identify incomplete payroll inputs; and
- propose a task to an accountant.

Do not show a general AI chat as the primary workspace. Every AI action begins from a company, case, document, payment, or payroll period and receives only that approved context.

### 7.2 Answer contract

The AI must show:

- **Source facts**;
- **AI interpretation**;
- **Missing information**;
- **Suggested human next step**; and
- **Evidence links**.

If no approved source supports an answer, it says so. It must never fill a gap with broad “Egyptian tax knowledge.”

### 7.3 AI production gate

Before live AI is enabled, test it against reviewed firm cases for:

- wrong or invented tax/accounting claims;
- loss of names, numbers, dates, or identifiers;
- uncited answers;
- Arabic/English mixed-text errors;
- cross-company information leakage; and
- instructions hidden in imported PDFs or portal text.

Any material error blocks that capability until corrected and re-tested.

---

## 8. Delivery sequence

### Release 2.4.1 — Truthful interface and visible controls

**Objective:** stop presenting an unfinished product as finished.

- remove WhatsApp and all other non-functional “coming soon” surfaces;
- remove sentence shortening and all visual clipping on full legal names;
- replace card-heavy payment/company views with compact worklists;
- show source freshness, unknown, stale, failed, and parked states honestly;
- repair all displayed Arabic text encoding defects;
- add visual regression tests at desktop and mobile widths.

**Done only when:** a real long Arabic/English name is fully readable on every relevant page, the user sees no fake feature entry, and no material queue item relies on a card-only summary.

**Status: implemented and verified.**

| Item | Evidence |
| --- | --- |
| WhatsApp and all non-functional “coming soon” surfaces removed | `launcher/components/channel-center.jsx` lists only Gmail + Telegram; `launcher/app/api/settings/route.js` no longer advertises WhatsApp or probes an optional package. Verified live: channel tiles are exactly `["Gmail","Telegram"]`. |
| No sentence shortening or clipping on legal names | `domain/bounded-text.cjs` cuts only at a transport limit and always appends a visible notice; `boundedToolPayload` returns a structured `truncated`/`omittedCharacters` object instead of a bare slice. Applied in `channels/telegram.js`, `channels/gmail.js`, `channels/whatsapp.js`, `assistant/run.js`. |
| Card-heavy payment view replaced by a worklist | `launcher/components/payment-worklist.jsx`: a real table with Company / Amount / Due date / Source lane / Local review / Sync / Detail columns, six lane filters, and an expandable evidence row. |
| Source freshness, unknown, stale, failed, parked shown honestly | `domain/record-status.cjs` `describePayment()` returns the source disposition and the local lane as two separate facts, plus `stale`, `conflict`, and per-state flags. `listRecords()` now reports `truncation` so a capped list shows `معروض من N` and a visible warning instead of implying completeness. |
| Arabic encoding defects repaired | `تعذرت الم.syncنة` → `تعذرت المزامنة` (fixed in the previous release; re-verified). |
| Visual regression tests at desktop and mobile widths | `test/plan-2-4.test.js` “live:” case asserts no route overflows at 1440/768/390, that `/payments` renders one worklist table and zero card grids, and that every row name fits the screen. |

Acceptance conditions: met. Screenshots in `audit-screenshots/plan-2-4/`.
Test suite: 128 tests, 128 passing.

### Release 2.4.2 — Trust foundation

**Objective:** make current portal data auditable and safe.

- route/session authorization audit and repair;
- immutable source observation/evidence store;
- case/task/approval/reconciliation entities;
- actor-correct audit trail;
- bridge singleton, stop acknowledgement, rate limits, and clear failure states;
- source identity provenance repair;
- backup, restore, and data-integrity verification.

**Done only when:** a reviewer can prove every displayed portal fact and every local decision from the audit/evidence chain.

### Release 2.4.3 — Payroll pilot

**Objective:** run real accountant payroll workflow for a small authorised pilot.

- payroll schema, period board, input checklist, assignment, and review flow;
- approved payroll rule registry with “unknown/not approved” default;
- evidence and approval requirements;
- dashboard integration with global work queue;
- pilot with 3–5 companies and parallel manual control.

**Done only when:** the designated payroll reviewer signs off that no required input, deadline, or approval was hidden or incorrectly manufactured.

### Release 2.4.4 — AI copilot pilot

**Objective:** use local AI to save time while maintaining accountability.

- evidence-grounded assistant in case/payment/payroll context;
- approved knowledge registry;
- output/citation/review model;
- evaluation suite built from reviewed cases;
- kill switch and audit dashboard.

**Done only when:** evaluation passes the firm’s written thresholds and senior reviewers approve bounded use.

### Release 2.4.5 — Scale and operating readiness

**Objective:** controlled expansion from pilot to 300+ companies.

- onboarding manifest and company identity verification;
- scheduling and health monitoring;
- capacity/load testing;
- incident response and daily reconciliation routine;
- staged roll-out by service team; and
- quarterly access, backup, and AI-quality reviews.

**Done only when:** the platform meets agreed freshness, recovery, evidence, and review service levels for the full authorised population.

---

## 9. Test and acceptance checklist

### 9.1 Interface tests

- Full-name test on Companies, Home, Payments, Tasks, Payroll, search, dialogs, exports, and mobile views.
- No CSS clamp, ellipsis, JavaScript substring/slice, or assistant shortening for legal names/IDs/amounts/dates.
- Arabic text rendering and mixed RTL/LTR number alignment test.
- Every navigation item opens a working feature; no inactive placeholder remains.
- Every global count opens a reconciled underlying worklist.

### 9.2 Data/control tests

- Source observations are immutable and content-hashed.
- Local review cannot overwrite source status.
- Every mutation has authenticated actor, authority, reason, and audit record.
- A failed/stale source is never shown as “no obligation” or “paid.”
- Emergency stop requires acknowledgement and prevents a new scan until explicit restart.
- One active scan cycle only; no overlap/orphan process.
- A complete restore from backup is tested before live expansion.

### 9.3 Payroll tests

- One active payroll period per company/month.
- Missing mandatory input blocks review.
- Preparers cannot self-approve.
- No deadline/obligation appears without approved rule/evidence basis.
- Source/office/AI/approval lanes remain visible and separate.
- Pilot results reconcile with manual payroll records.

### 9.4 AI tests

- Every answer cites evidence or declares uncertainty.
- AI retains complete legal names, dates, identifiers, and amounts.
- Cross-company isolation and prompt-injection tests pass.
- Material unsupported tax/accounting advice is a release blocker.

---

## 10. Ownership and decision requirements

This plan cannot succeed through software alone. Before Release 2.4.3, assign named owners for:

- product/firm sponsor;
- ETA portal access and operational safety;
- payroll process and approved rules;
- senior tax/accounting review;
- information security and credential rotation;
- data retention/client consent;
- production incident response; and
- AI quality/knowledge approval.

## 11. Definition of success

The finished product is not “an AI dashboard.” It is a reliable office system where an accountant can open one global queue, see every company in its full verified identity, understand the evidence and next action, manage payroll alongside ETA work, and trust that the system will never quietly invent, hide, or act on tax data.

Until the evidence, controls, payroll pilot, and visual quality gates above pass, it must be described honestly as **under controlled development**, not production-ready.
