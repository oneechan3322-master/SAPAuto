# SAPAuto V8 — God-Level Upgrade Tasks (Rolling Plan)

The driver: a god-level tax visor over the live scraping loop —
every item here must SHIP against the real system, not a demo page.

## Standing Rules
- N (No Lies): every count/status/date written is verified at write time and attributed to a source.
- Q (Cairo Calendar): all date math resolves through the Egyptian calendar; no silent +02:00 anchors.
- P (No unapproved send): WhatsApp fan-out only through the reply-draft approval flow.
- R (Privacy Orbit): document text leaves the machine only to the local model 127.0.0.1:7799.
- Fail closed on missing PDF, unreadable page, or unparsable model output — degrade loudly, never silently.

## A) Scrape Loop - Live-Watch Audit
| # | Task                                                                                                            | Status |
|---|------------------------------------------------------------------------------------------------------------------|--------|
| A1 | Un-pause harness (paused=0) and watch one full live cycle under observation: login -> gallery/messages/doc/obligations -> rows reach SQLite with truthful counts. | done (2026-10-17: paused=0, heartbeat fresh, cycle 2026-10-16 19:55Z done 4/26/0; accounts 533158788/315240679/205971997/marwanhamada all ready, 0 failures; 11/5/8/7 docs) |
| A2 | Failure ledger review: consecutive_failures, parked accounts, last_error, reconciler health; fix any silent swallow.                                             | done (2026-10-17: all four accounts ready, failures 0, park null, last_error empty) |
| A3 | Scraper code review for the unverified-du-fault family: bounded retries, no oversized ingestion, no fixed crawl wait where keepalive covers.                      | pending |
| A4 | Sanity pass: spider only observes portals — no portal writes from scraping lane; downloads stay under data/pdfs (privacy orbit).                                 | done (2026-10-17: scraper config downloadsDir=v8/data/pdfs shared with visor orbit; pdf-reader refuses outside-root paths with outside-allowed-root) |

## B) Tax Visor - PDF Comprehension (AI)
| # | Task                                                                                                                     | Status |
|---|---------------------------------------------------------------------------------------------------------------------------|--------|
| B1 | New `assistant/pdf-reader.cjs`: opens a stored PDF via pdfjs-dist (legacy CJS), bounded pages/chars, Arabic quote-safe normalization, explicit PdfReadError taxonomy; never reads outside data/pdfs. | done (2026-10-17: pdfjs-dist@3.11.174, PdfReadError codes invalid-path/outside-allowed-root/missing-file/not-a-file/empty-file/oversized-file/not-a-pdf/unreadable-pdf/too-many-pages; 30 pages / 40k chars caps) |
| B2 | `live-analyst.studyDocument`: pass TRUE PDF text into the Gemma prompt (today the model is handed a path, not content).      | done (2026-10-17: studyDocument reads PDF text, builds document-exhibit prompt, 500-token exhibit turn with 300s timeout; verified live on إخطار 180000222364 — 2 pages/2217 chars into the model) |
| B3 | Structured exhibit extraction (JSON-strict then best-effort salvage): doc type, action summary, dates on paper, legal posture (definitive or open to appeal) or legal status. | done (2026-10-17: pdf-visor.cjs extractJsonObject depth scanner + composeExhibitStudy; all three live PDFs studied 09:57–11:14Z) |
| B4 | Extracted dates land on the task row (tasks.deadline when parseable) + events ledger (task_date_extracted source=pdf).        | done (2026-10-17: persistTaskExhibit fills deadline ONLY when empty + urgency 'review'; pdf_studied always, task_date_extracted only when a date was genuinely applied; event payload carries exhibited_date + deadline_filled truth) |
| B5 | Prompt space check: model context bound - PDF chunk slice (12,000 chars max in prompt). Residuals pushed to a follow-on turn if needed. | done (2026-10-17: sliceForPrompt 12k cap with truncated flag reported in prompt) |
| B6 | gemma enrichment for obligations and messages during their study lanes (shared pdf-reader callers).                          | pending |
| B7 | Manager visor sweep: unstudied PDF tasks heal without waiting for the next scrape (assistant manager cycle, limit 2/interval, sweepBusy guard). | done (2026-10-17: sweepUnstudiedDocuments wired into manager; healed ملاحظات قبول + نموذج ١٩ دمغة live within minutes) |

## C) Debt-Truth Integration (Legal Engine Tie-In)
| # | Task                                                                                                                                                 | Status |
|---|-------------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| C1 | When a study extracts a missive deadline (e.g., attendance / inspection), route through domain/legal-deadlines date resolution + deadline stamps once. | in progress (visor writes ISO date + stamps; full legal-deadlines routing for §14/mo3ad deadlines still to verify against anchor_mode) |
| C2 | Study records slot into records-view already — verify visor fields render in the existing UI cards (no new fake labels).                                | pending |
| C3 | Reminder chains: stale documents (deadline pasado for APW when months past) that haven't progressed get owner-focus reminders (respect P rule).         | pending |

## D) Daily Digest (WhatsApp, 11:44 Cairo)
| # | Task                                                                                                            | Status |
|---|------------------------------------------------------------------------------------------------------------------|--------|
| D1 | `channels/daily-digest.js` — gates (daily_digest_enabled, daily_digest_chat, whatsapp_connected, digest_last_day, cairo clock >= daily_digest_time default 11:44), Arabic report, PDF attachments (max 8, orbit-checked). | done (tests 6/6) |
| D2 | Consent words in the office group: `تفعيل اليومية` / `إيقاف اليومية` by an Owner/Operator via linked WhatsApp; audit daily_digest.consent_granted/revoked. Digest's own consent replaces the blanket message_mode gate (Rule P). | done (tests 6/6) |
| D3 | WhatsApp UI: settings capabilities + channel-center WhatsApp tile with pair/QR modal + /api/channels pair & disconnect actions; whatsapp-web.js + qrcode installed. | done (build OK, /settings 200, /api/channels whatsapp.available=true) |
| D4 | Live pairing: user clicks اربط واتساب → scan QR → whatsapp_connected=true → then reactor sends تفعيل اليومية from the office group.                              | pending (awaiting user's phone scan) |

## E) Loop Discipline (over and over)
1. Execute one lane at a time; verify suite + live each time.
2. Any drift from rules -> stop, fix honestly, not patch around.
3. On completion: recount the ledger (docs studied / dates captured / failures reset), record in task.txt, un-pause the loop, and start watching the next cycle.

*Latest suite: 177 tests / 172 pass / 0 fail / 5 skipped (2026-10-17). Last updated: 2026-10-17.*
