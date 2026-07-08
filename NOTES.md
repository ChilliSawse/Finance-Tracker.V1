# Ledger Rebuild — Working Notes

Checkpoint file for the Finance-Tracker.V1 → Ledger production rebuild. Records decisions,
gotchas, and architectural notes as the work proceeds. Newest log entries at the top.
This file is a dev artifact — exclude from `dist/`.

## Locked decisions (confirmed with owner, 2026-07-07)

1. **Repo**: rebuild in place on the `ledger-rebuild` branch (base: `9480eea` on `main`).
2. **Rebrand**: UI/manifest/docs become **Ledger**; localStorage keys stay unchanged
   (`financeTrackerData_v2`, `ft-*`) — the owner's real data lives on another device's PWA
   and will run our migrations when the deploy updates, so shape migrations must be safe.
3. **Tax data**: ship 2025–26 ATO resident brackets (16/30/37/45, 45% above $190k),
   Medicare levy (2% + low-income phase-in), and the HELP/HECS repayment table.
   Engine math (calculateTaxFromBrackets) unchanged.
4. **Backup**: no desktop backup needed — no real data in any browser on this machine.
5. **Categories**: AU default set (~12) **plus** a category manager UI (add/rename/merge,
   editable keyword rules) shipping in v1.
6. **Licence**: deferred. No LICENSE file; README carries a "licence TBD" note until the
   owner decides before the public push.
7. **i18n**: foundation only — strings extracted to `en.json` during the copy rewrite,
   `Intl` for currency/dates. English only ships.
8. **Browsers**: latest-only target. Free to use modern platform features.

## Constraints (from the brief — non-negotiable)

- No framework rewrite. Vanilla JS + a build step (Vite).
- Theme engine preserved: `applyGuiStylesToPage` → `applyTheme`/`deriveTokens` chokepoint,
  FOUC inline `<head>` script + `ft-theme-fouc` cache. Treat as fragile; verify themes
  visually after any refactor that touches load order.
- What If sandbox (`whatIfFinanceData` clone + `data-scope="whatif"` routing) is the
  reference architecture — model CSV import (parse → preview → explicit commit) on it.
- `tests.html` must pass after every significant change.
- SW cache list ↔ asset paths must stay in sync until the generated-SW build replaces it.
- `graphify-out/`, `launch.bat`, `NOTES.md`, `*.md` dev docs never ship in `dist/`.

## Brief-vs-code corrections (verified 2026-07-07)

- No Medicare/HELP data exists anywhere in the code; default brackets are pre-2024
  (0/19/32.5/37, no 45% band). Bracket *math* is correct + tested; *data* is stale.
- Actual file map: `uiDashboard.js` (render), `state.js` (data + FinanceAutoSave),
  `theme.js` (engine/fonts/effects), `uiSettings.js` (settings forms + chokepoint),
  `events.js` (all delegated handlers). No ui.js/autoSave.js/gui.js/whatIf.js/TESTS.md.
- Auto-save is already debounced (2.5 s); the per-keystroke cost is the full re-render.
- Graph INFERRED edges spot-checked and correct (setupEventListeners →
  handleGuiSettingsClickEvents / handleCustomFontUpload; events.js:63,116 at base commit).

## localStorage keys in use (do not rename)

`financeTrackerData_v2`, `ft-theme-fouc`, `ft-custom-themes`, `ft-custom-fonts`,
`ft-user-defaults`, `ft-active-tab`, `ft-sidebar-collapsed`, `ft-info-collapsed`.

## Log

### 2026-07-08 — Second pass: nine UX bugs from on-device + desktop review
- **"/ear" annual label**: `viewPeriod.replace('ly','').replace('y','')` — string
  surgery that worked for four periods and mangled the fifth ("yearly"→"year"→"ear",
  with a `dai`→`day` patch hiding the same bug in daily). Lesson: period→label is a
  lookup, not arithmetic; whatif.js had the correct map all along — now shared style.
- **iOS tap drops**: taps with a few px of wobble never emit `click` (Safari
  reclassifies as scroll), and quick taps can hit double-tap-zoom heuristics.
  Tabs now fire on guarded `pointerup` (move <12px, hold <700ms, touch/pen only),
  `click` retained for mouse/keyboard with a 400ms timestamp dedupe — showTab is
  idempotent so a rare double-fire is harmless. `touch-action: manipulation` on all
  nav controls. If misses persist on-device, next suspect is Safari's
  bottom-toolbar tap-through zone (Safari-tab mode only, not PWA).
- **inlineConfirm off-screen**: fixed-position popovers need BOTH axes clamped and
  their text wrappable; `white-space: nowrap` on a message = popover wider than a
  phone. Flip-above-when-no-room-below + viewport clamp + wrap.
- **revealNewRow()** (subagent): every add-row path scrolls the new row into view;
  two traps — tax brackets re-sort by min (new row lands at index ≠ last) and
  categories splice before the trailing "other". Focus only on fine pointers (iOS
  keyboard would bury the reveal). `block:'nearest'` so short lists don't jump.
- **iOS date inputs**: unshrinkable UA width — need `appearance:none` +
  `max-width:100%` + wrapper `min-width:0`; `min-height` guards the empty-value
  collapse; `::-webkit-date-and-time-value { text-align:left }` un-centres.
- **Notch**: `viewport-fit=cover` + `env(safe-area-inset-top)` on the topbar +
  `html { background: var(--primary-bg-color-start) }` (letterbox/overscroll paint).
  Works standalone AND Safari-tab (theme-color meta already handled Safari chrome).
- **≤768px regression (own goal from pass 1)**: removing forced-64px left the
  sidebar at 240px on narrow windows → allocation buckets overlapped. Fix keeps the
  tap-expand: matchMedia('(max-width:768px)') starts collapsed at narrow widths,
  stored pref only applies ≥769px, hamburger choice still persists. Allocation grid
  hardened separately: 150px auto-fit floor, `overflow:hidden` on .savings-item
  (never paint over a neighbour), single column ≤768px.
- **UA-default cleanup**: number spinners hidden app-wide (owner chose hide over
  custom steppers); select chevrons are CSS gradients because the strict CSP blocks
  `data:` images (img-src falls back to default-src 'self'); checkbox/radio via
  `accent-color`; thin themed scrollbars; global themed `:focus-visible`.
- **Graphify now native on host** (py 3.14, `pip install graphifyy openai`,
  OLLAMA_BASE_URL needs the /v1 suffix). Graph @ c53933a: 322 nodes / 937 edges /
  33 communities. `graphify claude install` wrote CLAUDE.md (now carries an
  architecture map) + PreToolUse hooks in .claude/ (gitignored).
- **Verified**: tests 122/122, build clean, functional pass at 375/393/700/1280px.
  Issue #9 audited at code level only (per brief — no screenshot verification).

### 2026-07-08 — Mobile compatibility pass (dead JS on Pages, bottom bar, tablet)
- **Root cause of "tapping any tab does nothing" on the phone** — not CSS, not the
  click delegation. GitHub Pages serves the repo as `build_type: legacy` (branch
  `main`, path `/` — raw source, no Vite build; deploy.yml was excluded from the
  push because the PAT lacked `workflow` scope, and Pages was never flipped to
  Actions). Under raw ESM the static `import 'virtual:pwa-register'` (Vite-only,
  the app's ONLY non-relative import) fails → the entire module graph dies → zero
  JS runs → static Home panel, dead tabs. Desktop "worked" because `npm run dev`
  resolves the virtual module. Fix: `src/pwa.js` imports it dynamically with a
  `.catch` — raw hosting skips SW setup, dev/build behave exactly as before
  (verified: dist build emits the pwa-register chunk and the SW registers).
- **Bottom bar (≤640px)**: was 9 items at ~37px wide / 0.58rem labels. Now 5
  slots — Home, Dashboard, Income, Expenses, More (68.8×53 at 375px, 74.8 at 390,
  79.6 at 414 — all past the 44×44 floor, labels 0.68rem). Savings, Liabilities,
  the Tools label, Import CSV, What If? and Settings live in a **More sheet**:
  the SAME tablist DOM, no duplication — the new `.nav-overflow` wrapper is
  `display: contents` on desktop/tablet (invisible to layout) and an absolute
  panel above the bar on phones. `#nav-more-btn` (not `.tab`, so tablist
  delegation/keyboard nav ignore it) toggles `.more-open` + `aria-expanded`;
  the sheet closes on item select, outside tap, and Escape
  (`setupMobileNavOverflow` in `src/ui/tabs.js`). When the active tab lives in
  the sheet, `.sidebar:has(.nav-overflow .tab.active) .tab-more` puts the accent
  on More so the current section is always locatable.
- **Tablet (641–768px)**: deleted the forced 64px + `:hover`/`:focus-within`
  expansion (hover never fires on touch — users were locked out of labels).
  The topbar hamburger (`#sidebar-toggle`, bumped to 44×44 here) now toggles
  `.is-collapsed` at this width exactly like desktop: tap → 240px with labels,
  tap → 64px icon-only. Persisted + `aria-expanded` as before.
- **Verified** (Playwright): 375/390/414 — all 7 tabs + Import CSV + Settings
  reachable, panels switch, modals open, sheet closes; 768 — toggle works both
  ways; 1280 — desktop sidebar pixel-faithful (order, Tools label, active
  highlight, no More button). tests.html **122/122 in dev AND built dist**. Raw
  static serve of the repo root (Pages simulation) boots and navigates. Theme
  files, tax engine, safe-area insets untouched.
- **Subagents deliberately skipped** for the three sub-fixes: they all edit the
  same `style.css` media blocks + the same nav DOM — parallel agents in one
  working tree would collide; done as one coherent change instead.
- **Deployment debt — RESOLVED same day (owner-approved follow-up)**: owner ran
  `gh auth refresh -s workflow` (device flow) to lift the PAT scope wall;
  deploy.yml committed (7927c8c) and pushed; Pages `build_type` flipped
  legacy→workflow via `gh api -X PUT repos/.../pages -f build_type=workflow`
  (no UI needed). First Actions run green; live site verified serving built
  dist: hashed assets, manifest/sw.js/icons all 200, SW registered at
  /Finance-Tracker.V1/ scope, nav verified at 375px. Deploys are now just
  "push to main". The pwa.js dynamic-import guard stays — harmless under the
  build and protects against any future fall-back to raw serving.

### 2026-07-07 — Phase 5: rebrand, README, deploy workflow
- Rebrand to **Ledger**: title/manifest/topbar + defaults; loadData migrates the
  old default heading strings in place (heading editor was removed pre-Ledger,
  so every save carries the default — safe). localStorage keys unchanged.
- README.md (licence: TBD note per owner decision), GitHub Pages workflow
  (.github/workflows/deploy.yml — needs Pages source set to "GitHub Actions").

### 2026-07-07 — Phase 4: sunrise theme, onboarding + sample data, i18n, delight
- 'Sunrise' preset = fresh-install default; prefers-color-scheme dark → midnight
  (first run only). style.css :root fallbacks + defaultGuiSettings mirror it.
- Onboarding modal (guided setup / sample household / skip); sample data =
  Alex & Sam config + 80 deterministic transactions (batch `ledger-sample-data`,
  removed by factory reset). Toasts + milestone celebration pulse. Quota-full
  saves explain themselves once per session.
- **i18n foundation**: src/i18n/en.js catalogue + t() interpolation.
  MIGRATED: feed, pulse, upcoming bills + due labels, toasts, onboarding
  summary, entire CSV import flow, spending-card strings.
  STILL INLINE (migration inventory): index.html long-form guide copy +
  static labels; pre-Ledger alerts in settings-events/import-export/confirm;
  render-tabs legacy card strings (savings messages, FI stats, HELP card,
  year-so-far lines); autosave status pills. Pattern established — migrate
  opportunistically when touching those files.

### 2026-07-07 — Phase 3: feed, import, bills, envelopes, HELP, analytics
- Home tab (default): greeting + insight line, 3 pulse tiles w/ sparklines,
  "Coming up" bills card, activity feed (timeline spine, typed dots, clusters).
- Event log renders {type,data} facts → copy at render time. Snapshots
  (ft-snapshots, daily, 730 cap) feed sparklines; milestones (ft-milestones)
  celebrate crossings one-shot with re-arm.
- CSV import: engine in src/import/csv.js (subagent-built, 21 cases) + sandbox
  UI (detect → map → preview w/ per-row line errors → commit → undo). Mappings
  remembered per file shape (ft-csv-mappings). Dedupe via normalised hash.
- Bills (reminders only — never in expense totals; roll forward at boot;
  ft-bill-notified dedupes feed events). Envelopes (category.monthlyBudget vs
  spend-cache actuals). Category manager (income/other locked). Tax details UI
  (FY loads official brackets; Medicare/HELP toggles). HELP payoff card.
  Spending-this-month + year-so-far dashboard cards. CSV transactions export.
- **Testing gotcha (Playwright)**: dynamic `import()` of app modules in
  page.evaluate gets a SEPARATE Vite module instance — store reads/writes
  diverge from the app's. Interact via DOM; only IDB-backed modules are safe
  to import directly (shared storage).

### 2026-07-07 — Phase 2: data model (tax tables, categories, bills, IndexedDB stores)
- **`src/calc/tax-au.js`** — verified AU tax reference data (sources checked 2026-07-07):
  2026–27 + 2025–26 resident brackets (2026–27 has the legislated 16%→15% cut);
  Medicare levy 2% with the $28,011 single low-income threshold + 10c/$ shade-in;
  HELP **marginal** repayment system ($69,528 threshold, 15% to $129,717, 17% above,
  capped at 10% of repayment income); `projectHelpPayoff` year-by-year schedule
  (indexation-before-repayment ordering, default 2.8% = the 1 June 2026 rate).
  Documented limitations: single resident, no LITO/offsets/MLS/family thresholds.
- **calculateTotals estimate path** — optional `taxSettings` adds Medicare per
  estimated source + HELP on the primary source only. Absent/off = brackets only
  (all pre-existing tests unaffected). Payslip overrides still always win.
- **Defaults + migration** — fresh installs: 2026–27 brackets, Medicare ON.
  `migrateLedgerFields`: normalises bracket max null→Infinity (kills the "null"
  input warning; root cause was JSON-cloning Infinity — clone functions now use
  structuredClone), upgrades an UNTOUCHED legacy default bracket set to 2026–27
  (customised brackets never touched), backfills taxSettings (Medicare OFF for
  existing saves so their numbers don't shift silently), categories, bills.
- **Categories** (`src/state/categories.js`) — 13 AU defaults with merchant
  keywords (`categoriseDescription`: first match in array order; 'uber trip' vs
  'uber eats' disambiguation works). `monthlyBudget` field = envelope cap.
- **IndexedDB** (`ledger-db` v1): `db.js` (tiny promise wrapper, `configureDb()`
  test hook → tests use a throwaway DB), `transactions.js` (cents integers,
  normalised-hash dedupe so overlapping CSV re-imports are safe, import-batch
  undo, month spend-by-category), `eventlog.js` (activity events as {type, data}
  facts — copy rendered later, i18n-ready; monotonic `seq` ordering because ISO
  timestamps collide within a millisecond; 500-event prune).
  **Convention: financeData = dollars (legacy), IndexedDB stores = integer cents.**
- **tests.html: 23 → 65 assertions**, all green in dev + dist (async IIFE now;
  IDB tests isolated via configureDb + deleteDb). Verified in-app: fresh install
  $80k gross → net **A$63,880** (brackets+Medicare); legacy-save migration →
  brackets upgraded, Medicare off, net A$65,480; categories/bills backfilled.

### 2026-07-07 — Phase 1: build pipeline + ES modules + scoped rendering
- **Vite 8 + vite-plugin-pwa** (`npm run dev/build/preview`). `base: './'` for GitHub
  Pages subpaths. `manifest.json` + `icons/` moved to `public/`. Two build entries:
  `index.html` + `tests.html` (harness ships in dist for in-place verification).
- **Generated service worker** (Workbox generateSW, `registerType: 'prompt'`) replaces
  the manually-versioned `sw.js`. The "Update Now" banner UX is preserved in `src/pwa.js`
  via `registerSW({ onNeedRefresh })`. No more manual VERSION bumps, ever.
- **ES module conversion**, `js/*` → `src/`: `state/` (defaults, store, migrations,
  autosave), `calc/calculations.js` (pure — no store/DOM; tests import it directly),
  `theme/theme.js` (mechanical conversion: sed `guiSettingsData` → `store.guiSettingsData`
  + one export block; logic byte-identical), `theme/appearance.js` (form + all GUI events
  + the applyGuiStylesToPage chokepoint in one module), `ui/` (render-tabs, render,
  settings-forms, whatif, tabs, modals, confirm), `events/` (settings-events,
  import-export, setup), `pwa.js`, `main.js`. events.js god node split across
  settings-events / whatif / appearance / import-export / setup.
- **Scoped rendering** (`ui/render.js`): `updateDataAndUI()` keeps its name but now
  marks all tabs dirty and re-renders ONLY the visible one; `showTab` re-renders a
  dirty tab on reveal. The old `dataChanged` CustomEvent + render-all-6-tabs path is
  gone. Expense search refreshes just the Expenses tab.
- **calculateTotals signature**: no longer defaults to global financeData — all callers
  pass data explicitly (renderLiabilitiesSettings was the one no-arg caller; fixed).
- **launch.bat** now runs `npm run dev` (the old raw static server can't resolve module
  imports like `virtual:pwa-register`).
- **Verified** (Playwright, dev + built dist): tests.html 23/23 in both; all 6 tabs
  activate; income edit $80k gross → net A$63,533 (bracket math exact) with scoped
  re-render; What If seeds + Calculate renders the simulated dashboard (6 cards);
  Light + Terminal + midnight presets apply with correct tokens + FOUC cache; generated
  sw.js registers from dist; zero console errors.
- **Known pre-existing quirk** (not a regression): tax-bracket "max" renders the string
  "null" into a number input when a save round-tripped Infinity→null (browser warning,
  input shows empty). Fix opportunistically in Phase 2's tax work.
- **Gotcha for later**: index.html CSP is `script-src 'self' 'nonce-ft-fouc-init'` — the
  static nonce is security theatre but harmless; Vite dev + build both work under it.
  The FOUC inline script must keep its nonce if the CSP stays.
