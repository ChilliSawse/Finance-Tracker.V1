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
