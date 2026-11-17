# Ledger

**Your money, telling its story.** A warm, offline-first personal finance tracker — built for Australians, private by design.

Ledger opens on an activity feed, not a spreadsheet: *"You imported 47 transactions from CBA." "Net worth crossed $50,000." "Car insurance is due in 3 days."* Behind it sits a correct Australian tax engine, bank CSV import, budget envelopes, and a scenario sandbox — all running entirely in your browser. Nothing you enter ever leaves your device.

**Project:** finance-tracker · **Part:** finance-tracker · **System page:** none (no system page covers this project)

Version 1.3.0 (`package.json`, name `ledger`). Changes by version are in [`CHANGELOG.md`](CHANGELOG.md).

## Features

**The story**
- **Activity feed** — a timeline of what's happening with your money: imports, milestones, upcoming bills, savings-rate wins, told in plain language
- **Pulse tiles** — net worth, savings rate and fortnightly leftover at a glance, with 30-day trend sparklines
- **Celebrations** — crossing $10k of net worth or a savings-rate threshold gets noticed

**The engine**
- **Australian tax, done right** — current-FY resident brackets (2026–27, with the legislated 16→15% cut), Medicare levy with the low-income shade-in, and the new marginal HELP/HECS repayment system, including a year-by-year **payoff projection**
- **Bank CSV import** — drag in an export from any Australian bank (CBA/NAB/Westpac/ANZ formats auto-detected), map columns once, and transactions auto-categorise by merchant keywords. Row-level errors tell you exactly which line failed and why. Fully client-side.
- **Budget envelopes** — set monthly caps per category and watch real burn from imported transactions
- **Recurring bills** — reminders that surface on the feed before they're due (never double-counted into expense totals)
- **What If sandbox** — model a pay rise, a new loan, or a spending cut against a full simulated dashboard, without touching your real data
- **FI/RE projection** — savings rate + compound growth → years to financial independence
- **Year so far** — earned, spent, biggest category, and net worth delta since 1 January

**The experience**
- **Offline-first PWA** — installable, works with no connection, service worker generated per-build
- **First-run onboarding** — guided setup or a complete sample household (Alex & Sam, 80 transactions) to explore risk-free
- **Theme engine** — 13 presets from warm *Sunrise* (default) to *Terminal* and *Midnight*, plus a colour-harmony generator, custom themes with import/export, and custom font upload. Honours your system's dark-mode preference on first run.
- **Accessible** — keyboard navigation throughout, ARIA tab/dialog patterns, reduced-motion support
- **Your data is yours** — JSON backup/restore, CSV export, no server, no analytics, no accounts

## Getting started

**Use it:** open the deployed app, or:

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
npm run preview  # serve the production build locally
```

Deploy `dist/` to any static host. A GitHub Pages workflow is included (`.github/workflows/deploy.yml`) — enable Pages (Source: GitHub Actions) and push to the default branch.

**Verify the maths:** open `/tests.html` (dev or built) — the calculation test harness runs its assertions against the tax engine, HELP projections, CSV parser, and stores in your own browser.

## Privacy

Everything is stored locally: settings and finances in `localStorage`, imported transactions and the activity log in IndexedDB. CSV files are parsed in the page and never uploaded. There is no backend, no telemetry, and no account. The one outside fetch is the PDF statement import, which loads the PDF.js library from a public CDN the first time it is used (`src/import/pdfjs-loader.js`); the PDF itself stays on your device.

## Tech

Vanilla JavaScript (no framework), ES modules, Vite build, Workbox-generated service worker, IndexedDB + localStorage. Charts are hand-rolled inline SVG. ~0 runtime dependencies.

## Notes for tinkerers

- Tax reference data lives in `src/calc/tax-au.js` (brackets, Medicare, HELP tables per financial year) — the engine itself is generic and user-editable in-app
- The two-layer theme token system (`applyGuiStylesToPage` → `deriveTokens`) drives every colour; new UI must use tokens, never hex
- The What If sandbox pattern (`data-scope` routing onto a cloned state) is the house style for any feature that previews before committing — CSV import follows it
- The planning notes, decisions log and implementation record are no longer in this repo (removed in the 2026-10-17 clean-up); `CLAUDE.md` holds the architecture notes for working on the code

## Codemap

| Path | What it does |
|---|---|
| `index.html`, `style.css`, `tests.html` | The page, the styles, and the calculation test harness (a second built page) |
| `src/main.js` | Start-up, in a fixed order: load data, theme, settings forms, events, render, restore the tab |
| `src/state/` | The store, autosave, IndexedDB access (`db.js`, `transactions.js`, `eventlog.js`), migrations, defaults and sample data |
| `src/calc/` | Pure, DOM-free maths: `tax-au.js` (Australian brackets, Medicare, HELP), `calculations.js`, `income-events.js` |
| `src/import/` | Bank CSV import (`csv.js`, `import-ui.js`) and PDF statement and payslip import (`pdf-*.js`, `payslip.js`) |
| `src/events/` | Delegated event handlers: tabs and setup, settings, import and export |
| `src/ui/` | Rendering by tab (`render.js`, `render-tabs.js`), the activity feed, What If, modals, onboarding |
| `src/theme/` | The theme engine (`theme.js`, `appearance.js`) |
| `src/i18n/` | The string catalogue and `t()` |
| `src/pwa.js`, `vite.config.js`, `public/` | The offline service worker, build config, manifest and icons |
| `.github/workflows/deploy.yml` | Builds `dist/` and publishes it to GitHub Pages on a push to `main` |

## Invariants

What must stay true (each is spelled out in `CLAUDE.md`; there is no vault ruling behind them):

- **No framework and no backend.** Vanilla JavaScript and ES modules; everything stays on the device.
- **Saved-data keys never change**: `financeTrackerData_v2` and the `ft-*` localStorage keys, because real saves depend on them (`src/state/autosave.js`).
- **Money is stored in integer cents** (`src/state/transactions.js`).
- **The tax maths is verified**: do not touch `src/calc/tax-au.js` without running `tests.html`, which must stay green.
- **Colours come from theme tokens**, never hex values in new UI.
- **New user-facing strings go in the catalogue** (`src/i18n/en.js`).
- **The PWA import is guarded** so unbuilt, raw hosting still boots (`src/pwa.js`).
- **Nothing private in this repo**: it is public on GitHub.

## Licence

TBD — all rights reserved until a licence is chosen. If you'd like to use Ledger beyond personal evaluation in the meantime, open an issue.

Changes by version: see [`CHANGELOG.md`](CHANGELOG.md).
