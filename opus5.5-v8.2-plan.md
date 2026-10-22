# opus5.5-v8.2-plan.md: "Digital Secretary" upgrade for SAPAuto

Written for: the local coding agent (Gemma 4 / OpenCode), with the Owner reviewing and approving  
Baseline: V8.1 codebase study (22 Oct 2026), Phase 0–1 done, Phase 2 in progress  
Goal: turn SAPAuto into a portable application that does the job of a senior tax secretary in a large accounting firm. It reads everything the scraper collects, keeps a separate memory for each company, decides whether each obligation is actually finished, and presents all of it clearly to the people in the firm.  
Rule for this document: it contains no code. Every change is written as a task card that the local model implements, tests and submits for approval.

---

## 0. What your server can do, and what that means for the plan

From your Task Manager screenshot: Intel Xeon E5-2683 v3 (Haswell, 1 socket, 14 cores / 28 threads, 2.0 GHz base, 35 MB L3), 31.9 GB RAM with 6.6 GB in use, no GPU, virtualization off, uptime 72 days.

The CPU supports AVX2 and FMA but not AVX-512. That suits llama.cpp's standard Windows x64 CPU build. With virtualization off you can't use WSL2 or Docker. That's fine, because everything in this plan runs as a native Windows executable, which also helps make the app portable.

On CPU, generation speed depends on memory bandwidth. This chip supports quad-channel DDR4-2133 at up to 68 GB/s (TechPowerUp), but only if all 4 channels have a DIMM. If your 32 GB is two 16 GB sticks, you get half the bandwidth and roughly half the model speed. Task L0.1 checks this first.

The most important finding for model choice: Gemma 4 26B A4B is a mixture-of-experts model. All 26B parameters must sit in RAM, but only about 4B are used per token. At Q4_0 it needs about 14.4 GB, while E4B needs about 4.5 GB and E2B about 2.9 GB (Google AI). On a CPU this means the 26B A4B runs at roughly the speed of E4B per token while being much smarter, so it's the right "senior secretary" brain for this machine. Your current E2B stays on as the fast "junior clerk". The speeds are my estimates; Task L0.2 measures the real ones and decides.

Four housekeeping items:

- 72 days without a reboot means Windows updates are piling up.
- The CPU idling at 1.21 GHz suggests a power-saving plan. Set it to High Performance.
- There are two Ethernet adapters. Make sure the dashboard binds to the right one.
- Use the next reboot as the first test that SAPAuto restarts by itself.

---

## 1. Track A: a real portable application

### A.1 What "portable" means here

One folder, for example `D:\SAPAuto\`, that you can copy to another Windows server and start with a double-click. No installer and no admin rights are needed, except for optionally registering autostart. Every runtime lives inside the folder.

| Folder | Contents |
|---|---|
| `app\` | The code: harness, channels, assistant, launcher (pre-built .next), mcp, domain, db |
| `runtime\node\` | The official Node.js 24 standalone zip, unpacked. Windows offers a .zip "Standalone Binary" that includes node and npm (Stack Overflow). |
| `runtime\llama\` | llama.cpp Windows CPU release binaries (llama-server.exe, llama-bench.exe) |
| `runtime\browsers\` | Playwright Chromium, found through `PLAYWRIGHT_BROWSERS_PATH` (Playwright) |
| `runtime\tesseract\` | Portable Tesseract with ara best data (only if the OCR benchmark picks it) |
| `models\` | GGUF files plus a models.json manifest (name, role, SHA-256, size) |
| `data\` | sapauto.db, documents, .wwebjs_auth, vault |
| `logs\`, `backups\`, `pm2home\` | PM2 runs with `PM2_HOME` pointing here, so nothing goes to the user profile |
| `config\` | sapauto.config.json (ports, schedules, thread counts) and .env.example |

Remove Python entirely. Replacing the Flask/llama-cpp-python wrapper with the native llama-server.exe deletes the last runtime that would need installing.

### A.2 Entry points (the files you said are missing)

One main file, `SAPAuto.cmd`, opens a numbered Arabic/English menu. Each menu option also has its own small script so it can be double-clicked or scheduled:

| Script | What it does |
|---|---|
| Start | Sets the portable PATH and environment, runs Doctor, applies migrations, starts all PM2 apps, opens the dashboard |
| Stop | Graceful PM2 shutdown (the existing shutdown-message path), then a WAL checkpoint |
| Status | Table showing services, heartbeats, outbox backlog, WhatsApp state, model state, last scan |
| Doctor | Checks everything before start (A.4) and prints a clear pass/fail list in Arabic |
| Pair-WhatsApp | Opens the dashboard pairing page and shows the QR code locally only |
| Backup-Now / Restore | Online backup with integrity check, and a guided restore that stops services first |
| Logs | Opens today's log for a selected service |
| Install-Autostart / Remove-Autostart | Registers or removes a Task Scheduler "At startup" task using the folder's current path |
| Export-For-Move / Import-On-New-Machine | Moves the vault safely (A.3) |
| Update / Rollback | Unpacks a release next to the current one, swaps it, checks health, and switches back on failure |
| Bench-Models | Runs llama-bench and saves the results to the DB for the model-routing decision |

### A.3 Moving secrets between machines (critical)

DPAPI-encrypted secrets only decrypt on the same machine under the same Windows user. Your accounts AES key file has the opposite problem: whoever copies the folder gets everything. Both break real portability.

The design: one vault holding a random master key. On each machine, the master key is wrapped with DPAPI so day-to-day running needs no password. There is also a recovery copy wrapped with a passphrase that only the Owner knows (Argon2id key derivation). When the app is moved, the new machine detects that DPAPI unwrap fails and asks for the recovery passphrase once, then re-wraps with that machine's DPAPI. All credentials go through this one vault: ETA accounts, Gmail, Telegram, MCP token, and the Playwright session states. That retires both the separate `accounts.key` file and the split DPAPI store.

### A.4 Doctor checks

- CPU has AVX2.
- Free RAM is at least what models.json needs plus 4 GB.
- Ports 3000/3101/7799 are free.
- Node version matches.
- Chromium is present.
- Each model's SHA-256 matches the manifest.
- DB `integrity_check` passes.
- Disk has at least 15% free.
- Time zone is Africa/Cairo and the clock is in sync.
- The vault unlocks.
- The power plan is High Performance.
- Memory channel population is reported as a warning only.

Every failure gives a fix-it sentence in Arabic.

---

## 2. Track B: present the scraped data the way a secretary works

The data is being collected but not presented well. The first step is to measure that, not redesign by guesswork.

### B.1 Diagnose first (Task B0)

The local model produces a Data Coverage Report. For every table and column it records the percentage of non-null values, a sample value, and whether any API route or UI component reads it. It also compares, per company and per section, what the latest scan saw with what the DB holds and what the dashboard shows. Any field that is scraped but never displayed, or displayed but always empty, becomes a fix item. The output goes into `docs/coverage-report.md`, and the work list for B.2 comes from it.

### B.2 Screens organised around a secretary's day

The design must be Arabic-first and RTL, use Arabic-Indic digits optionally, and show dates in both Gregorian and Egyptian fiscal periods.

**Today (اليوم):** one screen answering "what do I need to do now?". It shows what's due today, this week and overdue; what changed since yesterday (new documents, messages, payments, status changes); items waiting for human review; and alerts that came from reading between the lines (Track C). Each line has one-click actions: assign, done with evidence, snooze with reason, open the company.

**Company dossier (ملف الشركة):** one page per company with the following sections:

- Header: identity, tax registration, responsible accountant, risk score, last successful scan per section.
- Obligations timeline, with the AI verdict and its evidence.
- Payments, matched against obligations.
- Portal inbox, with an AI summary of each message.
- Documents, with the extracted facts.
- Company memory: what the AI knows and believes about this company, editable by staff.
- Notes and an activity history.

**Deadline calendar:** a month view across all companies, filterable by accountant, tax type or company. It can be exported as .ics.

**Review queue:** every decision the AI isn't sure about (resolved_unconfirmed, low-confidence verdicts, contradictions), each with an Accept / Reject / Correct button. Every answer feeds back into company memory.

**Inbox across all companies:** portal messages grouped by urgency, each with a "what this means / what to do" summary.

**Ask the secretary:** a chat that answers from the company's memory and documents, citing its sources (document or message IDs) as clickable links. It is also reachable through WhatsApp and Telegram for staff.

**Reports:** a morning briefing per accountant (WhatsApp/Telegram at 08:30), and a weekly client status report as an Arabic PDF that staff approve before it's sent.

**Data health:** for each company and section, when it last succeeded, how many records came in, schema check status and gaps, so nobody trusts stale data without knowing it's stale.

### B.3 Rules every screen follows

Every number and status shows its source (portal, AI, or human), when it was last seen, and a confidence level. Nothing marked "done" is shown without evidence. Empty states explain why ("this section hasn't scanned successfully since …"). Staff are assigned per company, so a large firm with many accountants works naturally, with escalation to the Owner.

---

## 3. Track C: the Company Brain (reads everything, separate memory per company)

### C.1 Four layers of knowledge

| Layer | What it holds | Who writes it |
|---|---|---|
| Facts | Obligations, payments, forms, messages, documents as scraped | Harness only (ground truth) |
| Evidence | Every document, message and payment broken into text chunks, Arabic-normalised, FTS5-indexed, each with a stable ID | Document reader pipeline |
| Document facts | Structured extraction per document: type, tax type, period, amounts, reference numbers, dates, required action, deadline mentioned | Clerk model, schema-validated |
| Company memory | Facts it believes, patterns, commitments, open questions, staff corrections. Every item has a confidence level and evidence IDs, and is versioned. | Senior model (nightly) plus staff edits |

New tables, which the local model writes as expand-only migrations:

- `evidence_chunks` plus its FTS5 index
- `document_facts`
- `company_memory` (items: kind, statement, confidence, evidence IDs, status, author, valid from/to)
- `company_memory_versions`
- `obligation_verdicts`
- `insights`
- `ai_jobs` (the queue)
- `llm_cache`
- `assistant_conversations`
- `ai_feedback`

### C.2 Reading everything (the document pipeline)

Every new or changed document goes through these steps:

1. Repair the text layer: NFKC normalisation for presentation forms, then RTL line-order repair.
2. If a page has no text layer, run OCR on that page only.
3. Chunk the text and add it to the index.
4. The clerk model extracts structured facts with low-temperature, JSON-constrained output, validated against the schema.
5. Facts that fail validation are retried once with the senior model, then sent to review.

Portal messages and payments follow the same steps. Each document is read once. The content hash ensures nothing is reprocessed unless it changes.

### C.3 Deciding whether each obligation is finished

This works in three steps, and the order matters:

1. **Rules first, deterministic and tested.** Match the obligation to evidence by tax type + period + company: a payment with a matching period and amount within tolerance, a filing receipt in the documents, a form marked submitted, a portal message confirming acceptance. If a strong match is found, record the verdict as `done_by_rule` along with the evidence.
2. **AI adjudication for the unclear cases.** The senior model gets the obligation, the candidate evidence, and the relevant company memory. It returns a JSON verdict: status (filed, paid, filed-not-paid, partially paid, open, unclear), confidence, evidence IDs, a one-paragraph Arabic explanation, and what is missing. Thinking mode is on only for this step.
3. **The human has the final say.** If confidence is below the threshold, or the verdict contradicts the portal, or the obligation is past the 60-day band, it goes to the review queue. A staff answer becomes a memory item ("confirmed by Owner on …") and becomes an example for future prompts.

The AI never marks an obligation resolved without cited evidence. The `absent_scan_streak` counter and `review_state` columns that already exist finally get connected here.

### C.4 Reading between the lines (insight detectors)

Each detector is either a rule or a prompt, and its output is an insight with a severity level, evidence, and a suggested action:

- Audit, inspection or penalty wording in portal messages.
- Changes in a company's pattern, such as one that always filed VAT monthly but missed this month.
- A payment smaller than the declared amount.
- Deadlines mentioned in documents that aren't in the obligations table.
- Repeated e-invoice rejections.
- The same issue showing up across several companies (a possible portal-wide change).
- Contradictions between documents and portal status.
- A company that has gone quiet: no portal activity for an unusual length of time.

### C.5 The nightly company study

For each company, once a night, ordered by risk:

1. The senior model reads its current memory plus only the new evidence since the last study.
2. It updates the memory: adds, revises or retires items, with evidence for each.
3. It re-checks open verdicts and runs the insight detectors.
4. It writes a short "state of the company" summary, which feeds the dossier header and the morning briefing.

The memory is kept as a stable prompt prefix so llama-server's prompt cache can reuse it during the day. First run: the initial full read of 187 PDFs, around 300 messages and 140 payments is a one-time backfill. Schedule it over a weekend.

### C.6 Answering questions

"Ask the secretary" combines the company memory, the top FTS5 evidence chunks, and the structured facts. Answers must cite their sources. If there's no supporting evidence, the answer says "I don't know" and suggests what to check. Conversations keep a 10-message window per user. Taxpayer data never leaves the machine.

---

## 4. Track D: the local LLM runtime for this server

### D.1 Model roles

| Role | Model | Approx. RAM | Used for |
|---|---|---|---|
| Senior | Gemma 4 26B A4B, official QAT Q4_0 GGUF | ~14.4 GB plus KV cache | Verdicts, nightly study, insights, Q&A, coding |
| Clerk | Gemma 4 E2B Q4_0 (already installed) | ~2.9 GB | Document fact extraction, classification, routing, message triage |
| Optional coder (A/B test) | Qwen3-Coder-30B-A3B, 4-bit | ~18 GB for 6+ tok/s (Unsloth) | Coding sessions only. Never loaded at the same time as the Senior. |

Google publishes official QAT Q4_0 GGUF builds of every Gemma 4 size for llama.cpp, designed to keep quality close to the full-precision model (Google AI). Prefer these over community quantisations. Don't go below Q4, for the sake of Arabic quality.

Why not the 31B dense model: it needs about 17.5 GB, and on a CPU every one of its 31B parameters is used for every token. It would be several times slower than 26B A4B on this machine.

### D.2 RAM budget (32 GB)

OS plus current services use about 6.6 GB. Senior with 2 slots and a moderate context is about 16–18 GB. Clerk is about 3.5 GB. Three Playwright contexts are about 1.5–2 GB. That totals roughly 28–30 GB, which is tight but workable. The rules:

- Clerk context is capped at 8k tokens.
- Senior runs 2 parallel slots of 16k each (measure, then adjust).
- When RAM is under pressure, the job queue pauses AI jobs rather than letting Windows swap.
- The coder model is only loaded in the coding window, with the Senior unloaded.
- If you ever add RAM, 64 GB makes everything comfortable. It's the cheapest upgrade with the biggest impact.

### D.3 Server settings (the local model turns these into config)

- Threads equal to physical cores, not logical. Daytime: Senior uses 8 threads and Clerk 4, leaving the rest for Chromium and Node. Night window (00:00–06:00): Senior uses 12 threads, and the harness drops to high-risk accounts only.
- Never run two heavy inferences at once. They compete for the same memory bandwidth.
- Prompt caching on. Each company's memory is a stable prefix.
- JSON-schema-constrained output for every extraction and verdict.
- Thinking mode off by default. Gemma 4 supports turning it off through llama-server's chat-template kwargs (Unsloth). Turn it on only for verdict adjudication and the nightly study.
- Low temperature for extraction. Google's defaults only for open-ended chat.
- Each model is its own PM2 app on 127.0.0.1 (Senior on 7799, Clerk on 7798), with health checks and autorestart on.
- Optional later: Gemma 4 ships multi-token-prediction draft models for speculative decoding (Google AI). Only adopt this if Bench-Models shows a real gain on CPU.

### D.4 One AI job queue with priorities

Every AI call goes through `ai_jobs`, in this order:

1. Interactive questions from staff (a Senior slot is reserved for these during the day).
2. New-document reading.
3. Obligation verdicts.
4. Insight detectors.
5. Nightly study.
6. Coding tasks.

Jobs carry a lease, a retry count, a timeout, the model used, token counts and duration. The scheduler respects the day/night window and the RAM guard. Deadline and penalty alerts never wait on this queue: they come from the rules engine.

### D.5 Benchmark gate (no decisions without data)

Bench-Models records prompt-processing and generation speed for each model at several thread counts and stores the results. Decision rules:

- If the Senior's prompt processing is below about 25 tokens/s, the Senior only handles verdicts and the nightly study, and the Clerk handles all document reading.
- If the nightly study takes longer than 5 hours, study only companies with new evidence, and do a full study weekly.
- If the coder model doesn't beat the Senior on the coding eval set (E.3), delete it.

---

## 5. Track E: how the local model codes this plan

You asked that the local LLM write the code. That's workable only with small, test-gated tasks. A CPU model with a limited context will make mistakes if it's given large, vague goals.

### E.1 Protocol for each coding session

1. Take exactly one task card from TASKS.md.
2. Read only the files listed on the card, plus `docs/codebase-study.md` §4 (invariants) and §8 (constraints).
3. Write the tests from the card's "done when" section first.
4. Write the smallest change that makes them pass. Produce a diff, not whole files.
5. Run the full test suite. If it fails twice, stop and write a short note on what's blocking.
6. Save the result to `code_upgrade_proposals` for Owner approval. Never apply changes directly to `current`.
7. Run it through OpenCode pointed at the local llama-server (OpenAI-compatible) in an isolated copy of the repo. No `.env`, `data`, or `.wwebjs_auth` directories in that copy.

### E.2 Task card template (every card in TASKS.md follows this)

ID · Track · Goal (one sentence) · Why · Files allowed to touch (at most 4) · Inputs and context · Steps (at most 6) · Done when (testable checks) · Tests to add · Migration (yes/no, expand-only) · Rollback · Maximum size (about 300 changed lines) · Depends on.

### E.3 Making the coder reliable

- Keep a small coding eval set of 15 past real fixes, each with tests, and use it to choose the coder model and to catch regressions.
- Run coding sessions in the night or weekend window.
- The Owner reviews every diff.
- Security-sensitive cards (vault, auth, TOTP, live delivery) are always reviewed line by line, and can go to a stronger model if the Owner chooses.

---

## 6. Backlog (task cards in summary; the local model expands each one using E.2)

### Track L: runtime and benchmarks (first)

| ID | Task | Done when |
|---|---|---|
| L0.1 | Hardware report script: DIMM count, slot positions and speeds, power plan, AVX2 | Report saved, with warnings if channels aren't fully populated or the power plan is balanced |
| L0.2 | Bench-Models script and a `model_benchmarks` table | Speeds recorded for E2B, E4B and 26B A4B at 8/12/14 threads |
| L1 | Replace Flask with llama-server.exe on 7799, same API for existing callers | All current assistant tests pass; Python is gone from ecosystem |
| L2 | Add the Clerk server on 7798, plus models.json with SHA-256 | Doctor checks the hashes; both servers pass health checks |
| L3 | `ai_jobs` queue with priorities, leases, RAM guard, day/night windows | Load test: an interactive question is answered while the nightly study runs |
| L4 | LLM router with local-only routing for client data, circuit breaker, `llm_cache` | Killing the model causes deferred jobs, not crashes |

### Track A: portable app

| ID | Task | Done when |
|---|---|---|
| A1 | Portable folder layout and path resolution relative to the folder | The app runs from `E:\Test\SAPAuto` without changes |
| A2 | Bundle runtimes (Node zip, Chromium via env var, llama binaries) | It starts on a clean Windows VM with nothing installed |
| A3 | `SAPAuto.cmd` menu plus the individual scripts from A.2 | Every menu option works and messages are in Arabic |
| A4 | Doctor | Each failed check produces an Arabic fix-it message |
| A5 | Unified vault (DPAPI wrap plus passphrase recovery), migrating the existing secrets | Moving to a second machine asks for the passphrase once, then everything works |
| A6 | Autostart through Task Scheduler with the folder path | A reboot with nobody logged in brings everything back within 3 minutes |
| A7 | Update/Rollback with side-by-side releases | A broken release is rolled back automatically by the health check |

### Track B: secretary experience

| ID | Task | Done when |
|---|---|---|
| B0 | Data Coverage Report | `docs/coverage-report.md` lists every unused or empty field |
| B1 | Fix the gaps the report finds (one card per section) | Every scraped field appears where a secretary would look for it |
| B2 | Today screen | All of today's work is visible without opening another page |
| B3 | Company dossier | All 8 sections described in B.2 render with source, last-seen and confidence labels |
| B4 | Review queue with accept/reject/correct feeding memory | One correction creates a memory item and an audit row |
| B5 | Staff assignment per company, plus escalation | Each accountant sees only their companies by default |
| B6 | Morning briefing per accountant | Arrives at 08:30 on that accountant's channel |
| B7 | Weekly client report as an Arabic PDF with an approval step | Nothing goes to a client without approval |
| B8 | Data health page | Stale sections are flagged in red with the date of the last good scan |
| B9 | Calendar plus .ics export | Opens correctly in Outlook |

### Track C: Company Brain

| ID | Task | Done when |
|---|---|---|
| C1 | Arabic text repair plus a needs-OCR detector | Golden Arabic samples come out readable |
| C2 | OCR benchmark: Tesseract vs Gemma vision on 30 scanned pages | Character error rates recorded; winner wired in |
| C3 | `evidence_chunks` plus an FTS5 index with Arabic folding | Searching "إقرار" also finds "اقرار" |
| C4 | `document_facts` extraction by the Clerk, schema-validated | ≥ 90% exact match on 50 golden documents |
| C5 | Rules engine for obligation matching (moved out of monitor.js) | Unit tests for each tax type and period format |
| C6 | AI verdicts plus the review threshold | No "resolved" status without evidence IDs; low-confidence verdicts reach the queue |
| C7 | `company_memory` plus versions plus editing in the dossier | Every memory item has evidence and staff can edit it |
| C8 | Nightly company study (delta only) | Finishes inside the night window; updates the memory and the summary |
| C9 | Insight detectors (one card per detector) | Each one fires on a fixture case and stays silent on a clean one |
| C10 | Ask-the-secretary with citations, also via WhatsApp/Telegram | Every answer cites sources or says it doesn't know |
| C11 | Backfill job for existing documents (weekend run) | All 187 PDFs, messages and payments are read and indexed |

### Track S: finishing the Phase 2 security work already in progress

| ID | Task | Done when |
|---|---|---|
| S1 | Change `requireRole('Admin')` to `'Owner'` at the 4 sites | A test proves a Viewer gets a 403 |
| S2 | Remove `V8_OPEN_ACCESS` | The dashboard requires login |
| S3 | Login rate limit plus TOTP for Owner actions | Live mode and account changes require TOTP |
| S4 | MCP tools least-privilege (read-only by default) | Write tools need explicit enabling |

---

## 7. Order and milestones

- **Week 1:** L0.1, L0.2 (decide using real numbers), S1–S2, B0.
- **Weeks 2–3:** L1–L4, A1–A4, B1. Milestone: the app is portable and starts with one click, and the coverage gaps are fixed.
- **Weeks 4–5:** C1–C5, A5–A6, B2–B3. Milestone: every document is read, and rule-based verdicts appear in the dossier.
- **Weeks 6–7:** C6–C8, B4–B6, S3–S4. Milestone: a separate memory per company, the nightly study, and the review queue are live.
- **Weeks 8–9:** C9–C11, B7–B9, A7. Milestone: "Digital Secretary" v8.2. Backfill done, morning briefings running.

**Definition of done for v8.2:**

- Every obligation shows a verdict with evidence or sits in review.
- Every document has been read once and its facts extracted.
- Each company has a living memory that staff can edit.
- Each accountant gets a morning briefing.
- The app runs from a copied folder on a clean machine after one passphrase prompt.
- No taxpayer data leaves the server.

---

## 8. Risks and guardrails

- **AI false confidence is the biggest business risk.** Mitigations: rules first, verdicts must cite evidence, a review threshold, and a monthly spot check by the Owner of 20 random AI verdicts, with the accuracy recorded.
- **CPU speed:** the benchmark gate (D.5) and delta-only studies keep the AI workload inside the night window. If it doesn't fit, cut the scope; don't buy cloud.
- **RAM pressure:** the RAM guard pauses AI work, the coder and Senior never run together, and 64 GB is the recommended upgrade.
- **Mistakes by the local coder:** small cards, tests first, Owner approval, an isolated workspace, and line-by-line review for security cards.
- **Portability vs. security:** the vault is useless without the passphrase. Store the passphrase offline (a password manager plus a sealed paper copy).
- **WhatsApp:** it is still an unofficial client. Telegram and email stay as equal channels for staff.
- **Legal:** this is a tool that assists a licensed accountant. It never submits or pays anything on the portal. Under Egypt's data-protection rules, keep client data local and get counsel to confirm your obligations.
