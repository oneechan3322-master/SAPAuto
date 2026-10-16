# SAPAuto V8 — Production Beast Execution Prompt

You are the lead engineer for SAPAuto V8. Work directly in this repository until the product is a genuinely useful, production-grade **SAPAuto Operating System** for a large Egyptian accounting firm.

Do not answer with another plan. Do not remove features merely because they are unfinished. Implement, test, verify in the running browser, and report factual results. Work in focused vertical slices, but continue through the full backlog below unless an external login/QR/credential action genuinely requires the office owner.

## Mission

Build one local-first application that continuously observes authorised ETA portal data, manages **payments, filings, payroll, documents, tasks, client follow-up, communication, and evidence**, and gives accountants a reliable AI assistant.

The running product must feel like a modern operating system for the office:

- 300+ companies, not a demo built around 26;
- full, verified legal company names everywhere;
- a real Payroll workspace restored from the existing working implementation;
- a real WhatsApp connection and approval-controlled messaging workflow;
- always-on watcher jobs with a visible command centre;
- local AI that sees source-backed context and drives work forward; and
- no fake tiles, empty screens, placeholder data, or claims the app cannot prove.

## Non-negotiable direction

1. **Do not halt product work because the server currently binds to `0.0.0.0`.** Preserve the user’s intended deployment binding. Add actual authentication, admin setup, route protection, audit identity, and CSRF/origin controls so access is protected whether the office uses loopback or a secured LAN.
2. **Payroll must be restored now.** Earlier projects contain working payroll portal logic. Port and modernise it into V8; do not say it needs a new product decision.
3. **WhatsApp must return only as a real feature.** Implement the connection/onboarding, channel health, approved draft/send flow, delivery/reply history, and stop controls. Never show a fake QR card or a “coming soon” feature.
4. **Never hide or silently modify legal/financial data.** Full names, claim numbers, references, dates, and amounts remain visible and copyable. Replace truncation with responsive layout and an explicit, visible transport-limit notice only when a real transport limit forces it.
5. **No automatic tax, payment, portal-write, or client-message action.** Automate observation, triage, drafting, scheduling, and escalation; require a named human approval for any external effect.
6. **Do not wait for more planning permission.** Make reasonable engineering decisions, record them in the changelog/audit, and keep moving. Ask only when an external QR login, user credential, contractual provider account, or legally material office policy is impossible to infer.

---

## Ground truth in this workspace

- Main target: `v8/`.
- Current external source: ETA portal and authorised related ETA modules. Do not make e-invoice/e-receipt integration a prerequisite.
- Existing payroll implementation to recover and port:
  - `SAPAuto v6.0/electron/payroll-portal.cjs`
  - `SAPAuto v6.0/test/payroll-portal.test.cjs`
  - `SAPAuto v6.0/test/ai-payroll.integration.test.cjs`
  - `SAPAuto3/data/payroll-feature-analysis.md`
- The payroll reader already knows how to validate a complete payroll summary and payroll filing obligations. It uses a different ETA payroll module, so implement it as a distinct read-only connector—not as an accidental extension of the ordinary portal scrape.
- Current known defects to fix, not merely document:
  1. no authentication bootstrap/session enforcement;
  2. hard-coded `local-operator` audit actors;
  3. `safeTitle`/`cleanTitle` delete long numeric text from legal/financial records;
  4. source observations are overwritten rather than retained as immutable versions;
  5. local review and portal source states are not consistently visible;
  6. outbound channel event fan-out can bypass an approval broker;
  7. timezone/reminder logic hard-codes `+02:00` instead of `Africa/Cairo` DST rules;
  8. manifest enforcement, 26-account assumptions, 200-row limits, and stale/failed account handling do not scale;
  9. source name aliases can be mislabeled as portal-sourced names;
  10. current UI still has card-wall/old-dashboard behaviour and text corruption risks; and
  11. plaintext credentials/secrets must not remain in application-readable text files or logs.

Do not delete existing data to make these issues disappear. Migrate and preserve it with provenance.

---

## Delivery order — implement in this order

### Slice 1 — Working access, truth, and full identity

Implement immediately:

- First-run admin bootstrap page visible only while no administrator exists.
- Secure administrator creation, password hashing, session cookie, logout, session expiry, and session renewal.
- Middleware/proxy protection for every application page and every mutating API route.
- Use the authenticated human/agent identity in every audit event. Remove hard-coded actors.
- Maintain the configured server bind; make access control real rather than relying on `Origin` or loopback headers.
- Remove destructive numeric stripping from `safeTitle`, `cleanTitle`, status titles, feeds, and every UI fallback.
- Add an identity model with `portal_verified`, `manual_verified`, `unverified_mapping`, and `conflict` origins.
- Preserve old aliases as `unverified_mapping`; never label them as portal evidence. Queue an identity-verification task rather than silently changing a company name.
- Full-name rendering rules across Home, Companies, Payments, Tasks, Payroll, search, detail drawers, messages, exports, notifications, and mobile: no clamp/ellipsis/slicing; readable full value in layout and copy action.
- Repair visible mojibake/encoding defects in source strings, migrations, and UI text using correctly encoded Arabic—not replacement glyphs.

**Acceptance evidence:** a fresh user can create the sole admin; unauthenticated reads/writes are refused; all mutations audit the real actor; a long Arabic/English company name plus claim/amount is unchanged and readable at 390px and 1440px.

### Slice 2 — Evidence, cases, approvals, and operating truth

Implement the foundation that prevents the app from lying:

- Immutable, versioned `source_observation` / `source_document` records with source ID, retrieval time, hash, parser version, run ID, company scope, and permitted evidence reference.
- Never overwrite raw source payloads. Corrections create a new version and link to the predecessor.
- Real entities and UI/API workflows for: case, task, approval, reconciliation, source account, evidence, and AI analysis.
- Four clear lanes in every relevant view: **ETA source / office review / AI suggestion / approved decision**.
- Mandatory run manifest. Derive active account count dynamically; reject duplicates; record exact attempted/completed/failed/parked/stale/skipped coverage for every run.
- Eliminate fixed 26-account and 200-row production assumptions. Paginate/stream safely with visible limits and exact totals.
- Use IANA timezone `Africa/Cairo` for scheduling, reminders, dates, and DST. Store UTC plus timezone/basis; do not hard-code `+02:00`.
- Gateway-style job lease, singleton scan rule, concurrency/rate controls, retries for read-safe operations only, dead-letter queue, stop request/acknowledgement, and `stop_unconfirmed` fail-closed state.
- Backup/export/restore tooling plus an actual restore test.

**Acceptance evidence:** force a failed source read, stale observation, duplicate manifest entry, stopped worker, and restore scenario. The UI/audit must show honest outcomes; no failure may become “nothing found.”

### Slice 3 — Restore Payroll into V8

Port the payroll portal reader from V6 into V8 as a proper read-only connector/worker.

Required implementation:

- Add required browser automation dependencies in V8 deliberately and isolate them behind `payroll-watcher`.
- Keep payroll portal credentials/session context isolated from ordinary ETA portal work.
- Port the validated complete-summary read: tax due, payroll payments, employee count, filing counts, payment-timing counts, nationality counts.
- Port filing-obligation read: form, revenue type, period, period range, due date, receipt date, and source submitted state.
- Preserve Arabic numeral normalization and the rule that an incomplete dashboard is an explicit incomplete/error observation—not zeros.
- Replace old local JSON/file caps and five-account limitations with V8 source-observation records, pagination, manifest coverage, and dynamic account scale.
- Create migrations and V8 domain records for `payroll_profile`, `payroll_period`, `payroll_source_snapshot`, `payroll_obligation`, `payroll_input_request`, `payroll_exception`, `payroll_run_draft`, and payroll approvals.
- Add a real **Payroll** navigation item, global queue integration, company-dossier tab, monthly worklist, period selector, filters, detail drawer, source freshness, evidence links, assigned owner, and next action.
- Create approved workflow states: `not_started`, `waiting_for_client`, `in_preparation`, `ready_for_review`, `approved`, `filed_or_paid`, `blocked`, `exception`.
- Allow AI to flag missing inputs, compare periods, and draft a client request; do not let AI calculate/pay/file/approve a statutory result.
- Add a payroll pilot command/UI that supports one authorised account first and then a configured cohort. It must be read-only and leave the portal unchanged.

**Acceptance evidence:** tests cover Arabic numerals, complete/incomplete summaries, obligation parsing, source/local separation, DST-safe due dates, idempotent re-ingestion, and mobile/desktop Payroll UI. Run a read-only, authorised pilot only when an active office session/credential is available; otherwise ship the connector as ready-to-connect with a truthful health state.

### Slice 4 — Real WhatsApp and communication broker

Build one communications subsystem for Gmail, Telegram, and WhatsApp.

Required implementation:

- Channel registry: configured, connecting, connected, unhealthy, paused, disabled.
- Real WhatsApp connection flow using the project’s supported provider/library or an officially configured business provider. Persist only protected credential references/session state; show QR/pairing only when a real connection attempt is active.
- Contact model: company relation, consent/status, channel identity, suppression/opt-out state, verification state.
- Drafts are evidence-linked and show full recipient, full company name, exact content, associated case, and attachments before approval.
- Replace direct event fan-out with a broker: `event → candidate draft → explicit approval → exact send → delivery/reply receipt`.
- Default all channels to draft mode. No channel can be made live until an administrator configures it and sends a test message to an approved test contact.
- Support individual sends first. Add batch sending only after individual flow is verified, with a frozen recipient list/content version, time window, rate limit, duplicate prevention, per-company pause, and office-wide stop.
- Inbound replies create/attach a case and assigned task. They never trigger autonomous tax answers.
- Add communications worklist, delivery history, pending approvals, opt-outs, failures, and health view.

**Acceptance evidence:** an admin can pair/configure the real WhatsApp connection; create a test contact; compose an evidence-linked draft; approve it; send it; see the provider receipt; receive/reconcile a reply; pause the channel; and audit every stage. If an external account/QR is required, complete the entire app flow and stop only at the user scan/login step—do not claim connected before it is.

### Slice 5 — Office Gateway, MCP, and AI operations

Implement a small, firm-owned agent control plane—do not embed a generic unrestricted autonomous agent.

- Add a gateway service that owns job scheduling, agent registration, worker health, work leases, scoped MCP tools, approval requests, channel routing, and stop controls.
- Define agents: `portal-watcher`, `payroll-watcher`, `evidence-processor`, `reconciliation-agent`, `case-coordinator`, `office-adviser`, `communication-agent`, `supervisor`, and `system-adviser`.
- Agent tool exposure is least-privilege and job-scoped. No generic shell/database write tool for tax/office agents.
- Expand existing MCP into an authenticated, versioned internal tool API with tool schemas, company scope, actor/agent identity, correlation ID, policy decision, audit result, and redacted errors.
- Required read MCP: company dossier, worklist, portal observation, payroll period, payment list, evidence, case, knowledge search, audit query, gateway health.
- Required bounded draft MCP: create case/task/reconciliation/payroll-input draft, compose message draft, request approval, pause/resume agent.
- Local AI is the default. Mistral is optional and only receives redacted/consented minimum data. OpenCode is for code/test/change proposals and cannot access production taxpayer secrets/data.
- AI answer contract: source facts, interpretation, missing/unknown facts, recommended next task, citations/evidence, and review state.
- Add an approved knowledge library and versioned procedure/skill library. The AI can propose an improved skill; it cannot publish it without test + human approval.
- Add agent health/control UI: running/queued/failed/parked/stale/paused/stopped, current job, source freshness, queue depth, last error class, and stop acknowledgement.

**Acceptance evidence:** tests prove an agent cannot see a tool outside its scope, cannot act after pause, cannot access another company’s data, cannot send/submit, and cannot return an unsupported answer without declaring it unknown.

### Slice 6 — Make the application feel like an operating system

Replace leftover old dashboard/card patterns with a unified workbench:

- One global attention/work queue for portal, payments, payroll, documents, cases, reconciliation, communications, and system incidents.
- Dense but calm table/list layout with full company names, exact source lane, deadline basis, owner, freshness, evidence, and next action.
- Company dossier tabs: Overview, ETA, Payments, Payroll, Documents, Reconciliation, Communications, Cases, Activity.
- Every dashboard counter opens its exact underlying filtered worklist.
- Explicit `shown / total`, filter state, page/stream limit, and excluded/failed account count.
- All material UI copy must be clean Arabic/English; never mojibake.
- Remove every non-working nav item, disabled affordance, or demo metric. A real unfinished feature may appear only in an administrator-only roadmap/settings area labelled accurately.

**Acceptance evidence:** browser-test the entire app at 1440, 1024, 768, and 390 pixels, including long Arabic/English names, dates, numeric IDs, amounts, mobile navigation, and keyboard access. No horizontal overflow, clipping, fake feature, or broken action.

---

## Operating constraints

- Preserve existing user data and existing working features.
- Do not run an uncontrolled full live scan, click unverified document rows, download through an unverified state-changing path, submit/acknowledge portal items, or send a real client message without the actual configured approval/test-contact flow.
- Do not expose credentials, tokens, QR contents, browser sessions, raw taxpayer passwords, or personal payroll data in logs, tests, screenshots, prompts, reports, or AI messages.
- Use real tests, migrations, and browser verification for every slice. Test against a fresh database and upgrade database.
- When external access is unavailable, build the complete production path with a truthful `not_connected` or `auth_required` state. Never substitute sample success data.
- Do not report work complete because code compiles. Report the actual test count, browser checks, migration result, and any remaining external action required.

## Definition of done

SAPAuto V8 is ready for controlled firm operation when:

1. An authenticated administrator can operate the full app on the intended network binding.
2. Every portal/payroll observation is versioned, evidence-backed, scoped to the correct company, and freshness-labelled.
3. Payroll is a working first-class module, not code hidden in an older project.
4. WhatsApp is a real configured channel with pairing, approval, delivery/reply audit, and stop controls—or honestly disabled until its external connection is completed.
5. The global queue handles all office work types and no material text/data is shortened or hidden.
6. Agents run continuously within leases/policies, expose health, survive failures honestly, and require approval for external effects.
7. AI is evidence-grounded and helpful without being able to fabricate, submit, pay, or send.
8. Automated, migration, integration, security, and visual tests pass; backup/restore and paused-worker scenarios are demonstrated.

Start with Slice 1 and continue immediately into Slice 2 and Slice 3. Do not return to planning mode.
