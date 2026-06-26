# Finance-Tracker.V1 — Implementation Record (Revision 7)

Last updated: 2026-06-25.
**Status: the implementation plan is complete.** Every planned phase — including the full Phase J theme & appearance redesign (J0–J4) — has shipped to `main`. The only work that remains is the **Outstanding items** section directly below: each is a deliberate stop (a design decision or a data-model addition), plus one browser-only verify pass.

This document is a *record of what was actually built*, not a forward plan. It is organised so the **outstanding items sit at the top**, the **completed record** sits in the middle, and a **running update log** sits at the very end — append new entries to that log as work continues.

Guiding principle throughout: **correctness before chrome** — fix wrong numbers first, then layout, then polish.

---

## ⏸ Outstanding items — read this first

Nothing below is broken or half-finished; each is a deliberate stop, mostly because it needs a **new data-model field** or a **design decision** first.

### Deferred — needs a data-model addition (would pair well as one "data-model pass")
- **F.3 — Upcoming bills.** A `financeData.upcomingBills[]` (`name`, `amount`, `dueDate`, `frequency`); a dashboard "Upcoming this month" card (due ≤30 days); edited in an Expenses-modal "Bills" section; excluded from monthly totals unless due this period. *Deferred at user request — wants to settle the design (esp. how bills interact with existing expense totals) first. Not started.*
- **H.2 — Expense category grouping.** Group expenses under collapsible category headers with per-category totals. Needs a free-form `category` field on expenses (today they only have an essential/non-essential `type`). *The name-search half of H.2 shipped; grouping deferred.*
- **H.4 — Debt-free / years-to-zero projection.** A simple payoff timeline per liability. Needs a per-liability repayment-amount field (none exists). *The cost-indicator badge half of H.4 shipped; the projection deferred. The existing "Net Worth if Debt-Free" card already covers the debt-free framing.*

### Deferred — other
- **G.5 — Saved scenarios.** Name + store up to 3 What If scenarios in `localStorage` (`ft-what-if-scenarios`); a dropdown to reload/compare. The Stage 0–3 architecture makes this straightforward later (serialise/restore `whatIfFinanceData` + a name). *Deferred at user request. Not started.*
- **G.6 — inverse solver.** The "set a target amount + date → back-solve the required savings/allocation split" direction. *Optional follow-up — the **forward** projection the original G.6 described already shipped as per-bucket savings goals (see Phase G / Stage 0).*
- **0.6 follow-up — Medicare levy + HELP/HECS in the estimate path.** When a salaried source leaves Net/Tax-per-cycle blank, the bracket estimate omits Medicare levy + HELP/HECS. *Optional; the estimate stays labelled an "estimate". The override path (the actual fix) is done.*
- **FI net-worth forecast chart (possible next feature).** The Phase C Savings copy referenced a "year-by-year forecast of your projected net worth" chart — which doesn't exist yet, so those two references were trimmed. A small line/area chart projecting net worth over time (compound growth from current assets + annual savings at the expected return) would make that copy accurate and is a natural Savings-tab addition. Not started.

### Verify-only (not a build item)
- **I.4 — Responsive audit @ 375 / 768 / 1024 / 1440.** Media queries exist and the grids are `auto-fit`; a manual pass at those widths (no horizontal scroll, ≥44px touch targets, the wide/resizable settings modals on small screens) is the last check. Can only be done in a browser. *(2026-06-21: a real iPhone 13 Pro pass surfaced + fixed a cluster of phone issues — see the completed mobile-fixes notes and the update log.)*

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
| C | Collapsible info sections | ✅ Done (incl. expanded copy) |
| D | Per-tab settings modals; Settings tab removed | ✅ Done |
| E | Tax bracket calculation (E.1–E.4) | ✅ Done |
| F | Dashboard improvements | ✅ F.1/F.2/F.4 (F.3 ⏸) |
| G | What If redesign (sandbox editor + simulated dashboard) | ✅ Stages 0–3 (G.5/G.6 ⏸) |
| H | Remaining tab improvements | ✅ H.1/H.3/H.5/H.6 (H.2/H.4 partial) |
| I | Visual polish + responsive | ✅ I.1/I.2/I.3/I.5/I.6/I.7/I.8 (I.4 verify-only) |
| J | Theme & appearance redesign (Odysseus-derived) | ✅ Done — J0–J4 shipped to `main` (2026-06-21) |

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
`.app-shell` CSS grid (topbar row + sidebar/main row), vertical `role="tablist"` sidebar (↑/↓ + Home/End), collapse toggle (persisted `ft-sidebar-collapsed`), active-tab persistence (`ft-active-tab`), GUI settings extracted to a body-level **gear-button modal** (`#gui-settings-modal`, focus-trapped). Inline 20×20 `currentColor` SVG icons.
- **Mobile bottom-nav (shipped 2026-06-21).** Under 640px the existing `<nav role="tablist">` sidebar is restyled (CSS-only) into a fixed bottom tab bar (icon-over-label, accent top-border on the active tab, iOS safe-area inset). Reuses `showTab()` + the click/keyboard wiring unchanged; keyboard nav extended to accept Left/Right as aliases of Up/Down for the horizontal orientation. Selectors are doubled with `.is-collapsed` so the bottom bar wins over the persisted collapsed-sidebar state.

### Phase C — Collapsible info sections
`.info-section[data-info-key]` with a chevron toggle + "Don't show again" checkbox; collapsed state persists per key (`ft-info-collapsed`). Content rewritten to intro + "How to use" bullets + a `<details>` "Learn more".
- **Expanded info-panel copy (shipped 2026-06-20).** User-supplied expanded copy applied to all five info sections (Income / Expenses / Savings / Liabilities + new What If copy written to match). Intro body paragraphs dropped, "Learn more" expanders enriched. *(Two references to a non-existent year-by-year forecast chart in the Savings copy were trimmed — see the FI forecast chart note under Outstanding.)*

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
- **F.3** ⏸ deferred (see Outstanding).

### Phase G — What If redesign (sandbox editor + simulated dashboard)
**Redesign (locked with user):** What If is a **sandboxed second instance of the app** — editable inline sections on top operating on a `whatIfFinanceData` clone (edits never touch live data), and **Calculate** renders a **full simulated dashboard** below (same card layout as the main one) with ↑/↓ delta badges vs current. The earlier "piecemeal levers" approach (and the old G.1/G.2/G.3/G.4 framing) was superseded by this. Built in stages:
- **Stage 0 — Allocation savings goals + current funds (main system).** Each allocation bucket gains `currentBalance` + `savingsGoal` (data model + `migrateAllocationFields()` on load/import). Dashboard allocation cards show, per bucket with a goal, a progress bar + `current / goal · time-to-reach`, where **time = (goal − funds) ÷ annual contribution** (contribution = % × total net annual income). Updates live. `formatTimeToGoal()` in utils. *(This is the user's reframing of G.6 — a forward, per-bucket projection — and it lives in the **real** app, not just What If.)*
- **Stage 1 — Scenario-clone scaffold.** `whatIfFinanceData` clone + `data-scope="whatif"` routing: the settings handlers write to the clone (not live data) when an input is whatif-scoped; allocation total / add / remove made scope-aware.
- **Stage 2 — Editable sections.** Full inline editors for **Income Sources, Essential/Non-Essential Expenses, Assets, Liabilities, Allocation (goals/funds), FI Settings** — all scope-routed to the clone (income special cases handled: distinct `whatif-primary-income` radio, scope-aware `incomeType`). Tax uses live brackets. `runWhatIfScenario` derives everything from `calculateTotals(whatIfFinanceData)` — no overrides.
- **Stage 3 — Simulated dashboard + period switcher.** Renders Income, Outgoing vs Savings, Net Worth, Expense Breakdown, Financial Independence, and a full-width Allocation card (with the Stage 0 bucket goal/time-to-reach on scenario data). Each figure shows a `whatIfDelta()` ↑/↓ badge vs current (incl. "no change"). A **View period** selector reflows the cash-flow cards (daily/weekly/fortnightly/monthly/yearly); Net Worth + FI stay absolute.
- **G.5** ⏸ deferred; **G.6 inverse solver** ⏸ optional (see Outstanding).

### Phase H — Remaining tab improvements
- **H.1** Resolved — the Income tab already has the Total Gross/Tax/Net summary card; adding sources is the gear modal + empty-state. No code.
- **H.2** Expense **name-search filter** above the lists (`#expense-search`, `setupExpenseSearch()`, display-only). *Category grouping ⏸ (see Outstanding).*
- **H.3** Savings — Barefoot-buckets explainer (`<details>`, the user's copy); live sum enforcement shows exact over/under to 100%; benchmark hint on the Savings Rate card.
- **H.4** Liabilities **cost-indicator badge** (High >10% red / Moderate 5–10% amber / Low <5% green). *Years-to-zero projection ⏸ (see Outstanding).*
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
- **I.4** ⏸ verify-only (see Outstanding).

### Mobile usability fixes (2026-06-21, from on-device iPhone testing)
Following the Phase A bottom-nav, real-device testing surfaced four issues, all fixed (CSS-only, in the `≤640px` media queries; verified headless at 390px):
- **iOS focus-zoom** — form controls were `<16px`, so iOS zoomed in on every field tap. All text-entry controls forced to `16px` on phones (no `user-scalable` disable).
- **Horizontal scroll in data-entry forms** — the dynamic-list rows set `grid-template-columns` inline (per row, in JS), which beat the responsive CSS; and `.modal--wide/.modal--resizable .list-item` pinned a `min-width: 720px`. On phones the rows now stack one field per line with their (normally `.visually-hidden`) labels revealed and the header row hidden; the 720px floor is dropped. Applies to Income/Tax/Assets/Liabilities/Allocation/Expenses **and** the What If scenario tables (same classes).
- **Page wider than the screen ("zoom out on first load")** — the mobile `.app-shell` used `grid-template-columns: 1fr`, whose `min-content` floor pushed the shell to ~456px. Changed to `minmax(0, 1fr)`; every tab now fits the viewport exactly.
- **Currency figures breaking mid-number** — superseded by the auto-fit pass below.

### Mobile usability fixes — round 2 (2026-06-21, second on-device pass)
- **Currency figures overflowing cards** (large numbers, `/fortnight` suffixes, clipping/overlap) — replaced per-card hacks with a **universal auto-fit**: figures are `white-space: nowrap` (so overflow is detectable) and `fitAllAmounts()` (`utils.js`) shrinks any over-long figure's font just enough to fit its card, down to an 11px floor. Hooked into `updateAllUI()`, `showTab()` (figures can't be measured while their tab is hidden), `runWhatIfScenario()` (the simulated What If dashboard renders on its own, outside `updateAllUI`) and a debounced `resize`. Applies at all widths. **Exception:** the allocation buckets (`.savings-breakdown`, dashboard + What If) carry a `/period` suffix too long for a 2-up cell even at the auto-fit floor — and iOS renders wider than desktop Chrome, so they overflowed on-device. Those go **single-column** on phones so the figure shows at full size; auto-fit remains the universal backstop for every other card.
- **Info "ⓘ" tooltips shoved off-screen** — the hover/absolute tooltips (`left:50%; margin-left:-125px`) clipped near screen edges. Replaced with native `<details class="info-tip">` disclosures that expand **inline** (like the "How the buckets work" `.info-more` expander): closed = an inline ⓘ by the heading; open = a full-width readable panel below it. Works on every width, accessible, touch-friendly — no positioning to clip. (A first attempt floated a fixed bottom panel, which needed dropping `.content`'s `backdrop-filter`; the inline `<details>` approach replaced it.)
- **Topbar crowding** — the "All changes saved" pill pushed the gear cog over the title. On phones the save-status indicator collapses to a small colour-coded **dot** (green/amber/red/orange), giving the title + gear their space back. Desktop keeps the full text pill.

### Phase J — Theme & appearance redesign (Odysseus-derived) — shipped 2026-06-21
A from-scratch redo of the theme presets **and** the appearance panel, modelled on the **Odysseus** theme system (the same codebase FT's token engine was originally lifted from, at `C:\Users\Nebula PC\odysseus`). Goal: nicer, less-templated themes and a two-tab panel (Themes | Customize) with save / share / import of user themes. **Locked with user (2026-06-21); all sub-phases (J0–J4) merged to `main` the same day** (PRs #9 and #10 plus the J3/J4 commits).

**Why it happened:** the mobile build was done; the themes felt templated and one was semantically wrong (a *positive* Net Worth rendered red/orange on several presets). See the four motivating issues under "Key fixes" → *Appearance redesign — motivating issues*.

**Direction (agreed):**
- **Same DNA as Odysseus.** Both apps key off the same 5-colour base — FT's `{bg, fg, panel, border, accent}` is Odysseus's `{bg, fg, panel, border, red}` (`accent` = `red`). Palettes **port directly**; only the *derived* layer differs (Odysseus derives syntax-highlight colours, FT derives finance semantics).
- **One chokepoint, always.** Every appearance change funnels through a single derive-then-apply function (FT's existing rule); the panel never sets tokens directly. This is what prevents the recurring "split look" bug.
- **Offline-native.** FT has no backend, so Odysseus's `/api/prefs` server sync is **dropped** — custom themes live in `localStorage`; "share" is the exported JSON file.
- **Port only what a finance app uses.** No chat bubbles / send buttons / code-block overrides. Customisable surfaces chosen by FT's real token map (audited in `style.css`), not a 1:1 copy.

**Customisation surface (judgment call from FT's token map):** Visible tier stays tight (the theme's *identity*); everything else hides under **More Colors**.
- **Colors — base (6):** Background (page) · Surface (cards/content) · Text · Accent · Border · Headings.
- **More Colors (grouped):** *Text detail* — muted/secondary, sub-heading, topbar text. *Surface detail* — content-area bg, card gradient 2nd stop, tab bg, active-tab bg. *Finance figures* — Positive / Negative / Neutral + Essential / Warning.
- **Font & Layout:** font family **+ custom font upload**, base size, background effect.
- **Stays derived (not exposed):** all tints (`positive-tint`, `info-bg`…), `tab-text` contrast, `content-bg` opacity.

**Sub-phases (all ✅ on `main`):**
- **J0 — Net Worth semantic fix.** Net Worth paints by sign — green when ≥ 0 (inherits `.amount`), red via `.amount.net-worth.is-negative` when < 0 — **not** `--accent-color`. The sign class is toggled in `uiDashboard.js` (live dashboard) and the What If sim markup (`events.js`). Fixes motivating issue #1.
- **J1 — Port the 12 palettes.** `light, midnight, paper, retrowave, forest, ocean, ume, copper, terminal, organs, lavender, cute` (rename `red`→`accent`), each given a **locked semantic trio** (green/red/blue, tuned per light/dark for contrast) so positives always read green.
- **J2 — Two-tab panel.** Rebuilt `#gui-settings-modal` into **Themes** (swatch grid with 4-circle previews + a "Your Themes" grid) | **Customize**, keeping the single chokepoint.
  - *Step 1.* Two-tab shell (`.appearance-tabs`/`.appearance-panel`, roving arrow keys, `setupAppearanceTabs()`); Themes tab shows the 12 four-circle Odysseus-style swatches (`renderThemeSwitcher` + `.theme-swatch-colors`) with a hidden "Your Themes" placeholder; Customize tab holds the colour/typography controls. All input ids preserved → wiring unchanged.
  - *Step 2.* `applyGuiStylesToPage` moved to a **derive-from-base** model: eight BASE colours (bg/text/surface/border/accent/positive/negative/neutral) feed `deriveTokens` for the full set; a handful of OVERRIDE colours (heading/muted/topbar-text/essential/warning) overlay only when pinned (empty = derived). New `--heading-color` token (`.card-title`/`.settings-title`). Colours UI is now a base-6 round-swatch grid + a "More Colours" `<details>` expander; each picker writes only its own field (`GUI_COLOR_FIELDS`, `commitGuiColor`), override pickers read back from computed style (`syncGuiColorInputs`/`toHexColor`). Selecting a preset clears overrides. Legacy invisible white header-text default migrated away (`migrateGuiColorFields`).
- **J3 — Custom themes, Import/Export, Harmony, Fonts.**
  - *Custom themes + import/export.* `theme.js` gains a custom-theme store (`ft-custom-themes`, capped at 12): `snapshotAppearance` captures the full customisable state; save/delete/`applyCustomTheme`; a "Your Themes" grid (`renderCustomThemes`) with per-swatch delete. A preset only highlights when it's the active theme. New "Save / Share theme" section: name + Save, Export theme (JSON download), Import theme (file → `parseThemeImport` validates → save + apply). Also **removed the "Dashboard labels" editor** (title/subtitle now fixed at their stored defaults) at user request.
  - *Colour Harmony generator.* `generateHarmonyBase(accent, rule, mode)` in `theme.js` — ported from Odysseus's `generateHarmonyColors()`. An accent + a harmony rule (complementary / analogous / triadic / monochromatic) auto-derives FT's **structural** base (bg / surface / text / border / accent). The finance **semantic trio** is deliberately *not* derived from the accent hue (that's the J0 bug); it uses a mode-tuned locked green/red/blue. Customize tab gains a "Colour Harmony" section; `actionApplyHarmony` writes all 8 base colours and **clears every override** like a preset click, funnelling through the one `applyGuiStylesToPage` chokepoint; `theme = 'custom'`. `migrateGuiTheme` now early-returns for a `'custom'`/saved-theme name so its inline colours survive reload.
  - *Custom-font upload.* Browser-side, offline (the one behavioural divergence from Odysseus). A `.ttf/.otf/.woff/.woff2` is base64-encoded into `localStorage` (`ft-custom-fonts`, capped at 4 / 2 MB each) and registered via the `FontFace` API (`registerCustomFont`). Uploaded fonts join the Font Family dropdown (a "Your fonts" `<optgroup>`, `populateCustomFontOptions`) and apply through the existing `commitGuiText` → `applyGuiStylesToPage` chokepoint. Stored fonts re-registered at startup (`registerStoredCustomFonts` in `main.js`). **CSP change:** added `font-src 'self' data:` (the `default-src 'self'` was blocking the `FontFace` `data:` URL).
- **J4 — Background effects.** **7** effects — **constellations / petals / rain / synapse / sparkles / embers / perlin-flow** — ported from Odysseus's canvas effects (`theme.js`: `_ft<Name>`). *(Shipped 2026-06-21 as a curated 3; synapse/sparkles/embers/perlin-flow added 2026-06-25 — see the update log.)* Each is a full-viewport `<canvas>` prepended behind the app shell (`z-index 0`; `.app-shell` lifted to `z-index 1`, `aria-hidden`); the draw loop self-terminates the moment its `body.bg-effect-<name>` class is gone. **Gated** behind `prefers-reduced-motion` **and** a small-viewport perf guard (`bgEffectsAllowed`: skip under 700px) — the stored preference is kept either way. New `guiSettings.bgEffect` (`none` default) + a "Background effect" select in Customize; `applyBackgroundEffect` is its own entry point (decorative — **not** a colour token, so it bypasses the `applyGuiStylesToPage` chokepoint), idempotent. Tint reads `--bg-effect-color` → `--accent-color` → text. Applied at startup (`main.js`). *(2026-06-25: the `.content` panel is now permanently transparent so cards float on the page background — the effect shows through the gaps on every tab.)*

**Engineering deltas vs Odysseus:**
1. **No server** — localStorage only (simplifies the sync paths).
2. **Custom fonts** — folder-scan → browser upload (`FontFace` + `localStorage`), so it works fully offline.

---

## Key fixes & architecture notes (worth keeping)

- **Theme system has two token layers.** `applyTheme(THEMES[name])` derives the *full* token set (text, border, content-bg, tints, tab colours) from a preset; `applyGuiStylesToPage()` overlays the *customisable subset* (bg/card/accent/semantic/typography). Any action that wrote only the subset left the rest on the previous theme → a recurring **"split look"** bug (dark page, light cards, invisible text). **Fix:** `applyGuiStylesToPage()` now applies the full base **first**, then the subset — one chokepoint every appearance change funnels through (load, reset, factory reset, JSON import, live preview). The swatch handler also commits the preset's per-colour values via `syncGuiSettingsFromInputs()` so the name and per-colour representations never diverge.
- **What If scope routing.** Editable scenario inputs carry `data-scope="whatif"`; the shared settings handlers write to `whatIfFinanceData` (the clone) instead of `financeData`, and skip the live re-render. Add/remove and the allocation-total are scope-aware. This is what makes What If a true sandbox.
- **Service worker is manually versioned.** Cache-first for JS/CSS means **you must bump `VERSION` in `sw.js`** on any asset change, or reloads serve stale code. (This bit us repeatedly mid-build.)
- **0.6 — salaried calc.** The tax *engine* is correct; the bug was *behavioural* (salaried discarded the user's actual net/tax). Fixed by honouring the override-when-present, estimate-when-blank rule.
- **Theme-consistency cleanup.** A family of hardcoded-colour elements that ignored the theme were tokenised along the way: stat cards, liability cards, `.btn-secondary`, the gear/edit buttons, and the `--color-warning` token.
- **Appearance redesign — motivating issues (→ Phase J).** Four problems drove the J redesign: **(1)** Net Worth painted with `--accent-color` (brand), so a *positive* net worth rendered red on Dark, orange on Copper/Light — fixed by J0 (paint signed figures by sign). **(2)** Some preset backgrounds read muddy (Dark reddish-brown, Copper flat brown, Light low-contrast) — addressed by J1's ported palettes. **(3)** The old "Customise Colours" grid was too granular (separate card-gradient stops, an invisible white-on-white header-text swatch) — replaced by J2's tight base tier + grouped "More Colors". **(4)** Heading *text* (content) sat under Typography — moved out (and the dashboard-labels editor later dropped entirely in J3).

---

## Project history (brief)

The plan evolved through several forward-looking revisions before becoming this record:
- **Rev 1–2** gated almost everything behind the sidebar (Phase A). That was backwards — the high-value/high-risk work is *logic*, not chrome.
- **Rev 3** added Phase 0 (correctness hotfixes, "do first"), Phase R (routing refactor before the data-entry move), and demoted the sidebar off the critical path.
- **Rev 4** audited Phase 0 against the source (all real), cut two "valuable-work-behind-chrome" dependencies, and added Phase T (tests before the routing churn).
- **Rev 5** reconciled the *Current and Proposed Features v2* doc: added 0.6, re-cast Phase D to per-tab modals, and added F.4 / I.7 / the allocation goals (and the What If redesign that became Phase G's Stages 0–3).
- **Rev 6** reframed the document from a forward plan into a record of what was built.
- **Rev 7 (this doc)** reformatted for readability: outstanding/deferred items pulled to the top, Phase J reconciled as shipped, and a running update log added at the end.

---

## 📓 Running update log (append new entries here)

Newest at the top. Each entry: date, what changed, why it mattered. Append a new line/section every time we make a change so this stays the single chronological record.

### 2026-06-26
- **Background effects on phones (option 2).** Lowered the effect viewport gate in `bgEffectsAllowed()` from `>= 700` to `>= 360`, so phones now run the animated backdrops (reduced-motion still disables them). Added mobile tuning helpers (`_bgIsSmall`/`_bgDpr`/`_bgScale`/`_bgCount`): below 700px the DPR is capped at 1.5 (a full-screen canvas at 3× is the expensive part) and particle density is roughly halved (rain 130→65, constellations 50→25 — also halves its O(n²) link checks — petals 30→15, synapse 20→10, sparkles 35→18, embers 60/70→30/35), keeping the rAF loops smooth and battery-friendly. `sw.js` VERSION → `2026-06-26-mobile-effects`. Verified via headless Chrome at a ~604px viewport: effect renders, 7-item bottom nav intact.
- **Card translucency.** Added a single `--card-opacity` token (now `80%`) and applied it via `color-mix` (with a solid-colour fallback) to every page card — `.card`, `.stat-card`, `.liability-card`, `.empty-action-card`, `.scenario-results`, and the What If scenario sections — so a background effect shows faintly through them. Scoped to page cards only; modal cards stay solid (no effect renders behind a modal). One knob tunes them all.
- **Appearance + dashboard UI redesign.** Dashboard: Expense Breakdown and Net Worth are now full-width "long" cards like Income Allocation; the Net Worth card was slimmed (smaller figure + tighter vertical rhythm). Settings: the cog moved out of the topbar to the foot of the sidebar nav (under What If, same modal behaviour), and the appearance modal became a real **draggable, corner-resizable window** (`position:fixed` + `setupDraggableModal` in `main.js`) instead of the flex-centred dialog that appeared to resize from all sides. Customize panel: colour swatches are a tidy 2-column layout that restacks via a **container query** on the modal body (responds to dragging the window narrower, not just the viewport); harmony preview + effect-colour swatches are round; Typography and Background effect merged into one "Font & Background" section; removed the no-op "Topbar text" picker (locked white on dark themes); appearance-modal buttons slimmed. Fixed mobile cramping/mid-word wrapping in the allocation + asset/liability grids (the ≤768px rule was forcing 70px columns; split so only the small numeric tiles stay narrow). `sw.js` VERSION bumped across the pass → `…-ui-pass-4`.
- **Perlin-flow disabled (revisit later).** The flow-field look stayed unresolved (an issue inherited from the Odysseus original), so it's removed from the `BG_EFFECTS` registry and the Customize dropdown; `_ftPerlinFlow` is kept in `theme.js` to revisit. A save still pointing at it falls back to "none". `sw.js` VERSION → `2026-06-26-disable-perlin-flow`.

### 2026-06-25
- **Perlin-flow — faithful Odysseus port (fixed the "messy" buildup).** My first port faded with `destination-out` (alpha reduction); since the flow field is near-static, hot streamlines climbed to fully-opaque additively = a fixed scribble after ~30s. A stop-gap (bounded per-particle trails) fixed the mess but the streams were too short. Final: **directly port Odysseus's fade** — paint the page background over the canvas at a low alpha each frame (`source-over`, 0.02, matching Odysseus). That's a *convex blend* toward the bg, so a streamline can never exceed the streak colour (bounded + stable, not additive). FT has no single `--bg`, so the fade colour is `--primary-bg-color-end` (cached, re-parsed on theme change) via `_bgRgba`. **Trade-off:** this effect's canvas fills to a flat bg tone instead of letting the page gradient show through (exactly how Odysseus looks) — all other effects keep the transparent/floating look. Verified via headless Chrome at ~30s: bounded, no scribble. *(Then thinned for density — particle count 200 → 130, fade 0.02 → 0.04 — so it stays the same look but less busy over time. `sw.js` VERSION → `2026-06-25-perlin-flow-less-busy`.)*
- **Effect colour picker.** Customize → Background effect gains an "Effect colour" picker + a "Match accent colour" checkbox (default on). New `guiSettings.bgEffectColor` (empty = follow accent); `applyBgEffectColor` (`theme.js`) pins/clears the `--bg-effect-color` var that every effect reads live, so the tint updates instantly on a running effect. Wired through `commitGuiEffectColor` (`events.js`), restored on form open (`uiSettings.js`) and at startup (`main.js`); bypasses the colour-token chokepoint like the rest of the decorative effect path. Bumped `sw.js` VERSION → `2026-06-25-effect-colour-picker`. Verified via headless Chrome (orange tint → `--bg-effect-color` set + warm embers; match-accent → var unset, follows accent; no JS errors).
- **Four more background effects + always-floating cards.** Ported `synapse`, `sparkles`, `embers` and `perlin-flow` from Odysseus (`C:\Users\Nebula PC\odysseus\static\js\theme.js`, registry at `_CANVAS_PATTERNS`), in FT's `_ft<Name>` + `BG_EFFECTS`/`BG_EFFECT_NAMES` style — bringing the curated set to **7**. Added small helpers `_bgRgba` (hex/rgb → rgba, for the embers glow) and `_bgNoise2d`/`_bgSmoothNoise` (perlin-flow flow field); perlin-flow/embers fade trails via `destination-out` so they stay theme-agnostic on the transparent canvas. New `<option>`s in the Customize dropdown; no whitelist to touch (the select value validates against `BG_EFFECTS`). **Floating cards made unconditional** (per user) — `.content` is now always transparent (dropped its bg/blur/shadow and the `has-bg-effect` gate + its JS toggle), so cards float on the page background on every tab regardless of effect. Bumped `sw.js` VERSION → `2026-06-25-effects-plus-floating-cards`. Verified via headless Chrome: all four new effects create their canvas with no JS errors (`canvases=1 err=[none]`).
- **Background effects show through the cards.** *(superseded same day — floating cards are now unconditional, see above.)* Initial pass dissolved the `.content` panel only while an effect was active. **What If de-nest:** the outer "Scenario Planner" wrapper became a bare grouping container (`.settings-section--group`) so its child scenario sections are the only cards — removes the boxes-on-boxes-on-boxes nesting.
- **Doc reformat (Rev 7).** Reorganised this implementation record for readability: outstanding + deferred items moved to a single section at the top; the stale "Phase J — in progress / planned / on branch" framing corrected to "shipped to `main` 2026-06-21"; the status table updated (Phase J → Done, C → Done incl. expanded copy); started this running update log.

### 2026-06-21
- **Phase J — Theme & appearance redesign shipped to `main` (J0–J4)** via PRs #9 and #10 plus the J3/J4 commits. J0 Net-Worth-by-sign fix; J1 12 ported palettes with locked semantic trio; J2 two-tab Themes|Customize panel + derive-from-base Customize surface; J3 custom themes + import/export, Colour Harmony generator, offline custom-font upload (`font-src 'self' data:` CSP change); J4 curated background effects (constellations/petals/rain). Locked with user the same day.
- **Mobile usability — round 2 (on-device).** Universal currency auto-fit (`fitAllAmounts()`); single-column allocation cards on phones; inline `<details>` info disclosures replacing off-screen tooltips; compact colour-dot save status on phones.
- **Mobile usability — round 1 (on-device iPhone 13 Pro).** iOS focus-zoom fix (16px controls); stacked data-entry rows (drop the 720px floor); `.app-shell` `minmax(0, 1fr)` so pages fit the viewport.
- **Phase A — mobile bottom-nav** (CSS-only, under 640px).
- **Service worker** — fall back to cached app shell on a non-OK navigation response.

### 2026-06-20
- **Rev 6** — rewrote the plan as an accurate implementation record.
- **Phase C** — enriched info-panel copy for all five tabs.
- **Audit** — theme-consistency fixes + removed dead What If code.
- **Phase G** — deferred G.5; marked Phase G + the plan complete.
