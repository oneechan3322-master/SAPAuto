# Payroll Scraping — SAPAuto V8

**Status:** reference documentation for the payroll portal scraping implementation ported from SAPAuto V6.
**Scope:** read-only observation of the ETA ZMCF_PAYROLL SAP UI5 application. No filing, payment, or portal write actions are ever performed.

---

## 1. Overview

Payroll scraping is the automated, read-only collection of payroll data from the Egyptian Tax Authority (ETA) payroll portal (`ZMCF_PAYROLL`). The scraper authenticates per company account via Keycloak SSO, opens an isolated browser context per account, reads the payroll dashboard summary tiles and the filing obligations table, normalises the data, and persists it atomically to `data/payroll.json`.

**Design principles:**
- **Read-only only.** The scraper never submits, pays, accepts terms, or edits portal records.
- **Abort-on-failure.** Any per-account failure throws and aborts the entire scan. A partial read is never persisted.
- **Isolation.** Each account gets its own isolated Playwright browser context; Keycloak cookies never cross accounts.
- **Completeness-gated.** Data is written only when every required dashboard tile and every table row passes validation.
- **No partial data.** If any gate fails, nothing is written for that scan cycle.

---

## 2. Portal URLs

The payroll portal is a **separate SAP application** from the main ETA MCF portal (`ZETA_MCFAPP`). It does not share the Workspace payments data contract.

| Constant | Value | Purpose |
|----------|-------|---------|
| `SAP_PAYROLL_PORTAL_URL` | `https://uptp.eta.gov.eg/sap/bc/ui5_ui5/sap/ZMCF_PAYROLL/index.html?sap-client=300&sap-language=AR` | Base payroll portal (dashboard) |
| `SAP_PAYROLL_FILING_OBLIGATIONS_URL` | `{SAP_PAYROLL_PORTAL_URL}#/filing_obligations` | Filing obligations view |

Source: `SAPAuto v6.0/electron/v3-runtime/src/automation/portal/portal-urls.js`

---

## 3. Architecture

### 3.1 Component map

```
┌─────────────────────────────────────────────────────────┐
│  v3-engine.cjs  —  runPayrollScan() entry point          │
└──────────────────────┬──────────────────────────────────┘
                       │ delegates to
┌──────────────────────▼──────────────────────────────────┐
│  payroll-portal.cjs — scanPayrollPortal()                 │
│                                                         │
│  1. safeAccountList(credentials)   validate ≤ 5 accounts│
│  2. ensurePayrollPage()            navigate + Keycloak  │
│  3. waitForPayrollDashboardSummary() wait 6 UI5 tiles   │
│  4. readDashboardSummary()         extract 9 values     │
│  5. navigateToFilingObligations()  click obligations    │
│  6. readAllPayrollRows()           filter + grow + read │
│  7. normalizePayrollRows()         schema validation    │
│  8. mergePayrollAccounts()         merge by company     │
│  9. writeJsonAtomic()              data/payroll.json    │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Entry point

`runPayrollScan({ credentials })` in `v3-engine.cjs` is the orchestrator entry. It:
- Rejects if a scan is already running (`this.running`)
- Delegates to `scanPayrollPortal({ directory, credentials })` from `payroll-portal.cjs`
- Logs start/finish; re-throws on failure

### 3.3 Data consumer

`readPayrollData(filePath)` in `payroll-portal.cjs` validates and reads `data/payroll.json`. It is consumed by `operational-data.cjs` to aggregate payroll alongside payments, obligations, and messages for the launcher dashboard.

---

## 4. Scraping Pipeline

### Step 1 — Account validation (`safeAccountList`)

- Accepts the credentials array
- Drops entries with `kind === 'email'`
- Rejects labels/usernames containing `[`, `]`, `\r`, `\n`, `|`
- Rejects duplicate usernames
- Caps at **5 accounts**
- Returns the sanitised account list

### Step 2 — Navigate to payroll portal (`ensurePayrollPage`)

```javascript
await page.goto(SAP_PAYROLL_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
```

- If a Keycloak username input is visible, calls `loginToKeycloak(page, username, password, { timeoutMs: 60000 })`
- Re-navigates to the portal URL after login
- Waits for `window.sap?.ui?.core?.Element?.registry` to exist (UI5 loaded)
- Throws if the page URL does not start with the payroll portal base URL
- Calls `waitForPayrollDashboardSummary(page)`

### Step 3 — Wait for dashboard summary (`waitForPayrollDashboardSummary`)

Waits up to 60 seconds for all 6 required `sap.m.GenericTile` cards to appear in the UI5 element registry, each with the expected number of non-empty `sap.m.NumericContent` values.

Throws `TimeoutError` → `"لم يكتمل تحميل ملخص وحدة الرواتب من البوابة؛ لم تُحفظ قراءة جزئية."` if the deadline passes.

### Step 4 — Read dashboard summary (`readDashboardSummary`)

Evaluates in the browser page context:
1. Accesses `window.sap.ui.core.Element.registry.all()`
2. Filters controls to `sap.m.GenericTile` instances
3. For each tile, reads `getHeader()` and `getTileContent()` → `getContent()` → `sap.m.NumericContent.getValue()`
4. Returns `{ header, values[] }` for every tile

`normalizePayrollSummary(cards)` maps the 6 Arabic headers to 9 typed keys:

| Arabic tile header | JSON key(s) | Value count |
|--------------------|-------------|-------------|
| إجمالي الضريبة المستحقة عن السنة الحالية | `taxDueCurrentYear` | 1 |
| مدفوعات ضريبة المرتبات عن السنة الحالية | `paymentsCurrentYear` | 1 |
| عدد الموظفين الحاليين | `employeeCount` | 1 |
| بيانات التزامات التقديم عن السنة الحالية | `submittedFilings`, `unsubmittedFilings` | 2 |
| بيانات الضريبة المسددة عن السنة الحالية | `paidOnTimeCurrentYear`, `paidLateCurrentYear` | 2 |
| تصنيف الموظفين حسب الجنسية | `egyptianEmployees`, `foreignEmployees` | 2 |

Arabic-Indic digits (`\u0660-\u0669`) and Extended Arabic-Indic digits (`\u06f0-\u06f9`) are converted to ASCII digits before parsing. Commas and the Arabic thousands separator (`\u066c`) are stripped. Each value must parse as a safe integer ≥ 0.

Throws on missing tile, wrong value count, non-numeric or `غير متاح` values:
- `"تعذّر التحقق من اكتمال ملخص وحدة الرواتب."` — missing tile or wrong value count
- `"قيمة ملخص الرواتب غير صالحة: <field>"` — non-numeric value
- `"قيمة ملخص الرواتب خارج النطاق: <field>"` — not a safe integer

### Step 5 — Navigate to filing obligations (`navigateToFilingObligations`)

- If already on `#/filing_obligations`, returns immediately
- Clicks the tile matching Arabic regex `/التزامات التقديم/` (role `option`)
- Waits for `page.url().hash === '#/filing_obligations'` (30s timeout)
- Throws `"لم يتم العثور على بطاقة التزامات الرواتب في الصفحة الرئيسية."` if the tile is not found

### Step 6 — Read all payroll rows (`readAllPayrollRows`)

1. **Switch filter** — `switchSelectFilter(page, { controlId: 'filingObligationFilter', targetKey: 'all', visibleText: 'الكل', ... })`
   - Discovers options `"لم يتم التقديم"` and `"الكل"`
   - Selects the item with key `'all'` and text `'الكل'`
   - Throws `"تعذّر اختيار عرض كل التزامات الرواتب؛ لم تُحفظ قراءة جزئية."` on failure

2. **Growing trigger** — `clickGrowingTrigger(page, { maxClicks: 50, delayMs: 700 })`
   - Clicks the "show more" trigger up to 50 times
   - Throws `"قائمة التزامات الرواتب تجاوزت حد القراءة الآمنة."` if truncated

3. **Wait for stable table** — `waitForTableStable(page, { timeoutMs: 30000 })`
   - Throws `"جدول التزامات الرواتب لم يستقر؛ لم تُحفظ قراءة جزئية."` on timeout

4. **Read rows via UI5 binding context** (page.evaluate):
   - Finds the `sap.m.Table` whose `items` binding model is `'FilingObligations'`
   - Verifies filter is set to `'all'`
   - Verifies table exists
   - Verifies binding length is final (`binding.isLengthFinal()`)
   - Verifies visible items count equals total binding length
   - Reads each row's binding context object (`getBindingContext('FilingObligations')?.getObject()`)

Completeness gate reasons:
| Reason | Meaning |
|--------|---------|
| `payroll_filter_not_verified` | Filter not set to `"all"` |
| `payroll_table_not_found` | No `FilingObligations` table |
| `payroll_rows_not_final` | Binding length not final |
| `payroll_rows_incomplete` | Visible items < total |
| `payroll_context_missing` | Missing binding context objects |

### Step 7 — Normalise rows (`normalizePayrollRows`)

Each raw UI5 row object is validated and mapped:

| Raw field | Output field | Type / constraint |
|-----------|-------------|-------------------|
| `FilingObligationID` | `id` | `stableId(username, FilingObligationID)` — SHA-256, first 32 hex chars |
| (account) | `company` | Account label (trimmed) |
| `FormBundleTypeDescription` | `form` | String, max 200 chars |
| `RevenueTypeDescription` | `revenueType` | String, max 200 chars |
| `Period.Description` | `period` | String, max 120 chars |
| `Period.StartDate` | `periodFrom` | `YYYY-MM-DD` via `asDate()` |
| `Period.EndDate` | `periodTo` | `YYYY-MM-DD` via `asDate()` |
| `DueDate` | `dueDate` | `YYYY-MM-DD` via `asDate()` |
| `ReceiptDate` | `receiptDate` | `YYYY-MM-DD` via `asDate()` |
| `FormBundleSubmitted` (`''` \| `'X'`) | `submitted` | boolean (`'X'` → true) |

Validation rules:
- Row count must not exceed `MAX_PAYROLL_ROWS` (1,000)
- `FilingObligationID` must be a non-empty string
- `FormBundleSubmitted` must be `''` or `'X'` (no other values allowed)
- All date fields are normalised by `asDate()` which accepts `Date` objects or `YYYY-MM-DD...` strings

### Step 8 — Merge accounts (`mergePayrollAccounts`)

- Existing accounts are keyed by `company.trim().toLocaleLowerCase('ar')`
- Updated accounts overwrite existing entries with the same normalised company name
- Accounts not in the updated set are preserved
- Returns `Array.from(map.values())`

### Step 9 — Persist atomically (`writeJsonAtomic`)

Writes to `data/payroll.json`:
```json
{
  "version": 1,
  "scannedAt": "<ISO 8601 timestamp>",
  "accounts": [ { ...normalised account... } ]
}
```

Uses atomic write pattern: write to temp file → `fsync` → `rename`. On failure, the previous file is untouched.

Returns: `{ ok: true, accountsScanned: N, obligationsScanned: count, scannedAt: "..." }`

---

## 5. Data Schema — `data/payroll.json`

**Version:** 1  
**Max accounts:** 5  
**Max rows per account:** 1,000

### Top-level structure

| Field | Type | Constraint |
|-------|------|------------|
| `version` | integer | Must be `1` |
| `scannedAt` | string | ISO 8601 timestamp |
| `accounts` | array | Max 5 items |

### Per-account structure

| Field | Type | Constraint |
|-------|------|------------|
| `company` | string | Non-empty |
| `scannedAt` | string | Non-empty ISO 8601 |
| `summary` | object | All 9 keys present, safe integers ≥ 0 |
| `obligations` | array | Max 1,000 items |

### Summary object (all 9 keys required)

| Key | Type | Constraint |
|-----|------|------------|
| `taxDueCurrentYear` | safe integer | ≥ 0 |
| `paymentsCurrentYear` | safe integer | ≥ 0 |
| `employeeCount` | safe integer | ≥ 0 |
| `submittedFilings` | safe integer | ≥ 0 |
| `unsubmittedFilings` | safe integer | ≥ 0 |
| `paidOnTimeCurrentYear` | safe integer | ≥ 0 |
| `paidLateCurrentYear` | safe integer | ≥ 0 |
| `egyptianEmployees` | safe integer | ≥ 0 |
| `foreignEmployees` | safe integer | ≥ 0 |

### Per-obligation structure

| Field | Type | Constraint |
|-------|------|------------|
| `id` | string | SHA-256 hash, 32 hex chars |
| `company` | string | Non-empty |
| `form` | string | Max 200 chars |
| `revenueType` | string | Max 200 chars |
| `period` | string | Max 120 chars |
| `periodFrom` | string | `YYYY-MM-DD` |
| `periodTo` | string | `YYYY-MM-DD` |
| `dueDate` | string | `YYYY-MM-DD` |
| `receiptDate` | string | `YYYY-MM-DD` |
| `submitted` | boolean | `true` / `false` |

### Validation on read (`readPayrollData`)

- File missing (`ENOENT`) → returns `{ available: false, count: 0, scannedAt: '', accounts: [] }`
- Invalid JSON → throws `"ملف بيانات الرواتب تالف؛ لم يتم عرض بيانات بديلة."`
- Wrong version, missing fields, non-integer summary values, negative values, malformed obligations → throws `"صيغة سجل بيانات الرواتب غير صالحة؛ لم يتم عرض بيانات بديلة."`
- Never returns partial or fallback data on corruption

---

## 6. Safety & Guardrails

| Guardrail | Implementation |
|-----------|---------------|
| Read-only portal | No form submission, payment, term acceptance, or record editing |
| Abort-on-failure | Any account error throws and aborts the whole scan; nothing written |
| Atomic persistence | Temp file + fsync + rename; previous file never corrupted |
| Account isolation | Separate Playwright context per account; credentials redacted in logs |
| Account cap | `safeAccountList` rejects more than 5 accounts |
| Row cap | `MAX_PAYROLL_ROWS = 1000` per account |
| Arabic digit handling | `\u0660-\u0669` and `\u06f0-\u06f9` converted to ASCII before parsing |
| Thousands separator | Commas and `\u066c` stripped before numeric parsing |
| Safe integer check | `Number.isSafeInteger()` enforced on all summary values |
| Credential redaction | `installLogRedaction` scrubs usernames/passwords/labels from logs |
| Future-version rejection | `version !== 1` throws on read |
| No fallback data | Corrupt/missing file returns `available: false`, never invented data |

---

## 7. Error Messages (Arabic)

All failure messages are localised in Arabic and never expose partial data:

| Condition | Message |
|-----------|---------|
| Auth failure | `فشل تسجيل الدخول؛ تحقّق من الحساب وصلاحيته.` |
| Timeout | `انتهت مهلة تحميل بيانات وحدة الرواتب.` |
| Dashboard incomplete | `لم تكتمل لوحة الرواتب لهذا الحساب.` |
| Obligations read incomplete | `لم تكتمل قراءة التزامات الرواتب لهذا الحساب.` |
| General read failure | `تعذّرت قراءة بيانات وحدة الرواتب لهذا الحساب.` |
| Invalid row count | `عدد سجلات الرواتب غير صالح أو تجاوز الحد المسموح.` |
| Missing row identity | `تعذّر التحقق من هوية أحد سجلات التزامات الرواتب.` |
| Unknown submission status | `حالة أحد سجلات التزامات الرواتب غير معروفة؛ لم تُحفظ القراءة.` |
| Dashboard load timeout | `لم يكتمل تحميل ملخص وحدة الرواتب من البوابة؛ لم تُحفظ قراءة جزئية.` |
| Portal not opened | `لم تفتح وحدة الرواتب للحساب الحالي.` |
| Filter failure | `تعذّر اختيار عرض كل التزامات الرواتب؛ لم تُحفظ قراءة جزئية.` |
| List truncated | `قائمة التزامات الرواتب تجاوزت حد القراءة الآمنة.` |
| Table unstable | `جدول التزامات الرواتب لم يستقر؛ لم تُحفظ قراءة جزئية.` |
| Obligation tile missing | `لم يتم العثور على بطاقة التزامات الرواتب في الصفحة الرئيسية.` |
| Invalid summary | `صيغة سجل بيانات الرواتب غير صالحة؛ لم يتم عرض بيانات بديلة.` |
| Corrupt file | `ملف بيانات الرواتب تالف؛ لم يتم عرض بيانات بديلة.` |
| Read failure | `تعذّرت قراءة سجل بيانات الرواتب.` |
| Incomplete summary | `تعذّر التحقق من اكتمال ملخص وحدة الرواتب.` |
| Invalid summary value | `قيمة ملخص الرواتب غير صالحة: <field>` |
| Out of range | `قيمة ملخص الرواتب خارج النطاق: <field>` |
| Aborted scan | `فشل فحص حساب البوابة رقم N من M: <reason>` |

---

## 8. Testing

### Test files (SAPAuto v6.0)

| File | Purpose |
|------|---------|
| `test/payroll-portal.test.cjs` | Unit tests for `normalizePayrollRows`, `normalizePayrollSummary`, `mergePayrollAccounts`, `readPayrollData`, `safePayrollFailureReason`, `waitForPayrollDashboardSummary` |
| `test/ai-payroll.integration.test.cjs` | Integration tests: payroll snapshot round-trip through renderer payload, company name agreement with payments register, corrupt file isolation, future-version rejection |

### Key test assertions

- Dashboard summary maps 6 Arabic tiles → 9 typed keys correctly
- Incomplete dashboard (5 of 6 cards) throws `'اكتمال ملخص'`
- `غير متاح` value throws `'غير صالحة'`
- `readPayrollData` on missing file → `{ available: false, count: 0 }`
- `readPayrollData` on corrupt JSON → throws `'تالف'`
- `readPayrollData` on version 9 → throws `'غير صالحة'`
- `normalizePayrollRows` strips `AccountID` and `FilingObligationID` from output (no sensitive identifiers leaked)
- `mergePayrollAccounts` preserves existing data when given empty updates
- Merged accounts are keyed by Arabic-lowercased company name

---

## 9. Integration with V8

V8 treats payroll as a **first-class work area** (per `plan2.4.md` §3.1). The V8 payroll workspace covers:

- Company payroll profile and payroll owner
- Monthly payroll period register
- Employee count and payroll input checklist
- Payroll run status lifecycle: `not_started`, `waiting_for_client`, `in_preparation`, `ready_for_review`, `approved`, `filed_or_paid`, `blocked`, `exception`
- Statutory/tax/social-insurance work items only when source, deadline, and firm procedure are approved
- Payment/filing evidence attachment and reviewer sign-off
- Exceptions, missing inputs, and client questions
- Payroll calendar and escalation queue
- Immutable activity history

**Not in the first payroll release:** salary calculation engine, bank payment execution, direct government submission, or automatic legal/tax conclusions.

V8's portal access is read-only after authentication: the scanner may navigate between accounts, pages, and read-only filters, and may read documents, obligations, forms, and payment status. It must never submit payroll or tax forms, initiate or confirm a payment, accept portal terms, or edit portal records.

---

## 10. Limitations & Known Gaps

1. **V3 defines the payroll URL but has no active scraper.** The `ZMCF_PAYROLL` URL is defined in V3/V4 `portal-urls.js`, but no orchestrated scraper runs in those versions. The active implementation is in SAPAuto V6 (`payroll-portal.cjs`).
2. **`PAYROLL_STAMP` ambiguity.** The tax type `PAYROLL_STAMP` conflates three obligations: monthly salary-tax payment, quarterly Form 4 declaration, and annual reconciliation. A decision is needed to split into `PAYROLL` and `STAMP`.
3. **No production usage verification.** Whether payroll scraping runs automatically in production cycles needs confirmation via orchestrator checks, run logs, and feature flags.
4. **Max 5 accounts.** The scraper is capped at 5 accounts per cycle by `safeAccountList`.
5. **Arabic UI5 dependency.** The scraper depends on specific Arabic tile headers and UI5 element registry structure; portal UI changes could break selectors.

---

## 11. Source Files

| File | Role |
|------|------|
| `SAPAuto v6.0/electron/payroll-portal.cjs` | Core scraper implementation (scan, normalise, merge, read, write) |
| `SAPAuto v6.0/electron/v3-runtime/src/automation/portal/portal-urls.js` | Payroll portal URL constants |
| `SAPAuto v6.0/electron/v3-engine.cjs` | `runPayrollScan()` orchestrator entry |
| `SAPAuto v6.0/electron/operational-data.cjs` | Payroll data consumer for dashboard aggregation |
| `SAPAuto v6.0/test/payroll-portal.test.cjs` | Unit tests |
| `SAPAuto v6.0/test/ai-payroll.integration.test.cjs` | Integration tests |
| `SAPAuto v6.0/codemap.md` | Component map reference (`payroll-portal.cjs` entry) |
| `v8/plan2.4.md` | V8 payroll product requirements (§3.1) |
| `v8/README.md` | V8 read-only portal access policy (§Source integration)





