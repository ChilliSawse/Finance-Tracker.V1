# Finance-Tracker.V1 — Implementation Plan (Revision 3)

Last updated: 2026-06-18 (Phase 0 complete)
Supersedes Revision 2. Reflects completed work (orig. Phases 1–3, 5–7, plus B.2, B.5, E.1–E.3) and re-sequences all remaining work around a **correctness-first** philosophy.

---

## What changed in Rev 3 (read me first)

Rev 2 gated almost all valuable work behind **Phase A (the sidebar)**. That's backwards: the sidebar is *layout chrome*, while the high-value, high-risk work is *logic* (tax math, What If, data-entry routing). We already proved the gate was wrong by shipping B.2/B.5/E out of order with no problems.

Rev 3 therefore:

1. **Adds Phase 0 — Correctness Hotfixes.** Code review surfaced real numeric bugs not tracked in Rev 2 (open-ended tax bracket, off-by-one band boundaries, broken HTML-state backup, What If using a discredited ratio method while *claiming* it was fixed). These produce **wrong numbers today** and come first.
2. **Adds Phase R — Event-Routing Refactor** as an explicit prerequisite to Phase D. The big data-entry move (D) silently breaks because `events.js` routes change-handlers off DOM ancestry (`.closest('#income-sources-settings')`). Decouple routing *before* moving DOM, or D becomes a debugging swamp.
3. **Demotes Phase A (sidebar) off the critical path.** It can happen any time; nothing numeric depends on it.
4. **Re-baselines effort estimates** (~1.5× Rev 2 on the large phases) and marks which items are "don't trust the output until fixed."

---

## Completed Work (reference only)

| Phase | Description |
|---|---|
| ✅ Phase 1 | Security — XSS sanitisation, CSP, JSON import validation |
| ✅ Phase 2 | Accessibility — ARIA tab pattern, keyboard nav, skip link, aria-live |
| ✅ Phase 3 | Theme system — Odysseus-style token engine, 7 presets, FOUC prevention, swatch UI |
| ✅ Phase 5 | CSS cleanup — `transition: all`, `!important`, dead rules, typography tokens |
| ✅ Phase 6 | PWA — network-first HTML, cache-first assets, offline fallback |
| ✅ Phase 7 | Input validation — inline field errors, FI edge cases, compound growth formula |
| ✅ B.2 | Persistent user defaults — "Save as My Defaults" → `localStorage` (`ft-user-defaults`); dynamic reset label |
| ✅ B.5 | Negative savings rate — removed `Math.max(0, …)` clamp; red figures + "Spending exceeds income" warning |
| ✅ E.1 | Tax bracket engine — `calculateTaxFromBrackets()` + `getTaxBracketBreakdown()`; progressive math wired into `calculateTotals()` |
| ✅ E.2 | Income source type split — `incomeType` (`salaried`/`selfEmployed`); `migrateIncomeSourceTypes()` backfills legacy saves |
| ✅ E.3 | Per-source breakdown — Gross / Tax / Net per row, `tabular-nums`, auditable bracket table |

> The tax **engine** (E.1) is correct progressive banding. The tax **default data** is not (see Phase 0). Distinguish "the function works" from "the inputs are right."

---

## Phase 0 — Correctness Hotfixes (NEW — do first)

Self-contained, no layout dependency, each shippable independently. These fix wrong outputs.

### 0.1 — Open-ended top tax bracket
**Bug:** Default brackets cap at `{min:45001, max:120000}`. Income above $120k is taxed identically to $120k, so the *effective* rate **falls** as income rises (regressive above the cap). A $200k earner pays the same tax as a $120k earner.
**Fix:** Top default bracket `max: Infinity` (or a sentinel the engine treats as unbounded). Verify `calculateTaxFromBrackets()` already handles an unbounded top band (it iterates bands, so `Infinity` works; confirm no `isFinite` guard rejects it).
**Test:** Tax($120k) < Tax($200k); effective rate monotonically non-decreasing.

### 0.2 — Off-by-one band boundaries
**Bug:** Bands run `…18200` then `18201…`. Income of `$18,200.50` falls in neither band → silently untaxed fractional cracks.
**Fix:** Adopt half-open intervals `[min, max)` — each band's `min` equals the previous band's `max`. Use `gross >= min && gross < max` semantics; drop the `+1` boundary convention. Update default bracket data and `getTaxBracketBreakdown()` to match.
**Test:** No income value can miss all bands; sum of band-taxed amounts equals gross within the taxed range.

### 0.3 — Remove (or replace) the broken HTML-state backup
**Bug:** `actionSaveAndDownloadHTML()` regex-replaces `let financeData = {…}` inside `document.outerHTML` to bake state into a downloadable page. The app's JS now lives in external `js/*.js`, so that pattern **isn't in the HTML** — the regex matches nothing and produces a broken/empty backup.
**Fix:** Delete the "Save & Download HTML" feature. JSON export/import (already validated) is the supported backup path. If a single-file export is genuinely wanted, regenerate it correctly (serialise state into a `<script>` block injected into a fresh template) — but default to **delete**.
**Test:** No code path references the dead regex; export/import round-trips state.

### 0.4 — Stop What If lying about being fixed
**Bug:** Rev 2 marks G.3 (income calc) and B.1 (persistence) conceptually, but the live code (`runWhatIfScenario()` in `events.js`) still uses the **income-multiplier/ratio approach** G.3 says to remove, and `showTab('whatIf')` re-runs `initializeWhatIfTab()` every switch, wiping edits.
**Fix (interim, before the full Phase G rebuild):** Add a visible banner in the What If panel — "Estimates only; this tab is being rebuilt" — OR fast-track G.1+G.3 now. Decision: **fast-track G.1 + G.3 into Phase 0** since the wrong income math is a correctness issue, and defer G.2/G.4/G.5 polish to Phase G. (See G.1/G.3 below.)
**Test:** Editing a lever and switching tabs preserves edits; income override changes net directly without touching per-source gross.

### 0.5 — Theme the What If results panel (de-risk for dark themes)
**Bug:** Results HTML hardcodes hex colours (`#1976d2`, `#f0f8ff`, …), so the panel renders broken on dark themes — contradicting the whole token effort.
**Fix:** Replace hardcoded hex with CSS variables (`--accent`, `--panel`, `--color-positive/negative`).
*(Could live in Phase I, but it's cheap and prevents an obviously-broken screenshot now.)*

---

## Phase R — Event-Routing Refactor (NEW — prerequisite to Phase D)

**Why:** `handleSettingsChangeEvents` (and delete/add handlers) in `events.js` identify *which collection* an input belongs to by DOM ancestry — `target.closest('#income-sources-settings')`, `'#expenses-settings'`, etc. Phase D moves those containers out of Settings into each tab, which **silently breaks routing** (the `closest()` selectors no longer match). Fixing this reactively, mid-D, is painful.

**Fix (do before D):**
- Add declarative routing attributes to each editable input: `data-collection="incomeSources|essentialExpenses|nonEssentialExpenses|liabilities|allocations"`, `data-index`, `data-field`.
- Rewrite handlers to read `target.dataset.collection / .index / .field` instead of walking ancestors.
- This makes the same inputs work *anywhere in the DOM*, so Phase D becomes pure markup relocation with zero handler changes.

**Test:** All existing Settings edits still write to the right `financeData` path after the refactor, with containers left exactly where they are (refactor is behaviour-preserving until D moves them).

**Effort:** S–M (≈1 session). High leverage — turns the riskiest phase (D) into a safe one.

---

## Phase B — Quick Wins / Bug Fixes (remaining)

Self-contained, low-risk, any order. No longer gated on Phase A.

### B.1 — Preserve What If scenarios across tab switches *(fast-tracked → Phase 0.4)*
- `whatIfState` becomes a module-level object, cloned from live data only on first show or explicit "Reset to live data" click.
- Add a visible "Reset to live data" button atop the What If panel.

### ✅ B.2 — Persistent user defaults — DONE

### B.3 — Fix hardcoded A$ in HTML
Replace every static `A$0.00` placeholder in `index.html` with an empty span; ensure all render passes in `uiDashboard.js` / `uiSettings.js` fill via `currencySymbol()`. Remove hardcoded currency chars from HTML.

### B.4 — Delete confirmations (non-blocking)
Replace `window.confirm()` in expense/liability delete handlers with an inline popover ("Delete? [Yes] [No]") — auto-focus Yes, dismiss on Escape/focus-out. Styleable, non-blocking. (Shared component reused by H.5/SE4.)

### ✅ B.5 — Negative savings rate — DONE

### B.6 — Live colour picker preview
`input` listeners on colour pickers → `applyGuiStylesToPage()` live. Keep Apply button, relabel "Save Settings" → triggers `autoSave.onDataChange()`.

### B.7 — Document daily assumption
Add `(5-day week)` label + info tooltip explaining the 260-day basis next to the Dashboard "Daily" figure.

---

## Phase A — Left Sidebar Navigation + Layout Restructure (DEMOTED — do any time)

**No numeric work depends on this.** It can slot in whenever convenient; recommended after Phase 0 + R so we're not re-routing handlers and moving layout simultaneously.

### A.1 — HTML restructure
Replace `.tabs-nav` + flat panels with a `<nav class="sidebar">` + `<main class="main-content">` shell. Sections: dashboard, income, expenses, savings, liabilities, what-if, settings. Appearance (GUI) settings move to a gear-button modal (A.4).

### A.2 — Sidebar CSS
- Desktop (≥768px): 240px, collapses to 64px icon-only via `.sidebar--collapsed`.
- Tablet (640–767px): 64px icon-only, expand on hover/focus.
- Mobile (<640px): hidden sidebar; fixed bottom nav; `padding-bottom: calc(60px + env(safe-area-inset-bottom))` on main.
- Active: accent left border + tinted bg (`--tab-bg-color`).
- `width 0.2s ease`, guarded by `prefers-reduced-motion`.

### A.3 — JS navigation
- Sidebar nav-item click handler replaces tab clicks; `showTab(sectionId)` toggles `.active` + panel visibility.
- Keyboard: ↑/↓ within sidebar, Home/End.
- Persist last section in `localStorage` (`ft-active-tab`), restore on load.
- **Note:** ensure `showTab('whatIf')` no longer force-reinitialises (depends on 0.4/B.1).

### A.4 — GUI Settings modal
Gear button opens a centered `#gui-settings-modal` (`role="dialog"`, `aria-modal`, `aria-labelledby`). Contains all theme/colour/font controls. Close via ✕ / Escape / backdrop. Trap focus; restore focus to trigger on close. Keep `id="guiSettings"` on the modal body so existing delegation works.

### A.5 — Sidebar icons
Inline 20×20 SVG (`currentColor`), no icon-font dependency: dashboard grid, income up-arrow, expenses down-arrow, savings clock, liabilities card, what-if sliders, settings filter, gear, collapse chevron.

---

## Phase C — Collapsible Info Sections

Affects Income, Expenses, Savings, Liabilities.

### C.1 — Component pattern
Collapse toggle (chevron) top-right; collapsed = heading row only; "Don't show again" checkbox; dismissed state in `localStorage` (`ft-info-dismissed`, keyed by tab); restore collapsed on load.

### C.2 — Rewrite info content
Each block → 2–3 sentence intro + 2–4 "how to use" bullets + collapsed "Learn more" expander. Halves visual weight even when open.

---

## Phase D — Data Entry Into Tabs + Settings Rearchitecture

The largest *markup* change. **Now low-risk** because Phase R decoupled handler routing. Depends on R (mandatory) and ideally C.

### D.1 — Income tab
Move source list + "Add income source" (prominent, top) + tax bracket table into the Income panel. Inline expand-to-edit per row.

### D.2 — Expenses tab
Move essential/non-essential lists in; group under collapsible category headers with category totals; per-category (or top-level) "Add expense".

### D.3 — Savings tab
Move allocation inputs in; enforce sum = 100% (auto-balance remainder or block save with clear message); benchmark label ("15% · aim for 20–30%").

### D.4 — Liabilities tab
Move liabilities list in; add `interestRate` field per liability (`financeData.liabilities[n].interestRate`); cost badge (>10% red, 5–10% amber); simple years-to-zero debt projection (division, no amortisation).

### D.5 — Settings tab (lightweight)
After the move, Settings keeps only: FI params (multiple, return, current assets) + sensitivity hints; currency selector; display period; data buttons (Export/Import JSON, Clear, Save as My Defaults, Reset). Remove all data-entry sections.

### D.6 — GUI Settings → modal
Remove from nav; gear button (A.4) opens it. No functional change, placement only.

---

## Phase E — Tax Bracket Calculation (remaining)

### ✅ E.1 / ✅ E.2 / ✅ E.3 — DONE (engine, type split, per-source breakdown)

### E.4 — Bracket table relocation + label
Move the bracket table to the Income tab (with D.1); final label "Tax Brackets (used in calculations)". Blocked on D.1.

> **Data accuracy note (carried from Rev 2, partially resolved by Phase 0):** 0.1 + 0.2 fix the structural bracket bugs. Default brackets still omit Medicare levy / LITO and use stale ATO values — net remains labelled an **estimate**. Refreshing rates to a current schedule is optional follow-up, not a blocker.

---

## Phase F — Dashboard Improvements

### F.1 — Empty state
No income + no expenses → welcome empty state with three action cards (Add income / Add expenses / Set FI goal) linking to tabs. Auto-hides once data exists.

### F.2 — Quick-action links
"Edit →" affordance on each stat card → relevant tab (income→Income, expenses→Expenses, net worth→Liabilities, FI→Settings).

### F.3 — Upcoming bills
New `financeData.upcomingBills[]` (`name`, `amount`, `dueDate`, `frequency`). Dashboard "Upcoming this month" card (due ≤30 days). Edited in a new Expenses "Bills" section; excluded from monthly totals unless due this period.

---

## Phase G — What If Tab Rebuild

> G.1 + G.3 fast-tracked into **Phase 0.4** (correctness). Phase G now covers the value-add levers, comparison, and saved scenarios on top of the corrected, persistent state.

### G.1 — Scenario persistence — *moved to Phase 0.4*

### G.2 — Full lever set
Levers for income, essential expenses, non-essential expenses (% reduction), savings-rate boost (override), liabilities adjustment (total debt), funding allocation shift (per-goal %).

### G.3 — Income calculation fix — *moved to Phase 0.4*
Operate on **totals**: apply income change directly to net; never touch per-source gross.

### G.4 — Baseline comparison
"vs. current plan" delta table (FI date, annual savings, savings rate, 10-yr net worth) with red/green direction colouring.

### G.5 — Save scenarios
Name + store up to 3 in `localStorage` (`ft-what-if-scenarios`); dropdown/tabs at top; compare two side-by-side in delta-table format; store full lever state + name.

---

## Phase H — Remaining Tab Improvements

### H.1 — Income — top "Add income source" button; total Gross/Tax/Net summary row.
### H.2 — Expenses — name search filter; category grouping polish (with D.2).
### H.3 — Savings — collapsible allocation explainer; benchmark label; live sum enforcement.
### H.4 — Liabilities — interest field + cost indicator; debt-free projection (with D.4).
### H.5 — Settings — replace reset `confirm()` with inline pattern (reuse B.4); FI sensitivity hints.

---

## Phase I — Visual Polish + Responsive Scaling

### I.1 — Dashboard card grid (2-col tablet / 3-col desktop, 1-col mobile); `--panel` bg, `--border`, subtle shadow.
### I.2 — Stat card design — `2rem`/700 primary number `tabular-nums`; `0.75rem` muted label; 20px accent icon; delta indicator.
### I.3 — Typography hierarchy — sidebar `0.9rem`, headings `1.25rem`/600, subheads `1rem`/500 muted, body `0.9rem`, `tabular-nums` on all figures.
### I.4 — Responsive audit @ 375/768/1024/1440 — no horizontal scroll, touch targets ≥44px, forms usable, cards reflow.
### I.5 — Motion — `prefers-reduced-motion` guard everywhere; sidebar `width 0.2s`; modal `opacity`+`scale(0.98)` `0.15s`; no tab-switch animation.
### I.6 — *(folded in from 0.5 if not already done)* token-only colours in What If results.

---

## Execution Order (Rev 3)

```
Phase   Description                                  Depends on     Effort       Status
──────────────────────────────────────────────────────────────────────────────────────────────
0       Correctness hotfixes                         —              S (1 s)      ✅ DONE
          0.1 open-ended top bracket                                                  wrong numbers >$120k
          0.2 off-by-one band boundaries                                              untaxed fractional cracks
          0.3 remove broken HTML backup                                               produces broken file
          0.4 What If income+persistence (was G.1/G.3)                                tab lies about being fixed
          0.5 token-ise What If colours                                              breaks on dark themes
R       Event-routing refactor (data-attrs)          0 (recommended) S–M (1 s)    TODO  ← de-risks D  ← NEXT
B       Quick wins (B.1*/B.3/B.4/B.6/B.7)            —              S (1 s)      PARTIAL (B.2✅ B.5✅; B.1→0.4)
A       Sidebar nav + layout (DEMOTED)               R recommended  L (3–4 s)    TODO  (off critical path)
C       Collapsible info sections                    A             S (<1 s)     TODO
D       Data entry into tabs + Settings rearchitect  R (mandatory)  L (3–4 s)    TODO
E       Tax bracket calc (E.4 only)                  D             XS           PARTIAL (E.1–E.3✅)
F       Dashboard improvements                       D, E          M (1–2 s)    TODO
G       What If rebuild (G.2/G.4/G.5)                D, 0.4        M–L (2–3 s)  TODO
H       Remaining tab improvements                   D, E          S–M (1 s)    TODO
I       Visual polish + responsive audit             all above     M (1–2 s)    TODO
```

Size key: XS < 0.5 session, S < 1, M 1–2, L 3+.

### Recommended path
1. ~~**Phase 0** — fix the wrong numbers (½–1 session).~~ ✅ **DONE** — all five items ship independently.
2. **Phase R** — decouple event routing (1 session). Makes D safe. ← **NEXT**
3. **Phase B** remaining quick wins (parallel-friendly, no deps).
4. **Phase A** sidebar whenever convenient — it no longer blocks anything numeric.
5. **C → D → E.4 → (F / G / H)** then **I** last.

### Why this order (rationale)
- **Correctness before chrome.** A tracker that taxes $200k like $120k is worse than one that looks plain. Phase 0 items each fix a *wrong output*.
- **Refactor before relocate.** Phase R is cheap insurance that converts Phase D from "touches every handler" into "moves markup." Skipping R means debugging silent routing breaks for days.
- **Sidebar is not a gate.** Rev 2's A-blocks-everything dependency was already violated successfully; Rev 3 makes that official.
- **Estimates bumped ~1.5×** on D and G to account for re-testing every tab and the from-scratch What If comparison/saved-scenario work.

### Don't-trust-the-output list
All four items resolved in Phase 0:
- ~~Tax for incomes above the top default band~~ → **fixed by 0.1** (top band now `max: Infinity`).
- ~~Any income near a band boundary~~ → **fixed by 0.2** (half-open `[min, max)` intervals).
- ~~"Save & Download HTML" backup~~ → **removed in 0.3** (JSON export/import is the supported path).
- ~~What If income scenarios~~ → **fixed by 0.4** (direct net-override totals approach; persistence across tab switches).

\* B.1 (What If persistence) is fast-tracked into Phase 0.4 as a correctness item.