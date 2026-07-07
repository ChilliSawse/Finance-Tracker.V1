# Ledger

**Your money, telling its story.** A warm, offline-first personal finance tracker — built for Australians, private by design.

Ledger opens on an activity feed, not a spreadsheet: *"You imported 47 transactions from CBA." "Net worth crossed $50,000." "Car insurance is due in 3 days."* Behind it sits a correct Australian tax engine, bank CSV import, budget envelopes, and a scenario sandbox — all running entirely in your browser. Nothing you enter ever leaves your device.

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

**Verify the maths:** open `/tests.html` (dev or built) — the calculation test harness runs 122 assertions against the tax engine, HELP projections, CSV parser, and stores in your own browser.

## Privacy

Everything is stored locally: settings and finances in `localStorage`, imported transactions and the activity log in IndexedDB. CSV files are parsed in the page and never uploaded. There is no backend, no telemetry, and no account.

## Tech

Vanilla JavaScript (no framework), ES modules, Vite build, Workbox-generated service worker, IndexedDB + localStorage. Charts are hand-rolled inline SVG. ~0 runtime dependencies.

## Notes for tinkerers

- Tax reference data lives in `src/calc/tax-au.js` (brackets, Medicare, HELP tables per financial year) — the engine itself is generic and user-editable in-app
- The two-layer theme token system (`applyGuiStylesToPage` → `deriveTokens`) drives every colour; new UI must use tokens, never hex
- The What If sandbox pattern (`data-scope` routing onto a cloned state) is the house style for any feature that previews before committing — CSV import follows it
- Dev docs: `NOTES.md` (decisions log), `Implementation-Record.md` (pre-rebuild history)

## Licence

TBD — all rights reserved until a licence is chosen. If you'd like to use Ledger beyond personal evaluation in the meantime, open an issue.
