# SAPAuto V8 — Plan 2.0: Private AI Operations and Modern Financial Workspace

## Status and intent

This plan upgrades the existing V8 application into a trustworthy, AI-assisted office operating system. It does **not** add autonomous portal actions, payment execution, tax submission, or client messaging.

The product will use three distinct capabilities:

| Capability | Product name | Purpose | Default data boundary |
|---|---|---|---|
| Local assistant | Gemma 4 | Daily assistant, search, classification, extraction, summarisation, drafting, monitoring | Device only |
| Cloud reviewer | Mistral | Optional second opinion for a deliberately approved and redacted case | Explicit per-case approval |
| Engineering adviser | OpenCode | Codebase, configuration, diagnostics, and improvement proposals | Sanitised source snapshot only |

This distinction is mandatory. OpenCode is not the runtime document assistant and must not be used as a replacement for Gemma 4 or Mistral in daily office workflows.

---

## 1. Product decisions

### 1.1 Privacy-first default

`Gemma 4 local` is always the default assistant.

- The application must work completely when cloud AI is disabled.
- No user prompt, document text, payment record, company name, attachment, portal content, or audit event leaves the device merely because an AI feature is enabled.
- Switching to Mistral requires both an enabled Mistral key and an explicit approval for the exact request.
- A request approved for Mistral must state what data will leave the device and why.
- Cloud consent expires when the case changes materially, when a new attachment is added, or after 24 hours—whichever is earlier.

### 1.2 AI is self-monitoring, not autonomous

The system may observe, compare, explain, propose, and warn. It may not decide or act externally without the administrator.

Allowed without additional approval:

- Read locally stored, authorised data.
- Produce a summary, classification, draft, or risk flag.
- Detect missing fields, likely duplicates, stale scans, and inconsistent statuses.
- Create a non-binding proposal in the internal review queue.

Always requires administrator approval:

- Applying a suggested company mapping.
- Applying or changing a deadline.
- Marking a payment as paid in the local workspace.
- Sending a message, exporting data, or calling any cloud provider.
- Accepting an OpenCode proposal or applying a code change.

Never permitted in Plan 2.0:

- ETA/SAP submission, acknowledgement, payment execution, appeal action, form editing, or portal write-back.
- Use of passwords, cookies, MFA values, browser profiles, API secrets, or raw tokens as AI input.
- Silent cloud fallback.
- Silent modification of source records, audit records, or legal/company names.

### 1.3 Remove Ollama fully

The product must have no Ollama provider selection, card, status label, loopback endpoint, configuration requirement, or fallback path.

The only runtime assistant choices are:

1. `Gemma 4 — محلي`.
2. `Mistral — مراجعة سحابية بموافقة`.

OpenCode appears separately under `مستشار النظام`, not as a runtime assistant provider.

---

## 2. Current-state corrections

The existing V8 implementation already provides valuable foundations:

- Local Gemma 4 is the default model and runs on loopback.
- Mistral requires a configured API key and cloud-consent setting.
- OpenCode proposals are separated from the runtime assistant and are intended to receive only a bounded, sanitised source snapshot.
- Real portal company names are available in stored record payloads and are not to be guessed from account keys.
- The portal scanner is read-only and excludes the payment-action column.

The following must be corrected before release:

1. Remove the remaining Ollama selection and capability state from settings and UI.
2. Replace integration cards that imply a connection without proving a real health check.
3. Replace the old payment card grid with a decision-oriented financial workbench.
4. Add a durable AI request/proposal/audit model; a generated answer must be traceable to sources and policy.
5. Move cloud consent from a broad global switch to a clear, time-limited case-level decision.
6. Keep “portal name”, “manually approved office name”, and “account key” visibly distinct.

---

## 3. Information architecture

### 3.1 Main navigation

The left/right RTL navigation should be simplified to the office jobs that exist now:

1. `مكتب اليوم` — prioritised work and current risks.
2. `الشركات` — verified portal accounts and office mapping.
3. `المهام` — administrator work queue.
4. `الالتزامات` — deadlines and filing-related records.
5. `المدفوعات` — financial workbench.
6. `الرسائل` — local record of communications; no live sending in this phase.
7. `التذكيرات` — administrator reminders.
8. `التقارير` — exports and operational trends.
9. `سجل التدقيق` — append-only activity.
10. `مركز التحكم` — scan health, AI status, privacy, and system adviser.

Do not show a WhatsApp integration card until an approved delivery provider, consent policy, and send workflow actually exist.

### 3.2 Control Center

Replace generic settings cards with a clear control center containing three separate blocks:

#### A. المساعد المحلي — Gemma 4

- State: `جاهز`, `يعمل`, `غير متاح`, `متوقف مؤقتاً`, or `يتطلب صيانة`.
- Model identity and version.
- Local endpoint health and last successful local request.
- Current queue size and average local response time.
- Privacy statement: `لا تغادر بيانات المحادثة هذا الجهاز`.
- Button: `إيقاف المساعد المحلي` / `استئناف`.

#### B. المراجع السحابي — Mistral

- State: `غير مربوط`, `جاهز للمراجعة`, `متوقف`, or `تعذر الاتصال`.
- Do not reveal the key, key suffix, or configuration path.
- Explain that it is never an automatic fallback.
- Show the last approved cloud review, including case ID, approval time, data classification, and result status—never the raw prompt.
- Button: `اختبار اتصال آمن` using a synthetic non-sensitive probe only.
- Button: `إيقاف كل المراجعات السحابية`.

#### C. مستشار النظام — OpenCode

- State: `غير مهيأ`, `جاهز للمقترحات`, `طلب مراجعة قيد التنفيذ`, `يتطلب تدخلاً`.
- Show selected provider/model only if configured; do not reveal credentials.
- Explain the scope: source and diagnostics only; no production database, company, payment, document, portal, attachment, or secret data.
- Provide a proposal inbox: `جديد`, `قيد المراجعة`, `مقبول للتنفيذ اليدوي`, `مرفوض`.
- Explicitly state: accepting a proposal never edits code automatically.

---

## 4. Local AI: Gemma 4 operating design

### 4.1 Local jobs

Gemma 4 may perform these local jobs:

| Job | Input | Output | Required review |
|---|---|---|---|
| Case summary | Selected stored records and approved local attachment text | Arabic summary with cited source fields | Optional review before saving note |
| Classification | Document title, source fields, OCR text when available | Document type, confidence, explanation | Required before applying workflow |
| Deadline extraction | Portal/PDF text | Exact deadline wording, proposed date, source location | Required before setting deadline |
| Duplicate review | Structured metadata and text fingerprints | Possible duplicate set with reasons | Required before linking/closing |
| Payment review | Payment row and linked records | Status ambiguity, missing evidence, recommended next action | Required before any status update |
| Drafting | Admin instruction plus selected local case data | Draft note, checklist, message draft | Required before sharing or saving as final |
| Office monitoring | Health, failed scans, stale records, known data gaps | Ordered alerts and explanation | No action without admin |

### 4.2 Tool boundaries

Gemma tools must use an allowlist and structured parameters. Each tool call must validate its schema and tenant/office scope.

Permitted tool classes:

- Read a selected record by immutable ID.
- Search local indexed records with a bounded result limit.
- Read a redacted audit summary.
- Build a draft proposal object.
- Create an internal AI proposal in `pending_review` state.

Forbidden tool classes:

- Arbitrary shell commands.
- Filesystem traversal beyond defined data/evidence readers.
- Network access.
- Any browser or portal control.
- Database write SQL.
- Any access to environment variables or credential stores.

### 4.3 Response contract

Every assistant response must contain:

- `answer`: concise Arabic response.
- `sources`: record IDs, field names, and source timestamps.
- `confidence`: `high`, `medium`, or `low`; never a fake percentage without calibration.
- `unknowns`: missing facts that prevented certainty.
- `proposals`: zero or more non-binding structured suggestions.
- `safety_note`: mandatory when the result could affect a deadline, payment, compliance action, or external communication.

If no supporting source exists, the assistant must say `لا توجد بيانات كافية` rather than infer a fact.

### 4.4 Local AI failure handling

- If the local model is offline, show `المساعد المحلي غير متاح`; do not silently use Mistral.
- If output is malformed, reject it, retain a redacted error event, and show no suggestion.
- If a tool call is not registered or fails validation, block it and log a denial.
- If a request exceeds content limits, ask the administrator to select a smaller source set.
- If an attachment cannot be safely extracted, mark it `attachment_text_unavailable`, not “empty”.

---

## 5. Mistral: explicit cloud second opinion

### 5.1 Purpose

Mistral is an optional expert-review lane, not the primary assistant and not an automatic fallback. It is used only for a specific decision where the administrator wants a second opinion.

Permitted review types:

- Compare two locally generated classifications.
- Review a redacted Arabic summary for unclear obligations.
- Identify contradictions in a selected, redacted set of records.
- Improve a draft response that the administrator explicitly selected.
- Provide a risk checklist for an ambiguous payment or compliance case.

### 5.2 Consent flow

Before every cloud review, show a confirmation sheet in Arabic:

1. What question is being sent.
2. Which case and source IDs are involved.
3. A precise data inventory: company display name, document text excerpt, payment amount, dates, or notes.
4. Which fields were removed or masked.
5. The purpose and expected output.
6. Expiry time for the consent.
7. Buttons: `إرسال للمراجعة السحابية` and `إلغاء`.

The default choice is always cancel. The record must show consent without storing the API key or full raw prompt.

### 5.3 Redaction policy

Never send:

- Passwords, API keys, cookies, access tokens, MFA values, browser profiles, or authentication headers.
- Unredacted account credentials or raw portal captures.
- Full audit exports.
- Unnecessary client contact information.
- Attachments unless the administrator explicitly selects a redacted text extraction.

Send only the minimum necessary text. Stable identifiers should be replaced with case-scoped aliases unless the exact identifier is essential to the question.

### 5.4 Cloud request record

Store an immutable record with:

- request ID and case ID;
- administrator ID;
- model/provider identifier;
- approved data classification;
- redaction policy version;
- payload fingerprint, not raw payload;
- start/end time and outcome;
- response fingerprint, source references, and accepted/rejected status;
- error category if the request failed.

### 5.5 Failure and spend control

- One request at a time per case.
- Per-day office budget and per-case request limit.
- Timeout, exponential retry only for transport failures, and no retry after a consent-expired event.
- A circuit breaker after consecutive provider failures.
- Provider failure returns control to the local assistant with a clear “cloud review unavailable” notice.
- No background bulk upload, retraining, or “improve model” data sharing.

---

## 6. OpenCode: engineering adviser and consultant

### 6.1 Scope

OpenCode supports the owner with code, interface, configuration, test-failure, and architecture proposals. It is never given operating data and never becomes a runtime office assistant.

Allowed requests:

- Review a selected source module.
- Explain a test failure from a sanitised error log.
- Produce an implementation plan or code-review proposal.
- Propose a UI improvement from source code and an approved non-sensitive screenshot.
- Identify dead/unsafe configuration patterns.

Prohibited inputs:

- `.env` files, secret stores, keys, passwords, cookies, tokens.
- Production database files, exports, raw records, attachments, portal HTML, or screenshots containing confidential data.
- Full dependency directories, build output, or unrestricted workspace content.

### 6.2 Proposal workflow

```text
Owner request
  → scope selector and redaction preview
  → bounded source snapshot
  → OpenCode proposal
  → proposal inbox
  → owner reviews, accepts for manual implementation, or rejects
  → audit event
```

OpenCode cannot modify files. A later developer workflow may implement an accepted proposal, but it must be a separate, reviewed change with tests.

### 6.3 Isolation requirements

- Run in a temporary isolated directory.
- Pass a sanitised environment only.
- Disable filesystem-writing and shell tools.
- Disable telemetry where supported.
- Permit only an explicit source allowlist.
- Enforce maximum source-file count, maximum file bytes, maximum prompt bytes, and maximum execution time.
- Delete the temporary snapshot after the proposal completes, whether it succeeds or fails.

---

## 7. AI proposal lifecycle

All model output is a proposal, never a direct update.

### 7.1 Proposal states

```text
created → pending_review → accepted → applied
                       ├→ edited → applied
                       ├→ rejected
                       ├→ expired
                       └→ blocked_by_policy
```

`applied` is permitted only for local workspace changes that have an explicit administrator confirmation. `applied` never means an external ETA/SAP action occurred.

### 7.2 Required proposal fields

- proposal ID, case/record ID, provider, model, and policy version;
- input source IDs and content fingerprints;
- output, confidence label, assumptions, and unknowns;
- recommended action type;
- created, reviewed, expired, and applied timestamps;
- administrator decision and edit diff;
- linked audit-event IDs.

### 7.3 High-risk proposal rules

The following require a typed confirmation reason:

- deadline creation or override;
- payment-status update;
- company-name mapping;
- record closure;
- any export or cloud review;
- any draft prepared for external sending.

---

## 8. Company identity and trust rules

Company names must follow this exact hierarchy:

1. `manual`: administrator-approved office name.
2. `source`: verified ETA portal/workspace name captured from an approved source.
3. `unregistered`: no reliable source name available.

An account key, username, list index, placeholder, inferred abbreviation, or AI-generated value can never become a company name.

Display requirements:

- Show a small origin label: `من البوابة`, `أدخلته أنت`, or `اسم غير مسجّل`.
- Show the account key separately as an identifier.
- Use real initials only for a known name; otherwise show a building icon.
- Preserve source name history and manual override history in the audit trail.
- AI may suggest a candidate mapping but cannot write it.

---

## 9. Payments redesign: Financial Workbench

### 9.1 Product goal

Replace the current repeated payment-card wall with a dense, calm financial workbench that helps the administrator decide what needs attention now.

The page must not imply that SAP/ETA payment status is definitive when the source is unknown. It displays source facts, local notes, and review state separately.

### 9.2 Page structure

#### A. Compact command header

- Page title: `المدفوعات`.
- Plain subtitle: `سجل المستحقات كما ظهرت في المصدر، مع متابعة محلية لا تغيّر البوابة.`
- Last successful sync status and exact timestamp.
- Main action: `تصدير النتائج`.
- Secondary action: `إنشاء تذكير`.
- No oversized empty hero area.

#### B. Financial summary strip

Four compact, clickable metrics:

| Metric | Meaning |
|---|---|
| مستحق الآن | Open payments due today or earlier, subject to source status |
| متجاوز الموعد | Unpaid records whose known due date passed |
| خلال 7 أيام | Known open payments due in the next seven days |
| يحتاج تحقق | Missing due date, source status unknown, or conflicting local evidence |

Each metric changes the table filter. Never calculate a total from records whose amount or status is unknown without labelling the uncertainty.

#### C. One filter bar

- Search company, registration number, claim number, or payment reference.
- Company selector.
- State selector: open, overdue, due soon, paid locally, source unknown, all.
- Date range.
- Amount range.
- `مسح الفلاتر` only when filters are active.

The filter state must be shareable by URL parameters and included in exports.

#### D. Payment table

One record per row, RTL, responsive, and keyboard accessible.

| Column | Rule |
|---|---|
| Company | Trusted display name plus origin marker; account key only as secondary metadata |
| Reference | Claim/document/payment reference exactly from source |
| Amount | Western digits and currency; blank when source amount is unknown |
| Due date | Exact known date; `غير معروف في المصدر` when absent |
| Source status | Raw/current status, never translated into “paid” without evidence |
| Local review | Not reviewed, needs review, marked paid locally, evidence pending |
| Attention | Overdue / due soon / source unknown / normal, using text and colour |
| Next action | One context-aware primary action |

Default sorting: overdue known dates, then due today, then due soon, then source-unknown, then newest observation. Do not sort unknown dates as if they were overdue.

#### E. Payment detail drawer

Selecting a row opens a right-side detail drawer, not a new card grid. It contains:

- Source facts and source-observation time.
- Company identity and account identifier.
- Related obligations, tasks, messages, reminders, and evidence.
- Local review timeline.
- AI proposals with provider, source list, and review status.
- Local actions: add note, add evidence, create reminder, request AI review, mark paid locally with required reason.
- Explicit banner: `لا يغيّر هذا الإجراء حالة الدفع في البوابة.`

### 9.3 Visual direction

- Use the established token system, IBM Plex Sans Arabic body text, and Cairo display text.
- Keep the main content dense and table-led on desktop.
- Use a responsive row-to-detail layout on mobile; do not force a desktop card grid.
- Use one accent colour for navigation and primary action.
- Use red only for confirmed overdue items; amber for attention; neutral for missing/unknown source data.
- Remove decorative diagonal arrows, duplicated status chips, and generated avatar initials.
- Keep monetary values visually prominent but not larger than the company/action context.
- Use whitespace to separate work areas, not to create an empty hero.

### 9.4 Payment state separation

Maintain independent fields:

1. `source_status`: what the portal/source last said.
2. `local_review_status`: what the administrator reviewed locally.
3. `evidence_status`: no evidence, pending, attached, or not applicable.
4. `attention_state`: computed presentation state only.

`marked paid locally` is a local statement. It must never overwrite the source status or imply portal payment execution.

---

## 10. Data model additions

Add additive migrations only. Do not rewrite source tables or alter historical source payloads.

### 10.1 AI tables

| Table | Purpose |
|---|---|
| `ai_provider_state` | Provider readiness, health, local/cloud capability, pause state; no credentials |
| `ai_request` | Request metadata, policy/consent state, payload fingerprint, timing, result category |
| `ai_source_link` | Immutable links between a request and selected source record/field/version |
| `ai_proposal` | Structured non-binding proposal and lifecycle |
| `ai_consent` | Mistral case-level consent, inventory, expiry, revoke time |
| `ai_budget_event` | Cloud-review count/cost metadata without secrets |
| `ai_policy_event` | Pause, resume, configuration, and policy-version audit links |

### 10.2 Payment-workbench fields

| Field | Purpose |
|---|---|
| `local_review_status` | Local process state separate from portal source status |
| `local_paid_at` | Local statement timestamp only |
| `local_paid_reason` | Required administrator reason |
| `source_observed_at` | Exact source capture time |
| `reviewed_at` | Last local review time |
| `evidence_status` | Evidence state |
| `attention_state` | Derived/refreshable presentation state, never source truth |

### 10.3 Audit requirements

Audit every:

- AI request start, refusal, completion, failure, and cancellation.
- Mistral consent, expiry, revocation, and approved data inventory.
- Proposal accept/edit/reject/apply action.
- Provider pause/resume and readiness test.
- Payment local-review update, evidence addition, reminder creation, and export.
- Company identity mapping/override.

Never audit secrets, complete cloud payloads, or raw hidden text.

---

## 11. Security and privacy controls

### 11.1 Secrets

- Mistral key stays in protected environment configuration or OS credential storage.
- OpenCode credentials remain managed by OpenCode or a referenced protected file outside the project repository.
- Gemma local endpoint requires loopback binding and an internal request token.
- Logs, crash reports, audit events, exports, screenshots, and test fixtures must redact known secret patterns.
- Never print environment values in health checks, error messages, or UI.

### 11.2 Access and session

- Retain existing authenticated role checks.
- The owner alone may enable cloud review, configure/disable OpenCode proposals, alter AI policy, or export audit/AI records.
- Every high-risk local operation requires recent session confirmation and a typed reason.

### 11.3 Data retention

- Keep local request metadata and proposal decisions according to office retention policy.
- Keep cloud request fingerprints, consent evidence, and response summaries—not unnecessary raw payloads.
- Permit administrator-only deletion of local draft content under a documented retention action; preserve the audit record that deletion occurred.

---

## 12. API and interface contracts

### 12.1 Readiness endpoints

Provide read-only status for each capability:

- `local_assistant`: availability, endpoint health, model identity, queue/latency, paused state.
- `cloud_reviewer`: key configured boolean, safe health-test result, global pause state, remaining request budget.
- `system_adviser`: OpenCode configured boolean, approved model label, proposal queue state.

No endpoint returns keys, paths to secret files, raw command lines, or model-provider credentials.

### 12.2 Request endpoints

All mutating AI endpoints require authenticated owner session, CSRF protection, payload schema validation, rate limit, audit event, and idempotency key.

- Create local assistant request.
- Create cloud-review consent preview.
- Confirm or cancel cloud review.
- Create OpenCode proposal request.
- Accept/edit/reject local proposal.
- Pause/resume a capability.
- Mark payment review state or create reminder.

### 12.3 Error vocabulary

Use clear Arabic user messages and stable internal codes:

- `LOCAL_ASSISTANT_UNAVAILABLE`
- `CLOUD_REVIEW_NOT_CONFIGURED`
- `CLOUD_CONSENT_REQUIRED`
- `CLOUD_CONSENT_EXPIRED`
- `AI_POLICY_BLOCKED`
- `SOURCE_DATA_INSUFFICIENT`
- `PROVIDER_BUDGET_EXCEEDED`
- `OPENCODE_NOT_CONFIGURED`
- `OPENCODE_SCOPE_REJECTED`
- `PAYMENT_SOURCE_STATUS_UNKNOWN`

Errors must say what the administrator can do next without exposing implementation details or secrets.

---

## 13. Acceptance tests

### 13.1 Provider separation

- No visual, configuration, route, documentation, or runtime reference to Ollama remains.
- Gemma works with the network disconnected.
- Turning off Gemma never invokes Mistral.
- Mistral cannot run without a configured key, global enablement, and fresh case-level approval.
- OpenCode cannot receive records, attachments, database files, `.env`, or credentials.

### 13.2 Privacy

- Cloud preview accurately lists every field selected for outbound transfer.
- Cancellation sends no request.
- Expired consent sends no request.
- Logs/audit/exports contain no API key, password, token, cookie, or raw Mistral payload.
- A redaction test proves sensitive fields remain absent at nested object levels.

### 13.3 Proposal integrity

- A model answer with no source links cannot become an actionable proposal.
- A model cannot set a deadline or mark a payment paid directly.
- Admin rejection leaves data unchanged and records the decision.
- Editing a proposal preserves the original output and captures the admin diff.
- Repeated request retries do not create duplicate proposals.

### 13.4 Payments

- The payment view renders a table/list, not a repeated card grid.
- Every payment row displays company origin, reference, amount/source state, due-date state, and one next action.
- Unknown source status is never rendered as paid, overdue, or normal by assumption.
- Payment totals exclude unknown amounts or label them clearly.
- `mark paid locally` never changes a portal/source status.
- Filter URL, table results, exported rows, and summary counts reconcile.
- Desktop, tablet, and mobile views render without horizontal overflow or clipped Arabic text.

### 13.5 Visual proof

- Capture before/after screenshots for payments at 1440px, 768px, and 390px.
- Verify both light and dark modes.
- Verify Western and Arabic-Indic digit settings independently.
- Test keyboard navigation, focus visibility, screen-reader labels, and RTL table order.
- Include at least one long Arabic company name, unknown company name, missing payment date, and unknown status fixture.

---

## 14. Delivery phases

### Phase A — remove ambiguity and create the policy layer

1. Remove Ollama from all runtime/configuration/UI surfaces.
2. Add the provider/state model, pause controls, request policy, audit actions, and redaction versioning.
3. Implement capability health checks using only synthetic/non-sensitive probes.
4. Write data classification and cloud-consent copy in Arabic.

**Exit:** Gemma, Mistral, and OpenCode are visibly and technically separated; no cloud request can occur implicitly.

### Phase B — local Gemma proposal engine

1. Add bounded read tools and structured-response validation.
2. Add source links, proposal objects, review inbox, and admin decisions.
3. Deliver local summary, classification, deadline-extraction, duplicate-review, and payment-review proposals.
4. Add offline/error states and full audit coverage.

**Exit:** an administrator can obtain a local, sourced proposal and accept/reject it without any external transfer or direct source mutation.

### Phase C — Mistral second opinion

1. Add consent preview, field-level redaction, payload fingerprinting, expiry, revocation, rate/budget limits, and secure request transport.
2. Add cloud-review display and audit trail.
3. Run a red-team test for secrets, identifiers, and unapproved attachments.

**Exit:** a Mistral review can occur only after a clear, logged, time-limited approval and remains non-binding.

### Phase D — OpenCode adviser hardening

1. Define a strict source allowlist and rejected-path test suite.
2. Add proposal templates for code review, failed-test diagnosis, and UI recommendations.
3. Verify temporary workspace cleanup and tool denial.
4. Create a visible owner proposal inbox.

**Exit:** OpenCode produces useful engineering advice without production-data access or automatic file modification.

### Phase E — payments financial workbench

1. Add payment review/evidence data fields and migration tests.
2. Build summary strip, filters, table, URL state, and export reconciliation.
3. Build the detail drawer and local review actions.
4. Integrate local AI proposals into the drawer, behind explicit request actions.
5. Complete visual/accessibility QA.

**Exit:** the payments workspace is fast, accurate, modern, source-honest, and usable at office scale.

### Phase F — controlled live activation

1. Enable Gemma 4 for selected local workflows.
2. Observe accuracy, latency, proposal acceptance, rejection reasons, and failures for a fixed pilot period.
3. Enable Mistral only for owner-approved second opinions.
4. Enable OpenCode proposals only for bounded engineering requests.
5. Review audit evidence and decide whether to expand scope.

**Exit:** real operational use proves the system is helpful without expanding external-action authority.

---

## 15. Metrics for trust, not vanity

Track these locally and review them weekly:

- Local AI availability and median response time.
- Proposal acceptance, edit, rejection, and expiry rate by proposal type.
- Deadline suggestions accepted only after source verification.
- Cloud review count, consent cancellations, spend, failure rate, and redaction-policy blocks.
- Payment records with source status unknown.
- Payment records overdue by a known date.
- Stale company/account scans.
- OpenCode proposal usefulness: accepted for manual work vs rejected.
- Safety events: blocked tool calls, attempted unapproved cloud requests, secret-redaction detections, and policy violations.

Never present these as a generic “AI score”. The dashboard must show the underlying facts and allow an administrator to inspect them.

---

## 16. Explicit non-goals for Plan 2.0

- No autonomous ETA/SAP work.
- No payment execution or payment-provider integration.
- No automatic WhatsApp, email, SMS, or client message sending.
- No cloud AI fallback.
- No “self-aware” claims or independent office decision-making.
- No replacement of verified portal data with generated text.
- No automatic code patching by OpenCode.
- No multi-tenant/public-hosting expansion in this phase.

---

## 17. First implementation slice

Implement **Phase A only** before any model workflow changes:

1. Remove Ollama entirely.
2. Add the three-capability Control Center state model.
3. Add a provider pause control and append-only audit events.
4. Add the Arabic privacy/consent copy and safe synthetic health checks.
5. Add tests proving local-only behaviour, no cloud fallback, and OpenCode scope denial.

Do not implement live Mistral review, AI proposals, payment redesign, portal access changes, or messaging in this first slice.
