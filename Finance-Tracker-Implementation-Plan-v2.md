# Finance-Tracker.V1 — Implementation Plan (Revision 2)

Last updated: 2026-06-18
Status reflects completed work through Phases 1–3, 5–7 of the original plan, plus correctness fixes B.2, B.5, E.1–E.3.

---

## Completed Work (reference only)

| Phase | Description |
|---|---|
| ✅ Phase 1 | Security — XSS sanitisation, CSP, JSON import validation |
| ✅ Phase 2 | Accessibility — ARIA tab pattern, keyboard nav, skip link, aria-live |
| ✅ Phase 3 | Theme system — Odysseus-style token engine, 7 presets, FOUC prevention, swatch UI |
| ✅ Phase 5 | CSS cleanup — transition: all, !important, dead rules, typography tokens |
| ✅ Phase 6 | PWA — network-first HTML, cache-first assets, offline fallback |
| ✅ Phase 7 | Input validation — inline field errors, FI edge cases, compound growth formula |
| ✅ B.2 | Persistent user defaults — "Save as My Defaults" writes to `localStorage` (`ft-user-defaults`); reset restores saved defaults if present, else factory defaults; reset button label updates dynamically |
| ✅ B.5 | Negative savings rate — removed `Math.max(0, savingsRate)` clamp; rate and savings figures turn red with "Spending exceeds income" warning when negative |
| ✅ E.1 | Tax bracket engine — `calculateTaxFromBrackets()` and `getTaxBracketBreakdown()` added to `js/calculations.js`; progressive brackets now wired into `calculateTotals()`; "Reference Only" label removed |
| ✅ E.2 | Income source type split — `incomeType` field added (`salaried` / `selfEmployed`); Salaried enters gross → bracket tax → net derived; Self-employed enters net + optional tax per cycle → gross back-calculated; Type dropdown in Settings; `migrateIncomeSourceTypes()` backfills legacy saves idempotently |
| ✅ E.3 | Per-source breakdown display — each Income card shows Gross / Tax / Net per year row with `tabular-nums`; `getTaxBracketBreakdown()` drives auditable bracket table in Income tab |

---

## Phase A — Left Sidebar Navigation + Layout Restructure

**Goal:** Replace the horizontal tab bar with a persistent left sidebar on desktop, collapsing to a bottom nav bar on mobile. This is the most structural change; all other phases build inside the resulting layout.

### A.1 — HTML restructure

Convert `index.html` from a tab-bar + flat panel layout to:

```
<body>
  <nav class="sidebar" aria-label="Main navigation">
    <div class="sidebar-header">  <!-- app logo / name -->
    <ul class="sidebar-nav" role="list">
      <li><button class="nav-item" data-section="dashboard">...</button></li>
      <!-- income, expenses, savings, liabilities, what-if, settings -->
    </ul>
    <button class="sidebar-collapse-btn" aria-label="Collapse sidebar">
    <button class="sidebar-settings-btn" aria-label="App settings">  <!-- opens GUI Settings modal -->
  </nav>
  <main class="main-content" id="main-content">
    <div class="panel" id="dashboard" role="region">
    <!-- ... other panels -->
  </main>
  <!-- GUI Settings modal (separate from sidebar) -->
  <div class="modal-overlay" id="gui-settings-modal" aria-modal="true" role="dialog">
</body>
```

Remove the existing `.tabs-nav` bar and `.tab` buttons entirely.

### A.2 — Sidebar CSS

- Desktop (≥768px): sidebar is `240px` wide, fixed height, flex column. Collapses to `64px` (icon-only) via `.sidebar--collapsed` class toggled by button.
- Tablet (640–767px): sidebar at `64px` icon-only by default, expands on hover/focus.
- Mobile (<640px): sidebar hidden; `position: fixed; bottom: 0` bottom nav bar shows icons + labels for all 7 sections. Add `padding-bottom: calc(60px + env(safe-area-inset-bottom))` to main content.
- Active state: `nav-item.active` gets accent-coloured left border + tinted background using existing `--tab-bg-color` token.
- Transition: `width 0.2s ease` on collapse/expand (respects `prefers-reduced-motion`).

### A.3 — JavaScript navigation

Update `js/main.js`:
- Replace tab-click handler with sidebar nav-item click handler.
- `showTab(sectionId)` function sets `nav-item.active` on clicked item, shows the matching panel, hides others.
- Keyboard: Arrow Up/Down in sidebar, Home/End for first/last.
- Store last active tab in `localStorage` under `ft-active-tab` and restore on load.

### A.4 — GUI Settings modal (Odysseus-style)

The GUI Settings tab is removed from the sidebar nav. Instead:
- A gear icon button (⚙) sits at the bottom of the sidebar.
- Clicking it opens a centered modal overlay (`#gui-settings-modal`).
- Modal contains all existing GUI Settings content: theme switcher swatches, colour pickers, font controls, heading controls.
- Close via ✕ button, Escape key, or clicking the overlay backdrop.
- Focus is trapped inside modal while open (loop Tab between interactive elements, return focus to trigger on close).
- Modal adds `aria-modal="true"`, `role="dialog"`, `aria-labelledby` pointing to its heading.
- `id="guiSettings"` placed on modal body div so existing JS event delegation works without changes.

### A.5 — Sidebar icons

Use inline SVG icons for each nav item (no external icon font dependency):
- Dashboard: 2×2 grid squares
- Income: trending up arrow
- Expenses: trending down arrow
- Savings: clock / circle (time-value of money)
- Liabilities: credit card
- What If: sliders (3 vertical bars)
- Settings: horizontal lines / filter
- Appearance (gear): cog icon — in sidebar footer
- Collapse: chevron left — in sidebar footer

Icons are 20×20 SVG, coloured with `currentColor`.

---

## Phase B — Quick Wins / Bug Fixes

These are self-contained and low-risk. Implement after sidebar is working, in any order.

### B.1 — Preserve What If scenarios across tab switches (W1)

In `js/events.js` / `js/main.js`, `initializeWhatIfTab()` currently runs every time the What If panel is shown. Change it so:
- On first show: clone live data into `whatIfState` (module-level object, not re-initialized).
- On subsequent shows: only update `whatIfState` if user explicitly clicks a "Reset to current" button inside the tab.
- Add a visible "Reset to live data" button at the top of the What If panel.

### ✅ B.2 — Fix "Set Current as Default" (SE3) — DONE

In `js/events.js`, the handler mutates an in-memory variable. Fix:
- Save a deep copy of `financeData` + `guiSettingsData` to `localStorage` under `ft-user-defaults`.
- On "Reset to App Defaults", check for `ft-user-defaults` first; fall back to hardcoded zeros only if absent.
- Rename button to "Save as My Defaults" for clarity.
- Rename "Reset to App Defaults" to "Reset to My Defaults" when user defaults exist (or "Reset to Factory Defaults" when none).

### B.3 — Fix hardcoded A$ in HTML (D4/L2)

In `index.html`, replace every static `A$0.00` placeholder with an empty span. In `js/uiDashboard.js` and `js/uiSettings.js`, ensure every render pass uses the `currencySymbol()` helper to fill these spans. Remove the hardcoded currency chars from HTML entirely.

### B.4 — Delete confirmations (E3/L4)

In `js/events.js`, wrap all delete handlers for expenses and liabilities with a lightweight confirmation:
- Use a custom inline confirm (small popover next to the delete button: "Delete? [Yes] [No]") rather than `window.confirm()` so it's non-blocking and styleable.
- The popover appears, auto-focuses "Yes", and dismisses on Escape or focus-out.

### ✅ B.5 — Show negative savings rate (D2) — DONE

In `js/calculations.js` / `js/uiDashboard.js`, remove the `Math.max(0, savingsRate)` clamp. Instead:
- Show negative savings rates as a red percentage (using `--color-negative`).
- Add a small warning indicator: "Spending exceeds income" when savings rate is negative.
- This resolves the contradiction between "0% savings" and "∞ years to FI."

### B.6 — Live colour picker preview (G1)

In `js/uiSettings.js` (GUI Settings section), add `input` event listeners to all colour pickers. On each `input` event, call `applyGuiStylesToPage()` immediately. Remove the requirement to click "Apply" — changes are live. Keep the Apply button but change its label to "Save Settings" and have it just trigger `autoSave.onDataChange()`.

### B.7 — Document daily assumption (D3)

In the Dashboard panel, next to the "Daily" breakdown figure, add a small `(5-day week)` label. Add a tooltip or info icon explaining the 260-day assumption.

---

## Phase C — Collapsible Info Sections

Affects 4 tabs: Income, Expenses, Savings, Liabilities.

### C.1 — Info section component pattern

Each tab's info block gets:
- A collapse toggle button (chevron icon) in the top-right corner of the info panel.
- Collapsed state: panel shrinks to just its heading row (no content), chevron rotates 180°.
- A "Don't show again" checkbox at the bottom of the expanded content.
- Dismissed state stored in `localStorage` under `ft-info-dismissed` (object keyed by tab name).
- On page load, panels with a saved `dismissed: true` state start collapsed.

### C.2 — Rewrite info content

Current info blocks are dense paragraph text. Rewrite each as:
- A 2–3 sentence intro explaining what the tab does.
- A bullet list of 2–4 "how to use this tab" tips.
- A "Learn more" expander for advanced detail (collapsed by default).

This halves visual weight even when the panel is open.

---

## Phase D — Data Entry Into Tabs + Settings Rearchitecture

The largest architecture change. Moves all data entry from the monolithic Settings scroll into each relevant tab. Settings becomes a lightweight config panel.

### D.1 — Income tab

Add to the Income panel (below the summary view):
- Existing income source list (currently in Settings).
- "Add income source" button (prominent, at the top of the list).
- Inline edit on click: each source row expands to show its fields.
- Tax bracket table moved here from Settings (see Phase E for calculation wiring).
- Section heading: "Your Income Sources" / "Tax Reference Brackets."

### D.2 — Expenses tab

Add to the Expenses panel:
- Existing essential + non-essential expense lists (currently in Settings).
- Category grouping: expenses grouped under collapsible category headers (e.g. Housing, Transport, Food).
- "Add expense" button per category, or a top-level "Add expense" that lets you choose category.
- Category totals shown next to each category header.

### D.3 — Savings tab

Add to the Savings panel:
- Existing allocation percentage inputs (currently in Settings).
- Allocation sum enforcement: auto-balance remaining when one input changes (or hard-block save if sum ≠ 100%, with clear message).
- Benchmark context: small inline label after savings rate showing whether it's below/at/above common targets (e.g. "15% · aim for 20–30%").

### D.4 — Liabilities tab

Add to the Liabilities panel:
- Existing liabilities list (currently in Settings).
- Interest rate field per liability (new field, stored in `financeData.liabilities[n].interestRate`).
- Visual "cost" indicator: liabilities with high interest rate get a warning badge (e.g. >10% = red, 5–10% = amber).
- Simple debt payoff projection: at current savings rate, estimated years to zero debt (simple division, no amortization).

### D.5 — Settings tab (lightweight)

After removing data entry, Settings contains only:
- FI parameters (FI multiple, expected return, current assets) — with sensitivity hints.
- Currency selector.
- Display period (weekly / fortnightly / monthly).
- Data: Export JSON, Import JSON, Clear all data, (renamed) Save as My Defaults, Reset buttons.
- A short explanation of what FI multiple and return rate mean, with suggested ranges.

Remove the income/expenses/tax/assets/liabilities/allocation sections entirely from Settings.

### D.6 — GUI Settings (modal, not tab)

Remove the GUI Settings tab from the nav. The gear button in the sidebar (Phase A.4) opens the modal with all existing GUI settings content. No functional changes to the settings themselves, only placement.

---

## Phase E — Tax Bracket Calculation (I1 + I2 + I3 + SE5)

**Decision confirmed:** Wire tax brackets to actually calculate. This fixes the most conceptually broken thing in the app.

### ✅ E.1 — Calculation engine — DONE

In `js/calculations.js`, add `calculateTaxFromBrackets(grossAnnual, brackets)`:
- Takes gross annual income and the bracket array (each bracket: `{ min, max, rate }`).
- Returns `{ taxAnnual, taxPerCycle, netAnnual, netPerCycle }` for a given pay cycle.
- Progressive calculation: tax each band separately, sum.
- Handles edge cases: no brackets defined → tax = 0; grossAnnual = 0 → tax = 0.

### ✅ E.2 — Income source field rework (I2/I3) — DONE

Replace the confusing three-field system with a clearer two-path UI per source:

**Path A — Salaried:** Enter Gross Annual. Tax brackets calculate automatically. Net shown as read-only.

**Path B — Self-employed/contractor:** Enter Net Pay per Cycle (rename from "Invoiced Pay"). Optionally enter Tax per Cycle if known. Gross is back-calculated.

A toggle or radio per source selects the path. Label changes: "Invoiced Pay" → "Net Pay per Cycle" across all UI and data (with migration in `loadData()`).

> **Note:** `incomeType` field added to each source (`"salaried"` / `"selfEmployed"`). `migrateIncomeSourceTypes()` in `js/state.js` backfills legacy saves idempotently. Default tax brackets are stale ATO-era values and omit Medicare levy/LITO — net is labelled as an estimate. Tightening the brackets is deferred.

### ✅ E.3 — Per-source breakdown display (I5) — DONE

In the Income tab's summary section, show per-source:
```
[Source Name]   Gross: $X,XXX / yr   Tax: $X,XXX / yr   Net: $X,XXX / yr
```
This makes the calculation auditable. Use `font-variant-numeric: tabular-nums` for alignment.

### E.4 — Tax bracket table label update (SE5) — PARTIALLY DONE

Label in `index.html` updated from "Reference Only" to "Estimate" / "used for estimates." Full move to the Income tab and final label "Tax Brackets (used in calculations)" is blocked on Phase D.1 (data entry restructure).

---

## Phase F — Dashboard Improvements

### F.1 — Empty state (D1)

When `financeData` contains no income sources and no expenses, show an empty-state message instead of the stat cards:
- Heading: "Welcome to your Finance Tracker"
- Three action cards: "Add income →", "Add expenses →", "Set your FI goal →" — each linking to the appropriate tab.
- Disappears automatically once data exists.

### F.2 — Quick-action links (D5)

On each stat card, add a small "Edit →" or pencil icon that switches to the relevant tab:
- Income card → Income tab
- Expenses card → Expenses tab
- Net Worth / Liabilities card → Liabilities tab
- FI progress → Settings (FI parameters)

### F.3 — Upcoming bills (D6)

New data type: `financeData.upcomingBills[]` — each bill has `name`, `amount`, `dueDate`, `frequency`.
- Dashboard shows a "Upcoming this month" card listing bills due within 30 days.
- Bills can be added/edited in the Expenses tab (new "Bills" section alongside essential/non-essential).
- Bills are separate from regular expenses — they're one-off or irregular, not factored into monthly totals unless due this period.

---

## Phase G — What If Tab Rebuild

### G.1 — Scenario persistence (W1) [implemented in Phase B.1]

Already covered. This phase builds on top of stable scenario state.

### G.2 — Full lever set (W4)

Add levers for all major variables (not just essential expenses + income):

| Lever | Control | Notes |
|---|---|---|
| Income | Existing slider/input | Keep, fix W2 inconsistency |
| Essential expenses | Existing slider | Keep |
| Non-essential expenses | New slider (% reduction) | Uses non-essential total |
| Savings rate boost | New input (% override) | Direct savings rate target |
| Liabilities adjustment | New input (total debt) | Affects net worth |
| Funding allocation shift | New % inputs per goal | Adjust how savings are split |

### G.3 — Income calculation fix (W2)

Rewrite the income override: instead of the gross/ratio approach, apply the income change directly to net income in the scenario calculation. Do not touch per-source gross values. The What If tab operates on totals, not individual source data.

### G.4 — Baseline comparison (W5)

Below the scenario results, show a "vs. current plan" delta table:

```
                  Current Plan    This Scenario    Difference
FI Date           2041            2038             -3 years
Annual Savings    $24,000         $31,200          +$7,200
Savings Rate      28%             36%              +8%
Net Worth (10yr)  $380,000        $450,000         +$70,000
```

Rows in red/green based on direction.

### G.5 — Save scenarios (W3)

- "Save this scenario" button names and stores up to 3 scenarios in `localStorage` under `ft-what-if-scenarios`.
- Saved scenarios appear as tabs or a dropdown at the top of the What If panel.
- "Compare" view shows two saved scenarios side-by-side in the delta table format.
- Scenarios store the full lever state and a user-given name.

---

## Phase H — Remaining Tab Improvements

Minor improvements to each tab, implemented after data entry is restructured.

### H.1 — Income
- I6: Add prominent "Add income source" button at top of source list (not buried).
- Show total gross / total tax / total net in a summary row at the bottom of the source list.

### H.2 — Expenses
- E4: Search input above expense list (client-side filter on name).
- E5: Category grouping with per-category totals (covered in D.2 but this is the polish pass).

### H.3 — Savings
- S3: Add inline explanation of what allocation percentages mean (one sentence, collapsible).
- S4: Benchmark label added to savings rate display (see D.3).
- S2: Enforcement: show running total as you edit; prevent save (or auto-adjust) if ≠ 100%.

### H.4 — Liabilities
- L3: Interest rate field + colour-coded cost indicator (see D.4).
- L5: Debt-free projection at bottom of liabilities panel.

### H.5 — Settings
- SE4: Replace `window.confirm()` on reset with inline confirmation pattern (same as B.4).
- SE6: Add sensitivity hints next to FI parameters: suggested ranges, note about outsized effect of small changes.

---

## Phase I — Visual Polish + Responsive Scaling

Final pass once structure is stable. Implements the card-grid look from the reference screenshots.

### I.1 — Dashboard card grid

Replace the current dashboard layout with a 2×2 (or 2×3 on wide screens) stat card grid:
- Each card: icon, label, value, small sparkline or secondary metric.
- Cards use `--panel` background, `--border` border, subtle shadow.
- Responsive: single column on mobile, 2-col on tablet, 3-col on desktop.

### I.2 — Stat card design

Match reference screenshots:
- Large primary number (`2rem`, `font-weight: 700`, `tabular-nums`).
- Small secondary label above (`0.75rem`, muted colour).
- Icon in top-right corner (20px, accent colour).
- Positive/negative delta indicator where relevant.

### I.3 — Typography hierarchy

- Sidebar nav: `0.9rem` labels, icons `20px`.
- Panel headings: `1.25rem`, `font-weight: 600`.
- Subheadings: `1rem`, `font-weight: 500`, muted colour.
- Body / input text: `0.9rem`.
- Financial figures: `font-variant-numeric: tabular-nums` on all amount displays.

### I.4 — Responsive audit

At 375px, 768px, 1024px, 1440px viewports, verify:
- Sidebar collapses/transforms correctly at each breakpoint.
- Stat cards reflow without overflow.
- All input forms remain usable on mobile.
- No horizontal scroll at any breakpoint.
- Touch targets ≥ 44×44px.

### I.5 — Motion + polish

- Add `prefers-reduced-motion` guard to all transitions (sidebar collapse, panel switches, modal open/close).
- Sidebar collapse animation: `width 0.2s ease`.
- Modal open: `opacity` + `transform: scale(0.98)` fade-in, `0.15s`.
- Tab switch: no animation (instant, panels are not adjacent so crossfade is jarring).

---

## Execution Order

```
Phase   Description                                    Dependencies    Effort      Status
──────────────────────────────────────────────────────────────────────────────────────────
A       Sidebar nav + layout restructure               —               L (3–4 s)   TODO
B       Quick wins / bug fixes                         A complete*     S (1 s)     PARTIAL (B.2✅ B.5✅; B.1/B.3/B.4/B.6/B.7 pending)
C       Collapsible info sections                      A complete      S (< 1 s)   TODO
D       Data entry into tabs + Settings rearchitect   A, C complete   L (3–4 s)   TODO
E       Tax bracket calculation                        D complete*     M (1–2 s)   PARTIAL (E.1✅ E.2✅ E.3✅; E.4 pending D)
F       Dashboard improvements                         D, E complete   M (1 s)     TODO
G       What If tab rebuild                            D, E complete   L (2–3 s)   TODO
H       Remaining tab improvements                     D, E complete   S–M (1 s)   TODO
I       Visual polish + responsive audit               All above       M (1–2 s)   TODO
```

Size key: S = small (< 1 session), M = medium (1–2 sessions), L = large (3+ sessions)

\* **Execution note:** B.2, B.5, E.1–E.3 were implemented out-of-order (before Phase A) because they are correctness fixes — wrong numbers and broken defaults are higher priority than layout restructuring. The dependency is relaxed for self-contained calculation/state changes that don't touch navigation or tab structure. Resume at Phase A next; remaining B/E items (B.1/B.3/B.4/B.6/B.7, E.4) can be completed as part of their normal phase sequence.

Phases D, E, F, G can be parallelised once Phase A and Phase C are done. Phase I is always last.
