# SAPAuto Operating System 3.0

## 1. The correction

SAPAuto must stop being a collection of partial dashboard pages and become the firm’s **operating system for tax, payroll, government-portal work, client follow-up, and evidence-driven review**.

This plan starts from the real state of the workspace:

- V8 has a modernising dashboard and read-only ETA bridge, but it does not yet have a payroll workspace or production controls.
- Earlier versions already contain a payroll portal reader for the ETA payroll portal. It reads a complete payroll summary and payroll filing obligations, validates them, normalises Arabic numerals, and refuses partial dashboard data. That capability must be migrated into V8 deliberately.
- The WhatsApp screen was removed because it was not real. Plan 3.0 replaces it with an actual controlled communication service, not another decorative tile.
- The app must work from the ETA portal at `https://www.eta.gov.eg/ar/home` and its authorised modules now. No e-invoice/e-receipt API programme is part of this plan.

The goal is not “more AI.” The goal is a firm-owned operation where data, automation, messages, payroll work, and AI all remain **traceable, bounded, reviewable, and continuously useful**.

---

## 2. Product promise

For every active company, SAPAuto will continuously answer:

1. **What changed on the approved ETA portal views?**
2. **What payroll, payment, filing, document, or client task needs attention?**
3. **What is the source evidence, when was it seen, and how fresh is it?**
4. **Who owns the next action and when is it due?**
5. **What does the AI suggest, and what evidence supports that suggestion?**
6. **What can be sent or changed only after human approval?**

It must never pretend that an unscanned account, stale source, missing payroll input, unknown deadline, or AI conclusion is a verified fact.

---

## 3. Architecture study — what to adopt and what to reject

### 3.1 Patterns adopted from OpenClaw

OpenClaw’s architecture uses an always-on gateway as the control plane for sessions, channels, nodes, tools, approvals, and durable state. Its model of explicit operator scopes, paired devices, durable approvals, and audited tool use is valuable for a firm operation. [Gateway protocol](https://docs.openclaw.ai/gateway/protocol), [operator scopes](https://docs.openclaw.ai/gateway/operator-scopes), [approvals](https://docs.openclaw.ai/cli/approvals)

SAPAuto adopts these patterns:

- one central **Office Gateway** owns job dispatch, status, agent identities, tool permissions, approvals, and audit correlation;
- tool permissions are scoped by agent, company, action class, and time window;
- every phone/browser/worker device is explicitly paired and revocable;
- operations that require approval create a durable approval record; the first valid decision wins and is retained;
- scheduled tasks retain their originating permission policy; and
- disconnected workers receive durable pending work, never hidden work.

SAPAuto does **not** copy OpenClaw as a direct dependency or give a general agent unrestricted shell/browser access. A tax office needs a purpose-built control plane with a small, auditable tool surface.

### 3.2 Patterns adopted from Hermes

Hermes provides persistent memory, skills, multi-channel access, and scheduled unattended work. Its useful idea is an agent that develops repeatable capabilities rather than treating every request as an unrelated conversation. [Hermes source repository](https://github.com/NousResearch/hermes-agent), [Hermes documentation](https://hermes-agent.nousresearch.com/docs)

SAPAuto adopts:

- **versioned office skills**: approved procedures for portal observation, payroll review, reconciliation, client follow-up, and incident handling;
- **durable work memory**: cases, evidence, deadlines, decisions, and approved notes—not opaque model “memories” as the system of record;
- **schedules and watchers**: recurring bounded jobs with measurable outcomes;
- **learning proposals**: the agent may propose a new rule/skill based on recurring reviewed work, but it cannot activate or alter a tax/payroll procedure itself; and
- **model choice**: local-first inference, optional controlled cloud review, and OpenCode reserved for engineering work.

SAPAuto rejects unbounded self-modification. The agent may learn a candidate procedure; a named partner or manager must review, test, approve, version, and publish it.

### 3.3 Design conclusion

```
Human authority → Office Gateway → scoped agents/tools → ETA portal / firm data / communication channels
                     ↓                   ↓
                approvals            immutable evidence + audit
                     ↓                   ↓
                  control room ← cases, tasks, payroll, reconciliation
```

The AI has operational eyes and memory, but humans retain legal, financial, and external-action authority.

---

## 4. The SAPAuto Office Gateway

### 4.1 Responsibilities

The gateway is the only component allowed to:

- register and schedule agents;
- issue work leases and prevent overlapping work;
- register MCP tools and tool policies;
- receive worker heartbeats and source-change events;
- create/revoke approval requests;
- route inbound/outbound communications;
- enforce emergency stop;
- record audit events and evidence references; and
- publish a truthful health/freshness view to the app.

No worker may call another worker directly, send a client message, or access a portal account outside a gateway-issued, scoped job.

### 4.2 Agent identities

| Agent | Purpose | Portal/financial authority | Output |
| --- | --- | --- | --- |
| `portal-watcher` | Read approved ETA pages and identify change | Read-only, one assigned account/session | Versioned source observations + evidence |
| `payroll-watcher` | Read payroll dashboard and filing obligations | Read-only, one assigned account/session | Payroll summary/obligations + evidence |
| `evidence-processor` | Validate, hash, classify, extract uploaded/observed documents | No portal write, no client send | Evidence records and extraction candidates |
| `reconciliation-agent` | Compare portal observations with office/ERP data | Read-only | Exceptions and explanation draft |
| `case-coordinator` | Create/route cases and tasks under approved rules | Case/task creation only | Assigned work and escalation |
| `office-adviser` | Local AI analysis grounded in evidence/knowledge | No mutation, no external send | Cited recommendation/draft |
| `communication-agent` | Prepare/send approved Gmail, Telegram, or WhatsApp messages | Draft only by default; send only with explicit approval | Delivery receipt / failure record |
| `system-adviser` | OpenCode-assisted engineering proposal and test analysis | No production-data access; no deploy authority | Change proposal and tests |
| `supervisor` | Watch agent health, stale data, policy breaches, and queue backlog | May pause/escalate, never fabricate recovery | Incident/approval request |

### 4.3 Work lease and idempotency rules

Every job includes:

- `run_id`, `company_id`, `source_account_id`, `agent_id`, `skill_version`, and policy version;
- a short-lived exclusive lease for that source/account;
- idempotency key; retry/expiry limits; and
- required evidence/result schema.

The same job can be retried safely only where the tool is explicitly read-safe. A portal action, message send, or external write is never retried automatically without an idempotency/delivery guarantee and the required approval.

---

## 5. MCP: the safe tool contract

MCP means **Model Context Protocol** in this plan: it is the internal tool interface for the adviser/agents, not a general remote-control door.

### 5.1 Tool classes

| Class | Examples | Agent may execute automatically? | Approval required? |
| --- | --- | --- | --- |
| Read-only evidence | get company dossier, list cases, inspect a retained observation | Yes, within company scope | No |
| Read-only portal | schedule/read a verified ETA page | Yes, within job policy | No |
| Local workflow write | create draft case, add draft task, attach a classification candidate | Yes if rule is approved; visible immediately | Review required before completion |
| Communication draft | build client message from evidence | Yes | No send authority |
| External communication | send Gmail/Telegram/WhatsApp | Never by default | Explicit human approval per message/batch |
| Financial/tax/portal write | submit, acknowledge, pay, modify filing, change portal state | No | Outside Plan 3.0; separately authorised programme |
| System administration | change configuration, deploy, rotate secrets, modify policy | No | Admin approval with audit |

### 5.2 Required MCP tools for 3.0

Read tools:

- `company.get_dossier`
- `worklist.list`
- `portal.observation.get`
- `payroll.period.get`
- `payment.list`
- `evidence.get`
- `case.get`
- `knowledge.search`
- `audit.query`
- `gateway.health`

Bounded write/draft tools:

- `case.create_draft`
- `task.create_draft`
- `payroll.input_request.create_draft`
- `reconciliation.create_draft`
- `communication.compose_draft`
- `approval.request`
- `agent.pause`
- `agent.resume` (administrator only)

Every tool requires schema validation, company scope, actor/agent identity, correlation ID, audit result, and redacted error handling.

### 5.3 Tool publication rule

An agent sees only the tools required by its active job. The portal watcher does not see communication, deployment, or payroll-write tools. The communication agent does not see portal credentials or raw browser access. The AI never receives a generic database write or shell tool.

---

## 6. Restore payroll as a real V8 module

### 6.1 What exists and what must change

Earlier payroll code already handles two useful ETA payroll views:

- the payroll dashboard summary: current-year tax due, payroll tax payments, employee count, filing counts, payment-timing figures, and employee nationality counts; and
- payroll filing obligations: form, revenue type, period, due date, receipt date, and submitted status.

It also correctly refuses incomplete dashboard summaries and normalizes Eastern/Arabic numerals. This logic is a starting point—not a module to copy blindly. Its previous file storage, low account cap, and isolated desktop workflow are not suitable for V8 or 300+ companies.

### 6.2 Payroll source contract

For every payroll portal observation, store:

- exact company identity and identity provenance;
- portal account reference (secret-free internal reference only);
- page/module read, portal retrieval time, and scan run ID;
- complete dashboard values or an explicit `incomplete` result;
- filing-obligation source fields exactly as observed;
- normalised values with parser/version information;
- immutable source payload hash and permitted evidence capture;
- source freshness/staleness state; and
- read failure classification, never a synthetic zero.

### 6.3 Payroll domain model

```
Company
 └─ PayrollProfile
     └─ PayrollPeriod (month / status / owner)
         ├─ PayrollSourceSnapshot (immutable)
         ├─ PayrollObligation (source fields + local review fields)
         ├─ PayrollInputRequest
         ├─ PayrollException
         ├─ PayrollRunDraft
         ├─ Evidence
         └─ Approval
```

Source fields and local fields are separate. For example:

| Source observation | Local office record |
| --- | --- |
| portal submitted flag | reviewed / not reviewed / disputed |
| portal due date | deadline-basis confirmation or escalation |
| portal tax/payment summary | accountant reconciliation conclusion |
| portal receipt date | evidence attachment / completion approval |

No local action may overwrite a portal observation.

### 6.4 Payroll user experience

Create a dedicated **Payroll** page and include payroll items in the global worklist.

Top area:

- period selector;
- full company name search;
- `requires attention`, `waiting for client`, `awaiting review`, `overdue`, `data stale` counts;
- last payroll portal observation date; and
- a visible account/scan coverage denominator.

Main grid:

| Full company name | Period | Portal filing status | Due-date basis | Inputs | Review | Owner | Last source read | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Detail drawer/dossier:

- payroll source summary;
- filing-obligation table;
- evidence and parser warnings;
- missing-input checklist;
- local review/approval history;
- AI evidence-backed summary; and
- a safe “create draft client request” action.

### 6.5 Payroll completion rules

- A payroll task cannot complete merely because a portal row says submitted.
- A completed office workflow requires defined evidence and an assigned reviewer.
- A preparer cannot approve their own payroll run.
- If a rule/deadline is absent or source data is incomplete, state `needs expert review`.
- No automatic payroll tax calculation, payment initiation, or government submission in Plan 3.0.

### 6.6 Payroll acceptance test

Start with **three authorised companies** and run in parallel with the existing manual process for two complete monthly cycles. Expand only after the payroll lead signs that every result, exception, and missing input was visible and source-backed.

---

## 7. Real WhatsApp, not a placeholder

### 7.1 Product decision

WhatsApp returns only when the firm chooses and configures a genuine, approved business messaging connection. It will not use a fake QR modal, a decorative “coming soon” card, or an uncontrolled personal account browser session.

The channel is an **approval-controlled communication broker**, shared with Gmail and Telegram—not an isolated widget.

### 7.2 WhatsApp capability stages

| Stage | What works | What cannot happen |
| --- | --- | --- |
| 0 — Hidden | Channel is not configured; it is not shown in the app | No implied availability |
| 1 — Connected | Admin sees verified connection/health, webhook status, business identity | No client message send |
| 2 — Draft | AI/accountant can prepare an evidence-linked draft | No automatic send |
| 3 — Approved send | Assigned human approves a specific recipient/template/message; broker sends and records receipt | No send beyond exact approved scope |
| 4 — Controlled batch | Partner approves a named list, content version, time window, and stop rule | No recipient added or text altered after approval |

### 7.3 Required WhatsApp controls

- business-owned channel/number, with authorised provider and firm ownership recorded;
- client contact record, consent/status, and company linkage;
- opt-out/suppression list;
- Arabic template/version registry;
- proof preview showing the full recipient, full company name, linked case, evidence, and exact message;
- explicit approval before send;
- delivery, failure, reply, and opt-out events attached to the company/case;
- office-wide send pause and per-company suppression;
- rate limits, duplicate detection, and quiet-hour policy;
- no credentials/tokens in the UI, prompts, logs, or AI context; and
- a full audit trail.

### 7.4 AI role in WhatsApp

The AI may draft a concise message and list its supporting facts. It may not select a recipient, send, alter approved text, or answer a client as if it were the firm. Replies become a task for an assigned employee unless an approved, low-risk templated response policy exists.

---

## 8. The intelligence layer

### 8.1 Evidence-grounded adviser

The adviser is available from a company, case, payment, payroll period, or document—not as an empty omniscient chat page.

Its answer format is fixed:

1. **What the verified evidence says**;
2. **What has changed**;
3. **What is missing/unknown/stale**;
4. **Suggested accountant next step**;
5. **Sources used**; and
6. **Draft only / requires review** indicator.

It must preserve every full company name, reference, claim number, date, and amount exactly as stored. It cannot replace a number with prose or shorten a legal name.

### 8.2 Knowledge and skills

Create two different managed libraries:

- **Knowledge library:** dated, approved public guidance and firm policy, each with source, effective date, reviewer, expiry/review date, and topic.
- **Skill library:** firm-approved procedures such as “read payroll portal,” “review overdue payroll filing,” “prepare client missing-input draft,” and “reconcile payment evidence.”

Skills are versioned executable policies; knowledge is not. The AI retrieves both only within the relevant company/case scope.

### 8.3 Learning loop

The supervisor may identify patterns, such as a recurring missing document or a portal UI change, and create a **proposal**:

- proposed rule/skill version;
- evidence of the recurring pattern;
- expected benefit and possible harm;
- test cases; and
- required reviewers.

Nothing enters production automatically. This gives the firm the useful “grows with you” behaviour without silently changing tax or payroll operations.

---

## 9. The living app: screens that must exist

### 9.1 Global command centre

One dense, filterable worklist replacing visual card walls:

| Company (full name) | Work type | Source state | Deadline/basis | Assigned to | Evidence | AI flag | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |

Filters: company, service line, source, owner, date range, severity, AI flag, stale/failed, payroll period, and communication state.

Every count must open the exact underlying rows. The page header reports `shown / total`, active filters, source freshness, and excluded/failed accounts. No screen may silently truncate a query.

### 9.2 Company dossier

The permanent header always shows:

- full legal company name, readable without hover;
- identity provenance/verification state;
- assigned team;
- portal freshness and source health;
- open critical items; and
- a pause/suppression control for automation/communications.

Tabs: **Overview · ETA · Payments · Payroll · Documents · Reconciliation · Communications · Cases · Activity**.

### 9.3 Command and approvals centre

Dedicated pages show:

- live agents/jobs; leases, queues, and health;
- pending approvals with full content—not a shortened terminal label;
- message drafts/delivery outcomes;
- paused/stopped agents and reasons;
- failed/parked/stale source accounts; and
- audit trail with evidence links.

### 9.4 Reminders and proactive notifications

The existing `/reminders` page is a working part of the office workflow, not an empty log. It must support both reminders created by the operator and notifications generated by SAPAuto from verified events.

#### Manual reminders

- Put a clear **إضافة تذكير** action at the top of `/reminders`, including when the list is empty.
- The form collects a short title/action, date and time, and an optional note. The operator may link a company and an existing task, obligation, payment, document, or case. Never require a company link when the user does not know it; show an honest unlinked state until it is resolved.
- Display and interpret reminder times in the `Africa/Cairo` time zone. Persist an unambiguous timestamp and the time-zone basis so daylight-saving changes do not silently move a reminder.
- Allow the operator to edit, complete, or cancel a reminder. Show upcoming, due, completed, and cancelled states, with clear next actions and the linked company/item wherever known.
- Manual reminders work in the existing single local workspace. Do not require creating user accounts or introducing multi-user setup just to add one.
- A saved reminder creates a durable, auditable scheduled event. Repeated submits and retries must not create duplicate reminders or duplicate notifications.

#### Notifications generated by SAPAuto

- The Office Gateway and scheduler may create notifications from explicit, versioned rules over stored evidence: for example, a verified due date approaching/passing, a newly observed portal item needing review, or a scan failure/stale source that needs attention.
- Each generated notification names the company when resolved, explains what happened and when, cites the source record/scan and freshness, and offers one clear action to open or resolve it. Unknown dates or unverified conclusions must not trigger fact-like deadline alerts.
- Keep notifications in a durable in-app inbox with unread/read state, timestamps, source links, and delivery outcome. Deduplicate by source event + rule/version; repeated scans update the existing alert instead of flooding the inbox.
- In-app notifications are the default. Browser notifications are optional and require the operator's explicit browser permission. Permission denial must not block in-app alerts.
- Reminder alerts and proactive notifications must not send Gmail, WhatsApp, Telegram, SMS, or other external messages automatically. External delivery remains governed by the communication approval flow in section 7.
- If the local scheduler or app is stopped, keep events queued and report the delay; deliver overdue queued notifications after restart without pretending they were sent on time. Do not promise 24/7 delivery unless the local host, scheduler, and permitted notification surface are confirmed healthy.
- Provide simple controls for browser-notification permission, quiet hours, and notification categories. Quiet hours defer eligible notifications; critical source failures remain visible in the inbox without bypassing external-send approval.

#### Notification reliability gate

Test manual create/edit/complete/cancel, Cairo-time boundaries, app restart with a due queued item, duplicate scan events, browser permission granted/denied, and scheduler failure/recovery. Every generated alert must trace to its rule and source evidence; counts and unread badges must match the visible inbox.

### 9.5 Design requirements

- Arabic-first RTL interface and numerically correct LTR islands for dates/amounts/IDs;
- no ellipsis/clamp/slice for legally meaningful text;
- full names wrap with a layout that grows naturally;
- text + icon + colour for status;
- mobile view retains primary facts and details in a drawer, not a hidden hover-only action;
- visual accessibility and keyboard navigation; and
- page performance target agreed against the real 300+ company dataset.

---

## 10. Data, security, and safety foundation

### 10.1 Fix before expanding scale

1. Authenticate the single office administrator and enforce session checks on every protected route.
2. Replace hard-coded actors with session/agent identity.
3. Implement immutable, content-hashed source observations and retained evidence references.
4. Add `case`, `approval`, `reconciliation`, `source_account`, `source_document`, and `ai_analysis` as real scoped records.
5. Stop `raw_json` overwrites; preserve versions.
6. Remove/mark upstream hard-coded company-name aliases so they cannot masquerade as portal facts.
7. Replace text-file credentials with a protected secrets store and rotate any credentials previously exposed in plaintext.
8. Implement backup, encrypted retention, restore drill, and integrity verification.

### 10.2 Source truth table

Every UI/API field must declare a lane:

| Lane | Can overwrite portal source? | Display label |
| --- | --- | --- |
| Portal observation | Never | ETA source |
| Office review | Never | Office review |
| AI analysis | Never | AI suggestion |
| Approval/action | Never | Approved decision |

### 10.3 Automation stop states

`running → stop_requested → stop_acknowledged → stopped → explicitly_restarted`

If acknowledgement cannot be proven, status is `stop_unconfirmed`; the system refuses new work. A dashboard cannot show a comforting “stopped” label without worker confirmation.

---

## 11. Delivery releases and hard gates

### 3.0.0 — Gateway and truth foundation

Build: Office Gateway, agent registry, leases, stop controls, MCP tool policies, authentication repair, audit identity, source observation/evidence versioning, durable manual reminders and in-app notification queue, local scheduler health/recovery, backup/restore.

**Gate:** No production source scan continues until a single scan can be traced from manifest → job → evidence → result → audit, including a forced-stop test and restore drill. Manual reminders must survive restart, use Cairo time correctly, and be editable/cancellable. A generated notification must be deduplicated, source-linked, visible in-app, and recovered after scheduler restart.

### 3.0.1 — Payroll restoration pilot

Build: migrate proven payroll reader to V8 worker, source contract, payroll data model, Payroll page, global queue integration, input/review/approval workflow.

**Gate:** Three authorised companies, two parallel monthly cycles, zero silently missing portal summary/obligation, payroll-lead sign-off.

### 3.0.2 — Communication broker and real WhatsApp

Build: channel registry, real business connection, contact consent, message drafts, approvals, send/delivery receipts, inbound reply cases, office-wide pause.

**Gate:** Test contacts only; successful controlled delivery/reply/audit/opt-out scenario; no message can bypass preview/approval.

### 3.0.3 — Intelligent operations

Build: local evidence-grounded adviser, knowledge/skill registry, agent supervisor, learning proposals, evaluation suite, OpenCode engineering-adviser boundary.

**Gate:** senior accountant/tax reviewer approves results on held-out firm cases; no uncited answer, material factual loss, or cross-company access defect.

### 3.0.4 — Full office rollout

Build: staged onboarding, 300+ company manifest, scheduler capacity controls, incident response, operational analytics, weekly quality review.

**Gate:** agreed source freshness, queue completion, recovery, audit, and payroll service levels hold across staged cohorts before final expansion.

### 3.0.5 — Write-programme decision (not implementation)

Prepare only a decision paper for any portal submission/payment/write capability. It requires separate legal, client-authority, security, insurance, maker-checker, idempotency, and rollback approval. Plan 3.0 does not authorise writes.

---

## 12. Production quality scorecard

The system is not called “production ready” until all are demonstrated:

- Every active company has verified identity provenance, owner, and source-account configuration.
- Payroll pilot has completed with human review and retained evidence.
- Every portal run reports attempted, completed, failed, parked, stale, and excluded accounts; none disappear into a clean count.
- Full legal names, amounts, claim IDs, dates, and source state are readable throughout desktop/mobile screens and exports.
- Every external message has recipient consent, exact content, approval, delivery result, and audit record.
- Manual reminders are durable/editable/cancellable, and every SAPAuto-generated notification is deduplicated, source-linked, accurately timed, and represented in the in-app inbox; browser alerts are permission-gated and external messages remain approval-controlled.
- Every AI output is evidence-linked, scoped, reviewable, and cannot mutate data/send messages/operate the portal.
- Stop, rate limit, offline worker, source-change, duplicate, and restore scenarios pass operational tests.
- No secret appears in code, text files, logs, prompts, exports, screenshots, or audit rows.
- Named operational, payroll, tax, security, and product owners sign the runbook.

---

## 13. First execution order

Do not open ten partially-finished tracks again. Execute in this order:

1. **Build the gateway, identity, evidence, stop controls, manual reminders, and durable in-app notifications.**
2. **Move the existing payroll reader into a V8 payroll worker and prove it with three companies.**
3. **Ship the real Payroll workspace and global worklist.**
4. **Build the communication broker; connect WhatsApp only after it can actually deliver under approval.**
5. **Enable the AI adviser only on evidence-backed company/case views.**
6. **Scale scheduling and onboarding only after the operating model survives pilot stress and recovery tests.**

## 14. Non-negotiable truth

SAPAuto can become the firm’s sharp 24/7 operating system. It cannot safely become a silent autonomous accountant. The strong system is one that sees every approved source, remembers every evidence-backed fact, drives work to people, drafts intelligently, communicates under approval, and proves what it did. That is the standard Plan 3.0 enforces.
