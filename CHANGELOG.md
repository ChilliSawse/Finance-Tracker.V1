# Changelog — finance-tracker

Reconstructed from git history by Build 15c. Entries before 2026-11-17 were not written at the time; they are grouped by month (Build 13 is the only build tag in the history). The first version is 1.0.0, a reconstruction anchor only: `package.json` was first added on 2026-07-07 (commit 9be0163), so the earlier entries predate any version file. Later groups add one minor version each, and from 2.0.0 each release is written at the time. The top entry is 2.0.0 and `package.json` says the same.

## [2.1.0] — 2026-11-23

Ledger now draws its sorting rules, asset types, tax figures and saving methods from one shared list on its own site, and keeps a built-in copy so it works offline from the first open.

### Sorting
- Bank descriptions are read more reliably, and short shop names no longer match inside other words
- Over 400 Australian shops are recognised; their matches show as suggested for you to confirm
- Correcting a category offers to remember that shop for next time, with Undo
- Rows that look like a transfer (your own accounts, investments, super) show "Looks like a transfer — confirm?" in To review, and count as spending until you confirm
- Settings lists the shared sorting rules, with a switch to turn them off and a way to go back to the previous list

### Assets and net worth
- Each asset suggests its kind, with realistic growth or resale curves (cars adjusted by fuel type)
- Property has "Do you live here?"; each loan has "This loan is for" to link it to a property
- Net worth is one figure everywhere and includes HELP
- Financial independence leaves out your home and its loan, counts super from 60, and leaves out anything not yet confirmed; "Confirm all the sure ones" on Plan confirms the safe ones in one tap
- Money in an offset account counts as cash

### Tax
- Tax figures come from the shared list, checked against legal ranges, with the built-in ATO tables kept as the fallback
- New question: "Do you have private hospital cover?" Answering No adds the Medicare levy surcharge to the year-end estimate when your income is over the threshold
- From 2026-27 the year-end estimate takes off the $1,000 standard deduction on work income (shown as an estimate); take-home pay is unchanged
- The $250 Working Australians Tax Offset is ready for 2027-28 and turns on once that year's figures are law
- A note warns when your employer super is over the yearly concessional cap

### Saving methods
- Plan's Change opens a Saving model sheet; its button says what it does ("Make it mine", "Switch back") and Undo replaces the second question
- The Bucket method is the only method offered for now

## [2.0.0] — 2026-11-22

The phase 1 rebuild of Ledger. Almost every screen is new, and your saved data moves across by itself.

### New look and screens
- Five screens built around a pay cycle: Today, Activity, Plan, Future and What If, with a "?" help sheet on each
- Four colour themes, each with light and dark, plus Auto, and a text size setting
- Today shows where you are this pay: what is left, what is coming up, a monthly review card when a new month's review is ready, and your tax position in any month
- Activity lists your transactions by pay cycle, with quick-add, search, learned categories and duplicate merging
- Plan holds your income, bills, expenses, debts, assets and categories, with the bucket plan and the monthly review
- Future shows your net worth path over 10, 20 or 30 years, how long until financial independence, and a goal planner
- What If lets you try changes (a pay rise, a new job, extra income, a bigger expense, a goal) and compare them with your plan, then make one real with a single tap
- Bills now follow their real due dates everywhere they appear
- Setup is a full-screen walk-through, with a welcome that lets you explore with sample data first
- Settings is a screen of its own with search, covering your data, appearance and more

### Bucket method
- Split each pay into buckets such as Daily, Splurge, Smile, Fire and Mojo, with suggested splits and per-bucket "left this pay"
- Fire works down your targets in order, smallest debt first, then Mojo, a home deposit and super
- Mojo has a step ladder, and Smile goals show whether they are on track, late or out of reach
- Each category can sit in a bucket, and transfers are ticked off as you make them
- A monthly review covers spending, bucket movements, target progress and transfers

### Pay and tax
- Tax withheld is worked out from the ATO tables for each income year, including HELP
- Annual tax, the low income tax offset and your likely refund or bill are shown
- Salary and set-hours layouts, with questions about tax-free threshold, study debt and extra withholding
- Check a payslip against what was expected, with the likely cause of any difference and one-tap fixes

### Import
- Bank CSV files, Excel statements (no extra software needed), PDF statements and payslips
- Imports are checked and limited in size, with a preview, a commit and an undo
- Merchants you correct once are remembered, and similar rows can follow

### Assets and debts
- Each asset and debt has its own sheet with balances, rates, repayments and a projection
- Debts feed your Fire targets and your net worth path

### Safety and backups
- Back up and restore everything in one file: settings, transactions, events and saved What If scenarios
- Before any restore, a safety copy is kept, and a failed restore rolls everything back
- Undo a restore from two places
- A recovery screen appears if your saved data cannot be read, so you can export what is readable, import a backup or reset
- Erase all data now really clears everything, after one confirmation
- Tighter handling of backup and statement files, plus stricter page security rules

### Speed
- The first load is about 176 KB, helped by loading each screen only when you first open it, a smaller font file and fewer startup requests
- The PDF reader is bundled, so statement import works offline

### Removed
- Custom tax brackets, the tax-year picker and the bracket editor (tax now comes from the built-in tables)
- The old dashboard, income, expenses, savings and liabilities panels
- The old settings modals and allocation modal
- "Save as My Defaults" and Reset Appearance (Back up and Restore replace them)
- The old custom theme and colour tools

### Fixed
- Savings rate and Fire figures on Today, a doubled percentage on the Mojo tile, and singular and plural wording
- Toasts no longer appear over an open sheet
- A tab icon, a Today flash on first run, and several phone and desktop layout defects
- Plan and Settings use a wider column on desktop

### For developers
- The tests now gate the deploy
- Data migrates automatically from v1; the `financeTrackerData_v2` key is kept
- Storage is IndexedDB `ledger-db` v2 plus `ledger-safety-db`

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
