# Plan 4.1 & Comprehensive Modernization Architecture

**Document Version:** 4.1.0  
**Context:** SAPAuto V8 Operating System  
**Date:** 2026-10-16  

---

## 1. Item 1: Fix Visual Alignment & Layout for UI Toggles (Switches)

### Problem Diagnosis
In RTL mode (`direction: rtl` / Arabic layout):
- `.setting-switch` has `flex: 0 0 46px`, `width: 46px`, `height: 26px`, and inner circle `width: 20px`, `height: 20px`.
- When checked (`.is-on`), the CSS rule is:
  ```css
  .channel-switch.is-on span, .setting-switch.is-on span {
    background: var(--accent);
    transform: translateX(-20px);
  }
  ```
- In RTL, `translateX(-20px)` shifts the knob to the **left**, which in standard Arabic interfaces moves the knob backwards or overflows past the pill boundary if base padding / flex alignment is flipped. As shown in the user's uploaded screenshot (`media_1792180564749_69ac6576.png`), the active toggle knob clips outside the bounding capsule pill.
- The toggle button container also lacks explicit `box-sizing: border-box`, `border: 1px solid transparent`, and `overflow: hidden` or symmetrical padding.

### Solution Design
1. **Pill Capsule Dimensions & Positioning:**
   - Define exact dimensions with symmetric padding: `width: 44px`, `height: 24px`, `padding: 2px`.
   - Inner circle knob: `width: 18px`, `height: 18px`, `border-radius: 9999px`.
   - Translation distance in RTL: `transform: translateX(calc(-100% - 2px))` or explicit logical direction using `inset-inline` properties.
2. **Visual Contrast:**
   - Off state: Track `background: var(--surface-3)`, Knob `background: var(--text-4)` or muted slate.
   - On state: Track `background: var(--teal-soft)` with border `var(--teal-line)`, Knob `background: var(--teal)`.
3. **Files Affected:**
   - `launcher/app/components.css` (`.channel-switch`, `.setting-switch`).

---

## 2. Item 2: Add Payroll to Navigation Sidebar

### Current Architecture
- `launcher/components/navigation.jsx` defines `mainLinks`:
  1. مكتب اليوم (`/`)
  2. الشركات (`/companies`)
  3. المهام (`/tasks`)
  4. الالتزامات (`/obligations`)
  5. المدفوعات (`/payments`)
  6. الرسائل (`/messages`)
  7. التذكيرات (`/reminders`)
  8. التقارير (`/reports`)

### Solution Design
1. **Add Payroll Link:**
   - Label: `الرواتب`
   - Route: `/payroll`
   - Icon: `Users2` or `Banknote` from `lucide-react`.
   - Position: Directly after `الالتزامات` or `المدفوعات`.
2. **Add Route Scaffold:**
   - Create `launcher/app/(protected)/payroll/page.jsx` with an honest, production-ready workplace view:
     - Header: `وحدة الرواتب والأجور (ZMCF_PAYROLL)`
     - Status Banner: Read-only connector health, observed payroll periods, filing obligations, and employee tax summary.
     - Integration with the Secretary Panel and company dossier tabs.

---

## 3. Item 3: Fix Data & Work Log Information Display (Section 04)

### Problem Diagnosis
Section 04 in `launcher/components/settings-form.jsx` shows:
```
مصدر SAPAuto3 المحلي
26 حسابًا موجودًا مسبقًا في إعدادات SAPAuto3...

آخر دورة فحص
16/10/2026، 10:55 م · 0/26 تمت · 0 إخفاق
running
```
Issues:
1. **Stale/Inaccurate State Display:** If a cycle was aborted or stopped while active, its state in the database remained `running` instead of `interrupted` or `done`.
2. **Unlocalized / Raw English Tag:** The tag displays `running` in plain English, breaking the Arabic design language.
3. **Processed Count Discrepancy:** The cycle record shows `0/26 تمت` because manual stops or initial connection attempts were recorded before iteration completed.

### Solution Design
1. **Cycle State Localizer:**
   - `running` $\rightarrow$ `قيد الفحص`
   - `done` $\rightarrow$ `مكتملة`
   - `interrupted` / `aborted` $\rightarrow$ `متوقفة`
   - `failed` $\rightarrow$ `فشلت`
2. **Database Reconciliation:**
   - Update `harness/loop.js` and `launcher/app/api/settings/route.js` to ensure cycles that didn't finish cleanly are marked with honest duration and state.
3. **Display Modernization:**
   - Clean badges with semantic color coding (teal for `مكتملة`, amber for `قيد الفحص`, rose for `إخفاق`).

---

## 4. Item 4: Decouple V8 from SAPAuto3 (Native Autonomous V8)

### Problem Diagnosis
Currently, V8 references `../SAPAuto3` in:
- `harness/source.js`: `baseDirectory()` resolves to `../SAPAuto3`.
- `harness/run-account.js`: Spawns legacy `orchestrator.js` from `../SAPAuto3`.
- `settings-form.jsx` & `api/settings/route.js`: Labeling references `SAPAuto3`.

### Decoupling Plan
1. **Accounts & Configuration Native to V8:**
   - Store encrypted/protected account credentials in `v8/data/accounts.json` or SQLite table `accounts`.
2. **Native Scraper Pipeline in V8:**
   - Port the browser automation routines from `SAPAuto3/src/automation/` directly into `v8/harness/scraper/`.
   - Install required dependencies (`playwright`) directly in `v8/package.json`.
3. **Zero External Directory Dependencies:**
   - Make `v8/` entirely self-contained so it operates independently with zero calls to `../SAPAuto3` or `../SAPAuto v6.0`.
