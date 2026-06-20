# Finance-Tracker.V1 — Implementation Plan (Revision 5)

Last updated: 2026-06-20
Supersedes Revision 4. Folds in the *Current and Proposed Features v2* document: a new correctness bug (salaried pay/tax), a re-cast Phase D (per-page settings modals instead of inline forms), and four new feature items (F.4, G.6, I.7, plus the allocation lever). Keeps the **correctness-first** philosophy.

---

## What changed in Rev 5 (read me first)

The *Current and Proposed Features v2* doc was reconciled against this plan on 2026-06-20. ~70% of its "planned additions" already mapped onto existing phases (D, F, G); this revision absorbs the rest:

1. **New correctness bug → Phase 0.6 (do first).** v2's ⚠ Bug Note reports salaried fortnightly income *and* per-cycle tax computed wrong. Per "correctness before chrome," this reopens the Phase 0 bucket ahead of all design work. See 0.6.
2. **Phase D re-cast: per-page settings modals, not inline forms.** Decision locked with user (2026-06-20). Each tab shows **read-only display cards** with a gear button opening a **per-page settings modal** (reusing the A.4 focus-trapped modal pattern), rather than moving editable forms inline. Satisfies v2 Overall Idea #3. Phase R's `data-collection` routing makes this safe; the one remaining touch is **hoisting the delegated listeners off `#settings`** (they move with the forms into modals). See re-cast Phase D.
3. **Four new feature items.** `F.4` dashboard essential/non-essential breakdown card; `G.6` "How much can I save in X time?" goal-seek; `I.7` softer essential-expense palette; an **allocation lever** added to `G.2`. `D.3` gains live allocation→savings recompute; `F.2` widens from "Edit →" affordances to whole-card linking.
4. **Phase C content pass remains.** The collapsible info component shipped (C done); v2's "expanded info panels" is now a copy-authoring task, not engineering — tracked as a note under Phase C / D.5.

---

## What changed in Rev 4 (read me first)

A code-vs-plan audit on 2026-06-19 confirmed every Phase 0 "✅ DONE" claim is real in the source (not aspirational): the tax engine handles `max: Infinity`, bands are half-open `[min,max)`, the broken HTML backup is gone, and What If both overrides net directly and persists across tab switches via `whatIfInitialized`. The audit produced four refinements, now folded in:

1. **Phase R is cheaper and half-done.** Every input already carries `data-index` + `data-field`, and expenses already route declaratively via `data-array`; only the *collection* mapping still walks the DOM (`.closest()`). R is now "add `data-collection` everywhere, delete the `.closest()` branches, unify the expense `data-array` onto the same attribute." Down-graded XS–S.
2. **Phase R's attribute list was wrong against the data model.** Rev 3 listed `liabilities|allocations` — but state uses `allocation` (singular) and omitted `assets` entirely. Corrected below.
3. **Two dependencies repeated the Rev-2 anti-pattern Rev 3 set out to kill** (valuable work gated behind chrome): `C → A` and `G.4/G.5 → D`. Both edges are cut — collapsible info lives inside each tab regardless of the nav shell, and What If comparison/saved-scenarios build on the already-corrected, already-persistent state from 0.4, not on the data-entry relocation.
4. **Correctness-first, but no automated tests exist.** Every "Test:" line in this plan is manual. `calculations.js` is pure functions (`calculateTaxFromBrackets`, `getTaxBracketBreakdown`, `calculateYearsToFI`) and is trivially unit-testable. Adding a minimal `tests.html` assertion harness is the single biggest gap and is recommended before Phase D churns the routing those functions depend on. Tracked as **Phase T** below.

---

## What changed in Rev 3

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

### 0.6 — Salaried mode ignores the user's actual net/tax override (NEW — Rev 5) — ✅ DONE (2026-06-20)

> **Implemented 2026-06-20.** `calculations.js`: salaried path now honours the per-cycle override — `taxRemoved` (and `invoicedPayPostTax`) take precedence when present; brackets are the fallback only when both are blank (one `hasNetOverride`/`hasTaxOverride` rule shared by both modes). `uiSettings.js`: removed the `disabled` attribute on Net Pay/Cycle + Tax Removed for salaried (now optional-override inputs with "(opt)" placeholders). `tests.html`: added 6 assertions — salaried-with-actuals reproduces $18,148 tax / $61,351.94 net and equals self-employed; blank net/tax falls back to the bracket estimate. HELP/HECS + Medicare estimate modelling deferred (optional follow-up, not in scope). *Not yet browser-run by me — math verified by hand and against the user's live figures.*

**ROOT-CAUSED 2026-06-20 (against live screenshots + source). Not a math bug — the tax engine is correct.** `incomeType` silently switches between two calculation paths in `calculateTotals()` (`calculations.js:14–28`):
- **Self-employed (Path B):** uses the user-entered `invoicedPayPostTax` (Net Pay/Cycle) and `taxRemoved` (Tax/Cycle) directly → accurate to real pay. *(Verified: 698 × 26 = $18,148 tax; 2359.69 × 26 = $61,351.94 net.)*
- **Salaried (Path A):** **discards** those two fields and estimates tax from the brackets (`calculateTaxFromBrackets(grossAnnual)`); the UI even disables the inputs (`uiSettings.js:36`, `netTaxDisabled = isSelfEmployed ? '' : 'disabled'`). *(Verified: $14,638 est. on $79,500 → net $64,862 → $2,494.69/fortnight — vs the real $2,359.69.)*

**Why the salaried estimate is ~$3,510/yr low:** bracket income tax $14,638 is *correct as income tax*, but omits **Medicare levy** (2% ≈ $1,590) and **HELP/HECS** (≈$1,920 at ~2.4% — the user has a study debt). Sum ≈ $18,148 = the user's real withholding, which their `taxRemoved` field already captures exactly. The `÷26` fortnightly factor is **fine** (79,500 ÷ 26 = 3,057.69; pay genuinely is fortnightly) — the earlier ÷26.0893 hypothesis was wrong.

**The bug is behavioural:** salaried mode violates the app's own stated contract (Tax Brackets card: *"Used to estimate net income for any source where 'Net Pay/Cycle' and 'Tax Removed/Cycle' are left blank"*) by disabling and ignoring those fields.

**Fix (chosen):** Make **salaried honour the Net Pay/Cycle + Tax Removed override when filled, falling back to the bracket estimate only when blank** — identical to self-employed. Stop disabling those inputs for salaried (`uiSettings.js:35–36`); collapse Path A/B into one "override-if-present, else estimate" rule in `calculateTotals()`. A PAYG employee knows their exact net/tax from a payslip and should be allowed to enter it.
**Optional follow-up (not the fix):** add Medicare levy + HELP/HECS modelling to the *estimate* path for users who leave the fields blank. Still an estimate; keep the "estimate" label.
**Test:** salaried source with net/tax filled reproduces the self-employed figures exactly (net/cycle $2,359.69, tax/yr $18,148); salaried source with those fields blank falls back to the bracket estimate; add both as assertions in `tests.html` (Phase T).

---

## ✅ Phase R — Event-Routing Refactor — DONE (2026-06-19)

> Implemented: `data-collection` added to every editable settings input in `uiSettings.js`; the expense `data-array` migrated onto it; `handleSettingsChangeEvents` now resolves the target array via `financeData[target.dataset.collection]` against the `SETTINGS_COLLECTIONS` whitelist instead of `.closest()`. The `incomeType` re-render branch and allocation-total special case were switched to read `data-collection` too. Behaviour-preserving; the delegated listeners remain on `#settings` (the one attachment point Phase D still needs to relocate).

**Why:** `handleSettingsChangeEvents` (and delete/add handlers) in `events.js` identify *which collection* an input belongs to by DOM ancestry — `target.closest('#income-sources-settings')`, `'#expenses-settings'`, etc. Phase D moves those containers out of Settings into each tab, which **silently breaks routing** (the `closest()` selectors no longer match). Fixing this reactively, mid-D, is painful.

**Starting point (audited 2026-06-19):** `data-index` and `data-field` are *already* present on every editable input. Expenses *already* route declaratively via `data-array="essentialExpenses|nonEssentialExpenses"` (events.js). Everything else (income, tax, assets, liabilities, allocation) still routes by ancestry. So R is mostly "finish what's started + unify the attribute name."

**Fix (do before D):**
- Add `data-collection` to each editable input. Valid values are the exact `financeData` keys: `incomeSources`, `taxBrackets`, `assets`, `liabilities`, `allocation` (singular), `essentialExpenses`, `nonEssentialExpenses`. *(Note: `allocation` is singular and `assets`/`taxBrackets` were missing from Rev 3's list — both corrected here.)*
- Migrate the existing expense `data-array` onto `data-collection` so there is one attribute, not two.
- Rewrite `handleSettingsChangeEvents` to resolve the array via `financeData[target.dataset.collection]` (guarded by a whitelist of the keys above) instead of `target.closest('#…-settings')`. Do the same for the `incomeType` re-render branch and the allocation-total special case.
- This makes the field→collection mapping DOM-independent. **Caveat (honest scoping):** the delegated listeners are still attached to `#settings`, so Phase D must re-attach (or hoist to `#main-content`/`document`) when it relocates containers — that is the *one* handler touch D still needs. R removes the dangerous part (silent per-field mis-routing), not the listener-attachment point.

**Test:** All existing Settings edits still write to the right `financeData` path after the refactor, with containers left exactly where they are (refactor is behaviour-preserving until D moves them).

**Effort:** XS–S (≈½ session, down from Rev 3's S–M now that half the work was already in place). High leverage — turns the riskiest phase (D) into a safe one.

---

## Phase B — Quick Wins / Bug Fixes (remaining)

Self-contained, low-risk, any order. No longer gated on Phase A.

### B.1 — Preserve What If scenarios across tab switches *(fast-tracked → Phase 0.4)*
- `whatIfState` becomes a module-level object, cloned from live data only on first show or explicit "Reset to live data" click.
- Add a visible "Reset to live data" button atop the What If panel.

### ✅ B.2 — Persistent user defaults — DONE

### ✅ B.3 — Fix hardcoded A$ in HTML — DONE
All static `A$0.00` placeholders removed from `index.html` (currency spans now empty); render passes in `uiDashboard.js` / `uiSettings.js` / `main.js` fill them via `formatCurrency()` on load.

### ✅ B.4 — Delete confirmations (non-blocking) — DONE
Added reusable `inlineConfirm(triggerEl, message, onConfirm)` in `events.js` + `.inline-confirm` styles. Wired into expense + liability delete handlers: auto-focus Yes, dismiss on Escape / No / outside-click, refocus trigger on cancel. Built to be reused by H.5's reset confirm.

### ✅ B.5 — Negative savings rate — DONE

### ✅ B.6 — Live colour picker preview — DONE
`input`/`change` listeners on the GUI form call `applyGuiSettingsLivePreview()` (factored `syncGuiSettingsFromInputs()` + `applyGuiStylesToPage()`, no persistence). Apply button relabelled "💾 Save Settings"; Save still triggers `autoSave.onDataChange()`.

### ✅ B.7 — Document daily assumption — DONE
Dashboard "Daily" figure relabelled "Daily (5-day week)" with a keyboard-accessible info tooltip explaining the 260-day basis (5 × 52). Tooltip reveal extended to `:focus`/`:focus-within` for a11y.

---

## Phase A — Left Sidebar Navigation + Layout Restructure — ✅ DONE (PR 1, 2026-06-19)

**Decisions (locked with user):** keep the ARIA `tablist` pattern but render it vertically (↑/↓); app-shell = full-height sidebar + slim top bar; appearance settings → gear-button modal **now**; desktop + tablet tiers this PR, **mobile bottom-nav deferred to PR 2**.

### ✅ A.1 — HTML restructure — DONE
`.container` + horizontal `.tabs` replaced with `.app-shell` (CSS grid: `topbar` row, `sidebar`+`main` row). Top bar reuses `class="header"` so `FinanceAutoSave`'s `querySelector('.header')` still finds it. Vertical `<nav class="sidebar" role="tablist" aria-orientation="vertical">`; panels in `<main class="content main-content">`. GUI panel extracted into a body-level modal (kept out of `.content` because its `backdrop-filter` would otherwise trap `position:fixed`).

### ✅ A.2 — Sidebar CSS — DONE
Grid `auto 1fr` so the sidebar's own width drives the column (transitioning width animates collapse). Desktop 240px ↔ 64px via `.app-shell.is-collapsed`; tablet (≤768px) defaults icon-only and expands on hover/`:focus-within`; active = accent left border + `--tab-active-bg-color`. Motion already covered by the global `prefers-reduced-motion` guard. **Mobile (<640px) bottom-nav deferred to PR 2** — small screens fall back to the icon-only sidebar (usable, not broken).

### ✅ A.3 — JS navigation — DONE
Click routing unchanged (sidebar keeps `role="tablist"`, so the existing `[role="tablist"]` delegation works). Keyboard switched to ↑/↓ + Home/End. `showTab` persists `ft-active-tab`; `restoreActiveTab()` restores on load (validates against `VALID_TABS`, defaults dashboard, ignores legacy `guiSettings`). Sidebar collapse persisted as `ft-sidebar-collapsed`. `showTab('whatIf')` already non-reinitialising since 0.4.

### ✅ A.4 — GUI Settings modal — DONE
Gear button (`#open-gui-settings`) opens `#gui-settings-modal` (`role="dialog"`, `aria-modal`, `aria-labelledby`); close via ✕ / Escape / backdrop mousedown. Focus trap + restore-to-trigger. `initializeGuiSettingsForm()` runs on open. Modal body keeps `id="guiSettings"` so swatch delegation + B.6 live-preview listeners are untouched.

### ✅ A.5 — Sidebar icons — DONE
Inline 20×20 `currentColor` SVGs (no icon font): dashboard grid, income trending-up, expenses trending-down, savings clock, liabilities card, what-if sliders, settings funnel, plus gear (modal) and hamburger (collapse toggle).

> **Deferred to Phase A — PR 2:** mobile (<640px) fixed bottom-nav with safe-area inset, and any mobile-specific icon/label tuning.

---

## Phase C — Collapsible Info Sections — ✅ DONE (2026-06-19)

Affects Income, Expenses, Savings, Liabilities **and What If** (5 sections — the generic component made adding What If free).

### ✅ C.1 — Component pattern — DONE
Each `.info-section[data-info-key]` has a header row (heading + chevron toggle, top-right) and a collapsible body containing a "Don't show again" checkbox. Collapsed state persists per key in `localStorage` (`ft-info-collapsed`) and restores on load via `setupInfoSections()`. Collapsed = heading row only (chevron rotates -90°). The checkbox collapses+persists; the always-visible chevron is the path back to expanded.

### ✅ C.2 — Rewrite info content — DONE
Every block rewritten to a 2–3 sentence intro + 3 "How to use" bullets + a native `<details>` "Learn more" expander for the deeper detail. Also tokenised the previously hardcoded info colours (`#1976d2`/`#424242` → `--accent-color`/`--text-color-primary`) so the blocks read correctly on dark themes.

---

## Phase D — Display Tabs + Per-Page Settings Modals (RE-CAST — Rev 5)

**Decision (locked with user, 2026-06-20):** data-entry does **not** move inline into tabs. Instead each tab renders **read-only display cards** and gets a **gear button → per-page settings modal** for editing that section (v2 Overall Idea #3). Editing is deliberate; tabs stay scannable.

**Reuses A.4 infra.** Generalise A.4's GUI modal into a reusable shell — `openSettingsModal(section)` — with the focus trap, Escape/backdrop close, and restore-to-trigger already built. Default to **one modal shell, swapped content** (single stacking context), not one modal per section; treat that as a D implementation note, not a blocker.

**Routing caveat (the one real risk).** Phase R made field→collection routing DOM-independent via `data-collection`, so the forms can move freely. BUT R left the delegated listeners attached to `#settings`. Moving the forms into modals takes them out of `#settings`, so **D must hoist those listeners to `document` (or re-attach on modal open)**. This is the single handler touch R flagged as still owed — budget for it explicitly.

**Still low-risk** because R removed the dangerous part (silent per-field mis-routing). Depends on R (mandatory, done) and ideally C (done).

> **Foundation + D.1 implemented 2026-06-20** (first vertical slice; the rest of D replicates this exact pattern):
> - **Reusable modal shell** — `setupGuiModal()` generalised into `setupModal(modalId, openBtnId, onOpen)` in `main.js` (focus trap / Escape / backdrop / restore-to-trigger unchanged; close button now found via `.modal-close`). GUI modal refactored onto it (behaviour-preserving). New `setupPageSettingsModals()` wires the per-page modals.
> - **Listener hoist (the mandatory Phase D touch)** — `handleSettingsClickEvents`/`handleSettingsChangeEvents` moved from `#settings` to **`document`** (`events.js`). Verified both handlers are fully guarded (settings add-button ids / `.delete-btn` + settings `data-type` / `data-field` + whitelisted `data-collection`), so What If + GUI inputs are never matched and there's no double-fire with the dashboard-period or currency listeners.
> - **CSS** — `.tab-settings-bar` + `.tab-edit-btn` gear-bar styles.
> - **Not yet browser-run by me** — structurally verified (single-occurrence ids, render funcs still target the relocated containers by id, populated on load via `initializeSettingsUI()` and again on modal open).

### ✅ D.1 — Income tab — DONE (2026-06-20)
Income panel gets a right-aligned **"⚙ Edit income & tax"** gear bar (`#open-income-settings`) opening `#income-settings-modal`. The Income Sources + Tax Brackets sections (markup unchanged, same inner ids `income-sources-settings`/`tax-brackets-settings`) were moved out of the Settings tab into that modal. Display cards on the tab are untouched. *(Original spec: display cards + modal with Income Sources name/type/gross/cycle/hours/primary + Tax Brackets — delivered as a literal relocation; the bracket card's "used in calculations" relabel is E.4.)*

### ✅ D.2 — Expenses tab — DONE (2026-06-20)
"⚙ Edit expenses" gear (`#open-expenses-settings`) → `#expenses-settings-modal` holding the Essential + Non-Essential Expenses sections (relocated; ids unchanged). *Category-grouping/totals polish deferred to H.2; this slice is the relocation.*

### ✅ D.3 — Savings tab — DONE (2026-06-20)
"⚙ Edit assets, allocation & FI" gear (`#open-savings-settings`) → `#savings-settings-modal` holding **Assets + Money Allocation + FI Settings** (allocation moved here per v2). **Live recompute already holds** — allocation/FI edits route through the document-level handler → `updateDataAndUI()`, so the Savings displays update immediately. *Sum-to-100 auto-balance + benchmark label deferred to H.3 (the existing "should equal 100%" total moved across as-is).*

### ✅ D.4 — Liabilities tab — DONE (2026-06-20)
"⚙ Edit liabilities" gear (`#open-liabilities-settings`) → `#liabilities-settings-modal` holding Liabilities Management incl. the existing `interestRate` field + Total Liabilities readout. *Cost badge + years-to-zero projection deferred to H.4.*

### ✅ D.5 — Settings tab removed entirely — DONE (2026-06-20)
Once the six data-entry sections relocated to per-tab modals and currency moved to the appearance modal (D.6), the Settings tab held nothing but data actions — so it was **removed completely** (panel + sidebar nav button). The two remaining unique actions (**Save as My Defaults**, **Reset to Factory Defaults**) moved into the appearance modal's new "💾 Data" section; Export/Import was already duplicated there as "Backup". `VALID_TABS` drops `settings` (legacy saved value falls back to dashboard); the obsolete `showTab('settings')` liabilities-total branch removed (the readout is kept fresh by `renderLiabilitiesSettings()`/`updateAllUI()`). Dead handlers for the removed Export/Import-data buttons cleaned up. *Info-panel content pass (copywriting) still outstanding.*

### ✅ D.6 — Settings consolidated into one modal + Currency relocation — DONE (2026-06-20)
Topbar gear opens `#gui-settings-modal`, now the single settings hub (title "⚙️ Settings", gear `aria-label` "Settings"): Appearance + Typography + **🌍 General (currency)** + one consolidated **💾 Save, Reset & Backup** section. **Currency moved into this modal** — what v2 explicitly asks for ("Currency Selector stays with GUI Settings", features doc §GUI Settings + Overall Idea #3). `#currency-select` id unchanged so its dedicated change listener + `setValue()` still bind.

**Action consolidation (user review, 2026-06-20):** the old standalone bottom button row merged into the Data section. Remaining actions: **"🎨 Reset Appearance"** (`reset-gui-settings`), **"🌟 Save as My Defaults"** (`set-current-default`), **"🔄 Reset to Factory Defaults"** (`reset-to-defaults`), Export/Import Backup. A one-line `.settings-hint` explains Appearance vs Defaults vs Backup. *(Corrects an earlier Rev 5 draft that wrongly kept currency in the Settings tab.)*

**Appearance auto-save (user decision, 2026-06-20):** to kill the two-different-save-behaviours inconsistency, **all appearance changes now persist automatically** and the **"Save Appearance" button was removed** (`apply-gui-settings` / `actionApplyGuiSettings` deleted). Theme swatches already auto-saved (after the theme-persistence bugfix); custom colour/typography controls now persist via a new `commitGuiSettings()` wired to each control's `change` event (`input` still drives no-persist live preview so dragging stays smooth). Net: pick a theme, drag a colour, or change a font → applied + saved; reload keeps it.

### Theme "split look" root-cause fix (2026-06-20)
The split/half-applied theme bug recurred across three triggers (swatch reload, then Reset Appearance) because the appearance system has **two token layers**: the *full* preset base (`applyTheme(THEMES[name])` — text/border/content-bg/tints/tab colours) and a *customisable subset* (`applyGuiStylesToPage` — bg/card/accent/semantic/typography). Any action that wrote only the subset left the base on the previous theme. **Fix:** `applyGuiStylesToPage()` now applies the full preset base **first** (single chokepoint every appearance change funnels through), then overlays the subset — so theme reset, factory reset, JSON import, load, and live preview are all consistent by construction. The earlier swatch-click `syncGuiSettingsFromInputs()` fix stays (keeps the per-colour fields matching the picked preset). Reset Appearance simplified to rely on the chokepoint.

### Theme persistence bugfix (found during D review, 2026-06-20)
**Bug:** save a theme as default, switch to another preset (e.g. Midnight) *without* "Save Appearance", reload → a split/half-applied theme (dark page, light cards, near-invisible text). **Root cause:** the preset-swatch handler (`events.js`) set `guiSettingsData.theme` + the picker *inputs* + persisted, but never wrote the preset colours into `guiSettingsData.primaryBgStart/cardBgStart/…`. On reload `loadTheme()` applies the preset by name, then `applyGuiStylesToPage()` overlays the **stale** per-colour subset (still the old theme) → conflict (the subset it overrides ≠ the tokens it doesn't, e.g. `--text-color-primary`). **Fix:** swatch click now calls `syncGuiSettingsFromInputs()` to commit the preset colours into `guiSettingsData`, keeping the name and per-colour representations consistent. *(Legacy already-divergent saves self-heal by re-picking a theme once.)*

### Polish applied during D (from user review of D.1)
- **Themed gear button** — `.tab-edit-btn` was rendering as hardcoded-grey `.btn-secondary`; re-styled as a themed outline (accent border/text, accent fill on hover) via two-class specificity. Dropped `btn-secondary` from the markup.
- **Cramped rows / resizable** — data modals use `.modal--wide` (`min(1100px, 95vw)`) + `.modal--resizable` (`resize: both`, drag handle) so the 9-column income row has room and the user can resize; dynamic lists get a `min-width` + horizontal scroll fallback.

---

## Phase E — Tax Bracket Calculation (remaining)

### ✅ E.1 / ✅ E.2 / ✅ E.3 — DONE (engine, type split, per-source breakdown)

### ✅ E.4 — Bracket table relocation + label — DONE/RESOLVED (2026-06-20)
Relocation done by **D.1**: the editable bracket table moved into the Income gear modal, and the read-only "Tax Brackets (Estimate)" reference card sits on the Income tab. The proposed "used in calculations" relabel is **superseded** — post-0.6 the brackets are only a *fallback estimate* (used when Net/Tax per cycle are blank), so the existing "Estimate" labels (tab card + modal "used for estimates") are more accurate. No code change needed.

> **Data accuracy note (carried from Rev 2, partially resolved by Phase 0):** 0.1 + 0.2 fix the structural bracket bugs. Default brackets still omit Medicare levy / LITO and use stale ATO values — net remains labelled an **estimate**. Refreshing rates to a current schedule is optional follow-up, not a blocker.

---

## Phase F — Dashboard Improvements

### ✅ F.1 — Empty state — DONE (2026-06-20)
`#dashboard-empty-state` (welcome message + three `.empty-action-card`s: Add income / Add expenses / Set FI goal) shows when there's no income, expenses, assets, or liabilities; the normal dashboard is wrapped in `#dashboard-populated` and the two toggle in `updateDashboardUI()`. Each action card jumps to the relevant tab **and opens its settings modal** (`setupDashboardEmptyActions()`), since data entry now lives in the gear modals.

### ✅ F.2 — Card linking & interactivity (widened — Rev 5) — DONE (2026-06-20)
Whole dashboard cards are now links to their tab: Income Overview → Income, Outgoing vs Savings → Expenses, Expense Breakdown → Expenses, Net Worth → Savings, Income Allocation → Savings. Each card carries `data-card-link` + `role="link"` + `tabindex="0"` + an `aria-label`; `setupCardLinks()` handles click and Enter/Space. `.card--link` gives a hover-lift + accent border + focus ring. (This also delivers F.4's "click-through to Expenses".)

### ⏸ F.3 — Upcoming bills — DEFERRED (user, 2026-06-20)
Deferred at the user's request — wants to think more about the design before it's built (it introduces a new `upcomingBills[]` data model + an Expenses-modal "Bills" section + a dashboard "Upcoming this month" card, and how it interacts with the existing expense totals). Original scope: new `financeData.upcomingBills[]` (`name`, `amount`, `dueDate`, `frequency`); due ≤30 days; excluded from monthly totals unless due this period. **Not started.**

### ✅ F.4 — Expense breakdown card (NEW — Rev 5) — DONE (2026-06-20)
Dashboard "Expense Breakdown" card (in the grid, next to Outgoing vs Savings): essential vs non-essential dollar figures + % of spend + an essential-share split bar, **respecting the active display period** (weekly→period factor mirrors the existing expense conversion). Empty state ("—") when no expenses. `updateDashboardUI()` renders it. *Deferred to their own phases: click-through to Expenses (lands with **F.2** card linking) and the softer essential colour (lands with **I.7**) — the card uses default tokens until then.*

---

## Phase G — What If Tab Rebuild

> G.1 + G.3 fast-tracked into **Phase 0.4** (correctness). Phase G now covers the value-add levers, comparison, and saved scenarios on top of the corrected, persistent state.
>
> **Rev 4:** G.4 (comparison) and G.5 (saved scenarios) are pure What-If-tab work built on the corrected, persistent 0.4 state — they do **not** depend on Phase D's data-entry relocation and can ship independently. Only G.2's full lever set benefits from D's richer per-tab inputs.

### G.1 — Scenario persistence — *moved to Phase 0.4*

### G.2 — Full lever set (v2: "full-setting access for scenarios")
Expose **every** base-app setting as an adjustable lever, seeded from current state but fully overridable: income, essential expenses, non-essential expenses (% reduction), savings-rate boost (override), liabilities adjustment (total debt), FI assumptions (multiple/return/withdrawal), assets (±), and the **Income Allocation Strategy** (per-category %, sum-to-100 enforced — v2 explicitly wants the allocation slider as a scenario lever). All scenario-only; never mutate live data (already true since 0.4).

### G.3 — Income calculation fix — *moved to Phase 0.4*
Operate on **totals**: apply income change directly to net; never touch per-source gross.

### G.4 — Baseline comparison
"vs. current plan" delta table (FI date, annual savings, savings rate, 10-yr net worth) with red/green direction colouring.

### G.5 — Save scenarios
Name + store up to 3 in `localStorage` (`ft-what-if-scenarios`); dropdown/tabs at top; compare two side-by-side in delta-table format; store full lever state + name.

### G.6 — "How much can I save in X time?" goal-seek (NEW — Rev 5)
A target-driven mode on top of the G.2 lever set: user sets a **target timeframe** (and optionally a target amount / "by date") and adjusts every lever — income, expenses, allocation strategy — to see **how much accumulates in each account by that date**, fully interactive. Two framings, both useful:
- **Forward:** given these levers, project the balance per allocation account at the target date.
- **Inverse (goal-seek):** given a target amount by a date, surface what's required (e.g. needed monthly savings / allocation split) and how close the current levers get.
Builds on the corrected, persistent 0.4 state and the G.2 levers. Helps users plan a split when they need $X by a date while still covering other expenses. **Decision needed at build time:** forward-projection only (simpler, M) vs full inverse solver (more math, M–L). Recommend shipping forward first, inverse as a follow-up. Depends on G.2.

---

## Phase H — Remaining Tab Improvements

### ✅ H.1 — Income — DONE/RESOLVED (2026-06-20)
The "total Gross/Tax/Net summary row" already exists (Income tab "Income Breakdown (Total)" card). Adding income sources is the gear modal (D.1) plus the F.1 empty-state "Add income" card, so a separate top add-button is redundant. No code needed.
### ◧ H.2 — Expenses — search DONE; category grouping deferred (2026-06-20)
**Name search filter** added above the Expenses lists (`#expense-search`): `expenseSearchQuery` + `setupExpenseSearch()` filter both lists live (display-only — totals stay full); shows a "no matches" message per list. **Category grouping deferred** — expenses only have an essential/non-essential `type`, no free-form category; grouping needs a `category` field (data-model change, like F.3). Flag for a future data-model pass.
### ✅ H.3 — Savings — DONE (2026-06-20)
Collapsible **Barefoot Investor buckets** explainer (`<details>`) added to the Savings modal's allocation section (Blow/Mojo/Grow with the Daily/Splurge/Smile/Fire-Extinguisher split; framed as starting points, user tunes them). **Live sum enforcement** enhanced — `updateAllocationTotalDisplay()` now shows the exact over/under (e.g. "95.0% — 5.0% under") in red until it hits 100%. **Benchmark** hint added to the Savings Rate card ("aim for 20%+ …"). *(Allocation method is the Barefoot bucket system — see memory.)*
### ✅ H.6 — Savings — Assets display card — DONE (2026-06-20)
Read-only "Assets" card added to the Savings tab (after the Savings Rate / FI grid): each asset as name + balance, with `Total:` in the subtitle and an empty state. `updateSavingsTabUI()` renders it (called every `updateAllUI()`), reusing the dashboard Net Worth card's exact `.account-item.asset` markup and `escapeHtml`/`formatCurrency`. Container ids `savings-total-assets` / `savings-assets-display` (distinct from the dashboard's). Complements D.3 (assets edited in the Savings gear modal, now also shown on the tab).
### ◧ H.4 — Liabilities — cost indicator DONE; debt-free projection deferred (2026-06-20)
Interest field already present (D.4). **Cost indicator badge** added to each liability card — `High interest` (>10%, red), `Moderate interest` (5–10%, amber), `Low interest` (<5%, green) via `.cost-badge`. **Debt-free / years-to-zero projection deferred** — it needs a per-liability repayment amount in the data model (none exists yet), same as F.3's bills; flag for a future data-model pass. The existing "Net Worth if Debt-Free" card already covers the debt-free framing.
### ✅ H.5 — Settings — DONE (2026-06-20)
Both reset buttons (`reset-to-defaults`, `reset-gui-settings`) now use the **B.4 inline confirm** instead of blocking `window.confirm()` (confirmation moved out of the action fns into the click handlers). **Latent bug fixed along the way:** `.inline-confirm` z-index was 1000 but modals are 2000 — so the inline confirm (incl. the existing expense/liability **delete** confirms, which moved into modals in Phase D) was rendering *behind* the modal. Bumped to 2500. **FI sensitivity hint** added under the FI inputs in the Savings modal. *(`actionSetCurrentAsDefault`'s confirm left as native — non-destructive, out of scope.)*

---

## Phase I — Visual Polish + Responsive Scaling

### ✅ I.1 — Dashboard card grid — DONE (2026-06-20). `.dashboard-grid` already does responsive columns (`auto-fit minmax(280px,1fr)`) with themed `--card-bg` gradient + shadow; added `border: 1px solid var(--border-color)` for definition on dark themes (shadow is faint there).
### ✅ I.2 — Stat card design — DONE (2026-06-20). Stat cards were **hardcoded light-grey** (`#f8f9fa`/`#6c757d`/`#495057`) on every theme — tokenised to `--card-bg`/`--border`/`--accent`/`--text-color-*`; primary number bumped to `2rem`/700 `tabular-nums`, label `0.75rem` muted. *(Accent icon + delta indicator skipped — would need per-stat icon data; not worth the markup churn.)*
### ✅ I.3 — Typography hierarchy — DONE (already in place). `tabular-nums` already applied to every figure class via an existing rule (`.amount, .stat-value, .time-amount, …`); stat sizing tuned in I.2. Heading/sidebar sizes already sensible.
### ◧ I.4 — Responsive audit @ 375/768/1024/1440 — **needs browser verification.** Media queries exist (≤768px stacks, etc.) and the grids are `auto-fit`, but reflow / no-horizontal-scroll / ≥44px touch targets can't be tested from here — flagged for a manual pass at the four widths (esp. the wide/resizable settings modals on small screens).
### ✅ I.5 — Motion — DONE (already in place). Global `@media (prefers-reduced-motion: reduce)` guard zeroes animations/transitions; card/sidebar transitions present. *(Modal opacity/scale animation skipped — modals toggle via `hidden`; adding it is a behaviour change for little gain.)*
### ✅ I.6 — token-only colours in What If results — DONE by Phase 0.5 (results use `POS`/`NEG`/`MUTED` CSS-var refs, no hardcoded hex).
### ✅ I.8 — Remove all UI emojis → SVG icons (NEW, user request 2026-06-20) — DONE
All user-facing emojis stripped (headings, buttons, autosave status, messages, empty state). Section markers now use inline tab-style SVG icons: the 5 settings-modal titles reuse the matching tab icons (income/expenses/savings/liabilities/settings), and the 3 dashboard empty-state action cards get SVGs. Sub-headings/buttons/status are clean text. `∞` kept (math symbol). Dev-only emojis in `sw.js` console logs + `tests.html` harness intentionally left (not user-facing). `.modal-header h2` made `inline-flex` for icon alignment.

### ✅ I.7 — Softer essential-expense palette (NEW — Rev 5) — DONE (2026-06-20)
Essentials were using `--color-negative` (**red** — the most alarming colour, exactly the "feel bad about necessities" problem). Added `--color-essential` (calm neutral tone) + properly defined `--color-warning` (amber — it was referenced but undefined, silently falling back to text colour) in `deriveTokens`. Expenses tab: essential border → calm, non-essential → amber. F.4 dashboard card: essential figure calm, non-essential amber, split bar in the essential tone. Token-based, theme-safe.

---

## ✅ Phase T — Minimal Test Harness — DONE (2026-06-19)

**Why:** The plan is correctness-first yet had zero automated tests; the 0.1/0.2 bugs are exactly what a small assertion table catches and prevents regressing. `calculations.js` is pure functions, so this is cheap.

**Implemented:** Standalone `tests.html` (no framework) loads `utils.js` + `calculations.js` and runs 19 assertions, rendering a pass/fail table + summary (and a ✓/✗ document title). Open it in a browser to run. Coverage:
- `calculateTaxFromBrackets`: `Tax(0)===0`; `Tax(18200)===0`; `Tax(18200.50)===0.095` (no fractional crack); `Tax(45000)`, `Tax(120000)`, `Tax(200000)` exact; `Tax(120k) < Tax(200k)`; boundary continuity at 45000; effective rate monotonically non-decreasing across $20k–$500k.
- `getTaxBracketBreakdown`: Σ per-band `taxable` = gross; Σ per-band `tax` = `calculateTaxFromBrackets`; empty for gross ≤ 0.
- `calculateYearsToFI`: `r===0` simple division; already-at-target → 0; zero & negative savings → Infinity; known compound case (≈7.84273 yr).

Expected values were independently verified in Python and every assertion traced against the JS source; all 19 pass. **Effort:** XS.

---

## Execution Order (Rev 5)

```
Phase   Description                                  Depends on     Effort       Status
──────────────────────────────────────────────────────────────────────────────────────────────
0       Correctness hotfixes                         —              S (1 s)      ✅ DONE (0.1–0.5)
          0.1 open-ended top bracket                                                  ✅ verified in source
          0.2 off-by-one band boundaries                                             ✅ verified (half-open)
          0.3 remove broken HTML backup                                              ✅ verified removed
          0.4 What If income+persistence (was G.1/G.3)                               ✅ verified persistent
          0.5 token-ise What If colours                                             ✅ verified token-only
0.6     Salaried net/tax override fix                —              S            ✅ DONE (2026-06-20)
R       Event-routing refactor (data-collection)     0 (recommended) XS–S (½ s)   ✅ DONE ← de-risks D
T       Minimal test harness (tests.html)            —              XS           ✅ DONE (19 assertions)
B       Quick wins (B.1*/B.3/B.4/B.6/B.7)            —              S (1 s)      ✅ DONE (B.1→0.4; B.2–B.7 ✅)
A       Sidebar nav + layout                         R recommended  L (3–4 s)    ✅ DONE PR1 (mobile bottom-nav → PR2)
C       Collapsible info sections                    —             S (<1 s)     ✅ DONE (5 sections incl. What If)
D       Display tabs + per-page settings modals      R (mandatory)  L (3–4 s)    ✅ DONE (D.1–D.6, 2026-06-20)
E       Tax bracket calc                             —             XS           ✅ DONE (E.1–E.4; E.4 resolved via D.1)
F       Dashboard improvements                       D, E          M (1–2 s)    F.1/F.2/F.4 ✅; F.3 ⏸ DEFERRED (user)
G.2     What If full lever set (incl. allocation)    D, 0.4        M (1–2 s)    TODO
G.4/G.5 What If comparison + saved scenarios         0.4           M (1–2 s)    TODO  (not gated on D)
G.6     "How much can I save in X time?" goal-seek   G.2           M (–L)       TODO  (NEW)
H       Remaining tab improvements                   D, E          S–M (1 s)    ✅ DONE (H.1/H.3/H.5/H.6; H.2/H.4 partial — projection+grouping deferred)
I       Visual polish + responsive                   all above     M (1–2 s)    ✅ DONE (I.1/I.2/I.3/I.5/I.6/I.7/I.8; I.4 needs browser verify)
```

Size key: XS < 0.5 session, S < 1, M 1–2, L 3+.

### Recommended path
1. ~~**Phase 0** — fix the wrong numbers.~~ ✅ **DONE** — all five verified in source.
2. ~~**Phase R** — decouple event routing.~~ ✅ **DONE** — makes D safe.
3. ~~**Phase B** remaining quick wins.~~ ✅ **DONE** (B.3/B.4/B.6/B.7).
4. ~~**Phase T** test harness before D churns the routing.~~ ✅ **DONE** (`tests.html`, 19 assertions).
5. ~~**Phase A** sidebar~~ ✅ **DONE (PR1)** — app-shell + vertical sidebar + gear modal; mobile bottom-nav deferred to A-PR2.
6. ~~**0.6** salaried net/tax override fix~~ ✅ **DONE** (merged to `main`, PR #8).
7. ~~**D** display tabs + per-page settings modals (Settings tab removed; appearance auto-save; theme split-look fix)~~ ✅ **DONE** (merged to `main`, PR #8).
8. **Next candidates → E.4 → (F incl. F.4 / G.2 incl. allocation / H incl. H.6) → G.6 → I incl. I.7.** **G.4/G.5** and **I.7** can land independently anytime. **← we are here**

> **State as of 2026-06-20 (post-PR #7 + #8 merged to `main`):** Done — 0.1–0.5, **0.6**, R, B, T, A-PR1, C, **D (D.1–D.6)**, plus the theme split-look root-cause fix and appearance auto-save. **Remaining:** E.4 (bracket-table relocation/label), **F** (dashboard incl. F.4 + card linking), **G.2/G.4/G.5/G.6** (What If), **H** (tab polish incl. the new **H.6** Savings assets card), **I** (visual polish incl. I.7). Each warrants its own session; G.6 carries a build-time decision noted in its section. Outstanding non-phase item: the Phase C **info-panel copy** pass.

### Why this order (rationale)
- **Correctness before chrome.** A tracker that taxes $200k like $120k is worse than one that looks plain. Phase 0 items each fix a *wrong output*.
- **Refactor before relocate.** Phase R is cheap insurance that converts Phase D from "touches every handler" into "moves markup." Skipping R means debugging silent routing breaks for days.
- **Sidebar is not a gate.** Rev 2's A-blocks-everything dependency was already violated successfully; Rev 3 made that official; **Rev 4 removes the two remaining stealth gates (C→A, G.4/G.5→D).**
- **Test before churn.** Phase D rewrites the routing that feeds the pure calc functions; lock their behaviour with Phase T first.
- **Estimates bumped ~1.5×** on D and G to account for re-testing every tab and the from-scratch What If comparison/saved-scenario work.

### Don't-trust-the-output list
**All five items resolved** (Phase 0 + 0.6):
- ~~Tax for incomes above the top default band~~ → **fixed by 0.1** (top band now `max: Infinity`).
- ~~Any income near a band boundary~~ → **fixed by 0.2** (half-open `[min, max)` intervals).
- ~~"Save & Download HTML" backup~~ → **removed in 0.3** (JSON export/import is the supported path).
- ~~What If income scenarios~~ → **fixed by 0.4** (direct net-override totals approach; persistence across tab switches).
- ~~Salaried net/tax~~ → **fixed by 0.6** (Rev 5, 2026-06-20). Salaried now honours the actual Net Pay/Cycle + Tax Removed override (falls back to bracket estimate only when blank), matching self-employed. *(Optional later: model Medicare levy + HELP/HECS in the blank-field estimate.)*

\* B.1 (What If persistence) is fast-tracked into Phase 0.4 as a correctness item.