# Changelog — finance-tracker

Reconstructed from git history by Build 15c. Entries before 2026-11-17 were not written at the time; they are grouped by month (Build 13 is the only build tag in the history). The first version is 1.0.0, the version `package.json` carried from the start; later groups add one minor version each, so the top entry is 1.3.0 and `package.json` now says the same.

## [1.3.0] — 2026-10-17

### Removed
- The planning and notes documents, now kept in the vault (Build 13, cfcd56c)

## [1.2.0] — 2026-07-13

_Earlier work: 2026-07._

### Added
- The Ledger rebuild on Vite with ES modules and scoped rendering, then the Australian tax tables, categories, bills and IndexedDB stores (9be0163, 29e45cd)
- The home activity feed, trend sparklines, and bank CSV import with map, preview, commit and undo (b293301, dd7a3db)
- Bills, budget envelopes, the HELP payoff projection, year so far, a category manager and CSV export (a5f5a78)
- The Sunrise default theme, first-run onboarding with a sample household, and the string catalogue (72d176f, 6973c00)
- The Ledger rebrand, README and the GitHub Pages deploy workflow (bc1d722, 7927c8c)
- Variable income for irregular earners, and PDF statement import (03bbcdf)

### Fixed
- Navigation that works at every screen width, and a second pass of nine phone and desktop bugs (2cc1e44, 5e2a2a2)

## [1.1.0] — 2026-06-26

_Earlier work: 2026-06._

### Added
- The mobile bottom navigation, a two-tab appearance panel with 12 ported palettes, custom themes with import and export, a colour-harmony generator, custom font upload and background effects (ca77219, a13a737, 867812b, 04ea487, acb2144, 80ec500, d61e6dc)
- The What If scenario sandbox, built up in stages with a simulated dashboard and change badges (0f1108a, 1584f78, fc1c8b1, 9c7a787)
- The dashboard expense breakdown and welcome empty state, the Savings assets cards, the income summary and the allocation explainer (1c0c8d9, 2a776dc, b9286da, 5593451)

### Changed
- The security, accessibility, theme-system and validation phases, the sidebar app shell with a settings modal, and a visual polish pass (f7d838d, 200d38e, 9e78139, d01f71b)
- All interface emojis replaced by tab-style icons (bf17189)

### Fixed
- The savings rate, saved user defaults, tax brackets and income types, and the migration of old income sources (7d41ba8, 8825688)
- Service worker versioning so changed files really load, and the cached app shell on a failed navigation (8288f3c, 55d8413)
- Phone usability for forms and layout, and figures that now fit their cards (c6f8d9f, 0add579, de79461)

### Removed
- The old Rev 2 implementation plan (db83df5)

## [1.0.0] — 2025-05-31

_Earlier work: 2025-05._

### Added
- The first Finance Tracker web app with automatic updates (cd50a30)

### Fixed
- The FI tracker now reflects data added in settings, and downloads from GitHub work with relative directories (ffb1d2b, 47cf5d8)
