# Finance-Tracker.V1 — Implementation Record (Revision 6)

Last updated: 2026-06-20.
**Status: the implementation plan is complete.** Every planned phase has shipped to `main`, except the items in the **Deferred** section below (each parked for a clear reason — a design decision or a data-model addition).

This revision reframes the document from a *forward plan* into a *record of what was actually built*. It supersedes Revisions 1–5 (the historical planning notes, the "what changed in Rev X" sections, and the Bug/Fix/Test specs for now-shipped work have been folded into concise summaries). A brief history is at the end.

Guiding principle throughout: **correctness before chrome** — fix wrong numbers first, then layout, then polish.

---

## Status at a glance

| Phase | Area | Status |
|---|---|---|
| 1 | Security (XSS, CSP, import validation) | ✅ Done |
| 2 | Accessibility (ARIA tabs, keyboard nav, skip link) | ✅ Done |
| 3 | Theme system (token engine, 7 presets, FOUC prevention) | ✅ Done |
| 5 | CSS cleanup | ✅ Done |
| 6 | PWA (service worker, offline) | ✅ Done |
| 7 | Input validation | ✅ Done |
| 0 | Correctness hotfixes (0.1–0.6) | ✅ Done |
| R | Event-routing refactor (`data-collection`) | ✅ Done |
| T | Minimal test harness (`tests.html`) | ✅ Done |
| B | Quick wins (B.1–B.7) | ✅ Done |
| A | Sidebar nav + layout | ✅ Done (incl. mobile bottom-nav) |
| C | Collapsible info sections | ✅ Done (expanded copy ⏸) |
| D | Per-tab settings modals; Settings tab removed | ✅ Done |
| E | Tax bracket calculation (E.1–E.4) | ✅ Done |
| F | Dashboard improvements | ✅ F.1/F.2/F.4 (F.3 ⏸) |
| G | What If redesign (sandbox editor + simulated dashboard) | ✅ Stages 0–3 (G.5 ⏸) |
| H | Remaining tab improvements | ✅ H.1/H.3/H.5/H.6 (H.2/H.4 partial) |
| I | Visual polish + responsive | ✅ I.1/I.2/I.3/I.5/I.6/I.7/I.8 (I.4 verify-only) |

---

## ⏸ Deferred / not built — read this section for what's outstanding

Nothing below is broken or half-finished; each is a deliberate stop, mostly because it needs a **new data-model field** or a **design decision** first.

### Needs a data-model addition (would pair well as one "data-model pass")
- **F.3 — Upcoming bills.** A `financeData.upcomingBills[]` (`name`, `amount`, `dueDate`, `frequency`); a dashboard "Upcoming this month" card (due ≤30 days); edited in an Expenses-modal "Bills" section; excluded from monthly totals unless due this period. *Deferred at user request — wants to settle the design (esp. how bills interact with existing expense totals) first. Not started.*
- **H.2 — Expense category grouping.** Group expenses under collapsible category headers with per-category totals. Needs a free-form `category` field on expenses (today they only have an essential/non-essential `type`). *The name-search half of H.2 shipped; grouping deferred.*
- **H.4 — Debt-free / years-to-zero projection.** A simple payoff timeline per liability. Needs a per-liability repayment-amount field (none exists). *The cost-indicator badge half of H.4 shipped; the projection deferred. The existing "Net Worth if Debt-Free" card already covers the debt-free framing.*

### Other deferred items
- **G.5 — Saved scenarios.** Name + store up to 3 What If scenarios in `localStorage` (`ft-what-if-scenarios`); a dropdown to reload/compare. The Stage 0–3 architecture makes this straightforward later (serialise/restore `whatIfFinanceData` + a name). *Deferred at user request. Not started.*
- **G.6 (inverse solver).** The "set a target amount + date → back-solve the required savings/allocation split" direction. *Optional follow-up — the **forward** projection the original G.6 described already shipped as per-bucket savings goals (see Phase G / Stage 0).*
- ~~**Phase C — expanded info-panel copy.**~~ ✅ **DONE (2026-06-20)** — user-supplied expanded copy applied to all five info sections (Income / Expenses / Savings / Liabilities + new What If copy written to match). Intro body paragraphs dropped, "Learn more" expanders enriched. *(Two references to a non-existent year-by-year forecast chart in the Savings copy were trimmed — see the Possible-next-feature note below.)*
- **0.6 follow-up — Medicare levy + HELP/HECS in the estimate path.** When a salaried source leaves Net/Tax-per-cycle blank, the bracket estimate omits Medicare levy + HELP/HECS. *Optional; the estimate stays labelled an "estimate". The override path (the actual fix) is done.*
- ~~**Phase A — mobile (<640px) bottom-nav.**~~ ✅ **DONE (2026-06-21)** — under 640px the existing `<nav role="tablist">` sidebar is restyled (CSS-only) into a fixed bottom tab bar (icon-over-label, accent top-border on the active tab, iOS safe-area inset). Reuses `showTab()` + the click/keyboard wiring unchanged; keyboard nav extended to accept Left/Right as aliases of Up/Down for the horizontal orientation. Selectors are doubled with `.is-collapsed` so the bottom bar wins over the persisted collapsed-sidebar state.
- **FI net-worth forecast chart (possible next feature).** The user-supplied Phase C Savings copy referenced a "year-by-year forecast of your projected net worth" chart — which doesn't exist yet, so those two references were trimmed. A small line/area chart projecting net worth over time (compound growth from current assets + annual savings at the expected return) would make that copy accurate and is a natural Savings-tab addition. Not started.

### Verify-only (not a build item)
- **I.4 — Responsive audit @ 375 / 768 / 1024 / 1440.** Media queries exist and the grids are `auto-fit`; a manual pass at those widths (no horizontal scroll, ≥44px touch targets, the wide/resizable settings modals on small screens) is the last check. Can only be done in a browser. *(2026-06-21: a real iPhone 13 Pro pass surfaced + fixed a cluster of phone issues — see below.)*

### Mobile usability fixes (2026-06-21, from on-device iPhone testing)
Following the Phase A bottom-nav, real-device testing surfaced four issues, all now fixed (CSS-only, in the `≤640px` media queries; verified headless at 390px):
- **iOS focus-zoom** — form controls were `<16px`, so iOS zoomed in on every field tap. All text-entry controls forced to `16px` on phones (no `user-scalable` disable).
- **Horizontal scroll in data-entry forms** — the dynamic-list rows set `grid-template-columns` inline (per row, in JS), which beat the responsive CSS; and `.modal--wide/.modal--resizable .list-item` pinned a `min-width: 720px`. On phones the rows now stack one field per line with their (normally `.visually-hidden`) labels revealed and the header row hidden; the 720px floor is dropped. Applies to Income/Tax/Assets/Liabilities/Allocation/Expenses **and** the What If scenario tables (same classes).
- **Page wider than the screen ("zoom out on first load")** — the mobile `.app-shell` used `grid-template-columns: 1fr`, whose `min-content` floor pushed the shell to ~456px. Changed to `minmax(0, 1fr)`; every tab now fits the viewport exactly.
- **Currency figures breaking mid-number** — superseded by the auto-fit pass below.

### Mobile usability fixes — round 2 (2026-06-21, second on-device pass)
- **Currency figures overflowing cards** (large numbers, `/fortnight` suffixes, clipping/overlap) — replaced per-card hacks with a **universal auto-fit**: figures are `white-space: nowrap` (so overflow is detectable) and `fitAllAmounts()` (`utils.js`) shrinks any over-long figure's font just enough to fit its card, down to an 11px floor. Hooked into `updateAllUI()`, `showTab()` (figures can't be measured while their tab is hidden), `runWhatIfScenario()` (the simulated What If dashboard renders on its own, outside `updateAllUI`) and a debounced `resize`. Applies at all widths.
- **Info "ⓘ" tooltips shoved off-screen** — the hover/absolute tooltips (`left:50%; margin-left:-125px`) clipped near screen edges. Replaced with native `<details class="info-tip">` disclosures that expand **inline** (like the "How the buckets work" `.info-more` expander): closed = an inline ⓘ by the heading; open = a full-width readable panel below it. Works on every width, accessible, touch-friendly — no positioning to clip. (A first attempt floated a fixed bottom panel, which needed dropping `.content`'s `backdrop-filter`; the inline `<details>` approach replaced it.)
- **Topbar crowding** — the "All changes saved" pill pushed the gear cog over the title. On phones the save-status indicator collapses to a small colour-coded **dot** (green/amber/red/orange), giving the title + gear their space back. Desktop keeps the full text pill.

---

## Completed work, by phase

### Phases 1–3, 5–7 (foundation)
- **1 — Security:** XSS sanitisation, CSP, JSON import validation.
- **2 — Accessibility:** ARIA `tablist` pattern, keyboard nav, skip link, `aria-live`.
- **3 — Theme system:** Odysseus-style token engine (`deriveTokens`), 7 presets, FOUC prevention (replays cached tokens before CSS), swatch UI. *(See "Theme system" under Key fixes — it has two token layers, which caused later bugs.)*
- **5 — CSS cleanup:** removed `transition: all`, stray `!important`, dead rules; typography tokens.
- **6 — PWA:** `sw.js` — network-first HTML, cache-first assets, offline fallback. **Manually versioned:** bump `VERSION` in `sw.js` on every asset change or the browser keeps serving stale JS/CSS.
- **7 — Input validation:** inline field errors, FI edge cases, compound-growth formula.

### Phase 0 — Correctness hotfixes
- **0.1** Open-ended top tax bracket → `max: Infinity` (was regressive above $120k).
- **0.2** Off-by-one band boundaries → half-open `[min, max)` intervals (no more untaxed fractional cracks).
- **0.3** Removed the broken "Save & Download HTML" backup (its regex matched nothing after the JS moved to `js/*.js`); JSON export/import is the supported backup.
- **0.4** What If income + persistence: net-override-on-totals approach (no per-source gross scaling), and seeds from live data only on first show / explicit reset (was wiping edits every tab switch).
- **0.5** Tokenised the What If results colours (were hardcoded hex → broken on dark themes).
- **0.6** Salaried net/tax override (root-caused against live data): salaried mode was *discarding* the user's entered Net Pay/Cycle + Tax Removed and showing a bracket estimate that omits Medicare/HELP. **Fix:** salaried now honours those fields when filled, falling back to the bracket estimate only when blank — one shared rule with self-employed; the inputs are no longer disabled for salaried. (`calculations.js`, `uiSettings.js`; +6 `tests.html` assertions.)

### Phase R — Event-routing refactor
Settings inputs route by `data-collection` (the exact `financeData` key) resolved against a `SETTINGS_COLLECTIONS` whitelist, instead of DOM ancestry (`.closest()`). This made the field→collection mapping DOM-independent, which is what let Phase D relocate the forms safely. The one thing R left for D: the delegated listeners were still on `#settings` (D hoisted them to `document`).

### Phase T — Test harness
Standalone `tests.html` (no framework) loads `utils.js` + `calculations.js` and runs assertions for `calculateTaxFromBrackets`, `getTaxBracketBreakdown`, `calculateYearsToFI`, plus the 0.6 salaried-override cases. Open in a browser to run.

### Phase B — Quick wins
- **B.1** → folded into **0.4** (What If persistence).
- **B.2** Persistent user defaults ("Save as My Defaults" → `localStorage` `ft-user-defaults`).
- **B.3** Removed hardcoded `A$0.00` placeholders; render fills currency via `formatCurrency()`.
- **B.4** Reusable non-blocking `inlineConfirm(triggerEl, message, onConfirm)` (auto-focus Yes; Escape/No/outside-click dismiss). Reused by H.5.
- **B.5** Negative savings rate shows red + "Spending exceeds income".
- **B.6** Live colour-picker preview on the GUI form. *(Note: the "Save Settings" button this introduced was later removed — appearance now auto-saves; see Phase D.)*
- **B.7** "Daily (5-day week)" relabel + tooltip explaining the 260-day basis.

### Phase A — Sidebar nav + layout
`.app-shell` CSS grid (topbar row + sidebar/main row), vertical `role="tablist"` sidebar (↑/↓ + Home/End), collapse toggle (persisted `ft-sidebar-collapsed`), active-tab persistence (`ft-active-tab`), GUI settings extracted to a body-level **gear-button modal** (`#gui-settings-modal`, focus-trapped). Inline 20×20 `currentColor` SVG icons. *(Mobile bottom-nav now shipped — see the Deferred section's DONE note: under 640px the same tablist renders as a fixed bottom bar, CSS-only.)*

### Phase C — Collapsible info sections
`.info-section[data-info-key]` with a chevron toggle + "Don't show again" checkbox; collapsed state persists per key (`ft-info-collapsed`). Content rewritten to intro + "How to use" bullets + a `<details>` "Learn more". *(Longer per-section copy ⏸ — see Deferred.)*

### Phase D — Per-tab settings modals; Settings tab removed
The data-entry sections moved out of a single Settings tab into **per-tab gear-button modals**, and the Settings tab was deleted entirely.
- **Reusable modal shell:** `setupModal(modalId, openBtnId, onOpen)` (focus trap, Escape/backdrop close, restore-to-trigger), reused by the appearance modal and every per-page modal. `setupPageSettingsModals()` wires them.
- **Listener hoist:** `handleSettingsClickEvents`/`handleSettingsChangeEvents` moved from `#settings` to `document` (the touch Phase R left owed); both handlers are fully guarded, so What If / GUI inputs aren't matched.
- **D.1 Income** → `#income-settings-modal` (Income Sources + Tax Brackets). **D.2 Expenses** → `#expenses-settings-modal`. **D.3 Savings** → `#savings-settings-modal` (Assets + Allocation + FI; edits recompute the Savings displays live). **D.4 Liabilities** → `#liabilities-settings-modal`.
- **D.5 Settings tab removed** — once empty it was deleted (panel + sidebar button); `VALID_TABS` drops `settings`.
- **D.6 One settings hub** — the topbar gear modal now holds Appearance + Typography + **Currency** (moved here per v2) + a consolidated **Save / Reset / Backup** section.
- **Appearance auto-saves** — the "Save Appearance" button was removed; theme swatches, custom colours and typography all persist on change (`commitGuiSettings()` on `change`; `input` drives no-persist live preview).
- Data modals are wider + user-resizable (`.modal--wide`/`.modal--resizable`); gear buttons are themed.
- **Theme bug fixes (uncovered during D)** — see "Key fixes" below.

### Phase E — Tax bracket calculation
- **E.1** Progressive engine `calculateTaxFromBrackets()` + `getTaxBracketBreakdown()`.
- **E.2** `incomeType` split (`salaried`/`selfEmployed`) + `migrateIncomeSourceTypes()` backfill.
- **E.3** Per-source Gross/Tax/Net breakdown + auditable bracket table.
- **E.4** Resolved by D.1 (bracket editing moved to the Income modal; the read-only "Tax Brackets (Estimate)" reference card stays on the tab). The proposed "used in calculations" relabel was superseded — post-0.6 the brackets are a *fallback estimate*, so "Estimate" is more accurate. *(Note: default brackets still omit Medicare levy / LITO and use stale ATO values — net stays labelled an estimate; refreshing rates is an optional follow-up.)*

### Phase F — Dashboard improvements
- **F.1** Welcome empty state (`#dashboard-empty-state`) with three action cards (Add income / expenses / Set FI goal) that jump to the tab + open its gear modal; the normal dashboard (`#dashboard-populated`) toggles against it.
- **F.2** Whole dashboard cards are links to their tab (`data-card-link` + `role="link"` + keyboard via `setupCardLinks()`; `.card--link` hover/focus affordance).
- **F.4** "Expense Breakdown" card: essential vs non-essential $ + % of spend + share bar, respecting the active display period.
- **F.3** ⏸ deferred (see Deferred).

### Phase G — What If redesign (sandbox editor + simulated dashboard)
**Redesign (locked with user):** What If is a **sandboxed second instance of the app** — editable inline sections on top operating on a `whatIfFinanceData` clone (edits never touch live data), and **Calculate** renders a **full simulated dashboard** below (same card layout as the main one) with ↑/↓ delta badges vs current. The earlier "piecemeal levers" approach (and the old G.1/G.2/G.3/G.4 framing) was superseded by this. Built in stages:
- **Stage 0 — Allocation savings goals + current funds (main system).** Each allocation bucket gains `currentBalance` + `savingsGoal` (data model + `migrateAllocationFields()` on load/import). Dashboard allocation cards show, per bucket with a goal, a progress bar + `current / goal · time-to-reach`, where **time = (goal − funds) ÷ annual contribution** (contribution = % × total net annual income). Updates live. `formatTimeToGoal()` in utils. *(This is the user's reframing of G.6 — a forward, per-bucket projection — and it lives in the **real** app, not just What If.)*
- **Stage 1 — Scenario-clone scaffold.** `whatIfFinanceData` clone + `data-scope="whatif"` routing: the settings handlers write to the clone (not live data) when an input is whatif-scoped; allocation total / add / remove made scope-aware.
- **Stage 2 — Editable sections.** Full inline editors for **Income Sources, Essential/Non-Essential Expenses, Assets, Liabilities, Allocation (goals/funds), FI Settings** — all scope-routed to the clone (income special cases handled: distinct `whatif-primary-income` radio, scope-aware `incomeType`). Tax uses live brackets. `runWhatIfScenario` derives everything from `calculateTotals(whatIfFinanceData)` — no overrides.
- **Stage 3 — Simulated dashboard + period switcher.** Renders Income, Outgoing vs Savings, Net Worth, Expense Breakdown, Financial Independence, and a full-width Allocation card (with the Stage 0 bucket goal/time-to-reach on scenario data). Each figure shows a `whatIfDelta()` ↑/↓ badge vs current (incl. "no change"). A **View period** selector reflows the cash-flow cards (daily/weekly/fortnightly/monthly/yearly); Net Worth + FI stay absolute.
- **G.5** ⏸ deferred; **G.6 inverse solver** ⏸ optional (see Deferred).

### Phase H — Remaining tab improvements
- **H.1** Resolved — the Income tab already has the Total Gross/Tax/Net summary card; adding sources is the gear modal + empty-state. No code.
- **H.2** Expense **name-search filter** above the lists (`#expense-search`, `setupExpenseSearch()`, display-only). *Category grouping ⏸ (see Deferred).*
- **H.3** Savings — Barefoot-buckets explainer (`<details>`, the user's copy); live sum enforcement shows exact over/under to 100%; benchmark hint on the Savings Rate card.
- **H.4** Liabilities **cost-indicator badge** (High >10% red / Moderate 5–10% amber / Low <5% green). *Years-to-zero projection ⏸ (see Deferred).*
- **H.5** Settings — both reset buttons use the **inline confirm** (not `window.confirm`); fixed a latent z-index bug (`.inline-confirm` 1000 → 2500, so inline confirms — incl. expense/liability deletes that moved into modals — render in front of modals); FI sensitivity hint added.
- **H.6** Savings tab **Assets card** (read-only list + total, rendered as a tinted-card grid like the dashboard Net Worth breakdown).

### Phase I — Visual polish + responsive
- **I.1** Card `--border` for definition on dark themes (grid was already responsive).
- **I.2** Stat cards tokenised (were hardcoded light-grey on every theme); `2rem`/`tabular-nums` number, `0.75rem` muted label.
- **I.3** `tabular-nums` on all figure classes (was already in place); stat sizing tuned.
- **I.5** Motion — global `prefers-reduced-motion` guard (already in place).
- **I.6** What If results token-only colours (done by 0.5).
- **I.7** Softer essential-expense palette: essentials were `--color-negative` (red — the "feel bad about necessities" problem). Added `--color-essential` (calm) + defined `--color-warning` (amber — was referenced but undefined). Essentials calm, non-essentials amber, on the Expenses tab + F.4 card + sim dashboard.
- **I.8** Removed **all** UI emojis; section markers use inline tab-style SVG icons (5 modal titles reuse tab icons; 3 empty-state cards get SVGs); everything else is clean text. Dev-only emojis in `sw.js` logs + `tests.html` intentionally left.
- **I.4** ⏸ verify-only (see Deferred).

---

## Key fixes & architecture notes (worth keeping)

- **Theme system has two token layers.** `applyTheme(THEMES[name])` derives the *full* token set (text, border, content-bg, tints, tab colours) from a preset; `applyGuiStylesToPage()` overlays the *customisable subset* (bg/card/accent/semantic/typography). Any action that wrote only the subset left the rest on the previous theme → a recurring **"split look"** bug (dark page, light cards, invisible text). **Fix:** `applyGuiStylesToPage()` now applies the full base **first**, then the subset — one chokepoint every appearance change funnels through (load, reset, factory reset, JSON import, live preview). The swatch handler also commits the preset's per-colour values via `syncGuiSettingsFromInputs()` so the name and per-colour representations never diverge.
- **What If scope routing.** Editable scenario inputs carry `data-scope="whatif"`; the shared settings handlers write to `whatIfFinanceData` (the clone) instead of `financeData`, and skip the live re-render. Add/remove and the allocation-total are scope-aware. This is what makes What If a true sandbox.
- **Service worker is manually versioned.** Cache-first for JS/CSS means **you must bump `VERSION` in `sw.js`** on any asset change, or reloads serve stale code. (This bit us repeatedly mid-build.)
- **0.6 — salaried calc.** The tax *engine* is correct; the bug was *behavioural* (salaried discarded the user's actual net/tax). Fixed by honouring the override-when-present, estimate-when-blank rule.
- **Theme-consistency cleanup.** A family of hardcoded-colour elements that ignored the theme were tokenised along the way: stat cards, liability cards, `.btn-secondary`, the gear/edit buttons, and the `--color-warning` token.

---

## Project history (brief)

The plan evolved through five forward-looking revisions before this record:
- **Rev 1–2** gated almost everything behind the sidebar (Phase A). That was backwards — the high-value/high-risk work is *logic*, not chrome.
- **Rev 3** added Phase 0 (correctness hotfixes, "do first"), Phase R (routing refactor before the data-entry move), and demoted the sidebar off the critical path.
- **Rev 4** audited Phase 0 against the source (all real), cut two "valuable-work-behind-chrome" dependencies, and added Phase T (tests before the routing churn).
- **Rev 5** reconciled the *Current and Proposed Features v2* doc: added 0.6, re-cast Phase D to per-tab modals, and added F.4 / I.7 / the allocation goals (and the What If redesign that became Phase G's Stages 0–3).
- **Rev 6 (this doc)** records the finished state.
