# P3b: first-use binding and per-screen CSS (FT-R-104)

Cuts the first-load download. Target set by the owner: about 180 KB gzip.

## What changed
- `src/lazy-setup.js` (new): `lazyFeature(load, setup)` loads a feature and runs its setup once, however often it is asked. Used for the Settings screen, the CSV/Excel and PDF import flows, and Setup (onboarding).
- `main.js` no longer imports or binds `setupSettingsScreen`, `setupImport`, `setupPdfImport`, `setupOnboarding`. Settings builds on first open (`events/setup.js` calls `openSettingsLazy`). The Import statement button opens the file chooser at once and loads the flows while it is open (`import/import-entry.js`). Setup loads for a first run (`needsFirstRunSetup`), for the Today checklist buttons and for Settings > Run setup again (`bindSetupEntryPoints`), which repeats the action after loading.
- `ft-onboarded` helpers moved to `ui/setup/onboarded.js`; checklist row pickers to `ui/setup/rows.js` (re-exported from steps-money.js); the sample-data flag to `state/sample-flag.js` (re-exported from sample-data.js). Today's checklist no longer pulls Setup, plan lists or the sample household builder.
- import-ui.js and pdf-ui.js load Activity at call time (`openActivityToReview`).
- CSS moved out of main.js into the lazy modules: future, plan, plan-buckets, activity, review, quick-add, income-layout, scenario, results, answer-top, setup. The What If views (`results.js`, `answer-top.js`) register from `future/index.js`. `setup.css` split: the checklist, link and tag rules are in `setup/checklist.css`, loaded with Today's checklist.
- `tools/css-hook.mjs` and `tools/run-cases.mjs`: Node loads `.css` imports as empty modules so the pure tests can import those modules.

## Tests
- `src/lazy-setup.test-cases.js`: 7 pure cases (once-only setup, failed load retried, Settings, Import, checklist click, Run setup again, first-run decision) and 1 browser case (real Setup welcome opens for a new user).
- `tools/z1-firstuse.mjs` (built app): first run opens Setup, Explore with sample data, Import statement chooser and flow wired once, payslip sheet, Settings built once, Run setup again.
- run-cases 2934 passed, 0 failed; tests.html 3437/3437.

## Measured (fresh context, FT_NO_TESTS=1, gzip, 1440 and 390 identical)
- Before (5f3ab77 base): 326.7 KB, 32 requests.
- After, on top of P3a/P3d/U2: returning user 208.3 KB / 30 requests; first run (loads Setup) 235.2 KB / 34 requests.

## Left for later
- The 180 KB target is not reached by this step alone. Remaining at startup: strings 30, store 26, main 31, CSS 17, tabs 16, font 30, icon 20 (gzip KB). Next candidates: merge small chunks, split the CSS bundle further.
- activity.css and scenario.css both style `.wi-kind` (different meanings); the winner now depends on which loads last.
