# P3a - lazy tab renderers (cold-load cause C1)

## What changed
- `src/ui/render.js`: Activity, Plan and Future renderers are loaded with `import()` the first time they are needed. Today stays static (landing screen). `updateAllUI()` now renders only `store.activeTab` and marks the other tabs dirty; it returns a promise. `updateDataAndUI`, `renderActiveTab` and `refreshTab` also return promises (they still render synchronously when the renderer is already loaded, so existing callers behave the same).
- New exports: `isTabReady`, `isTabDirty`, `ensureTabLoaded`, `_resetTabsForTest` (test seam).
- The other tab modules are prefetched when the browser is idle, 3 s after the load event, so a first open is usually instant and offline is unaffected (the service worker precaches every chunk).
- `src/ui/tabs.js`: `showTab` returns a promise. A tab with nothing pending, or whose module is loaded, switches synchronously as before. A dirty tab whose module is not loaded keeps the current screen until the module arrives (no blank flash), then switches and renders; the latest request wins; a failed load logs, still switches, and retries on the next open. `restoreActiveTab` returns that promise.

## Why
Boot rendered all four tabs and statically imported three of them, keeping about 280 KB of source in the startup download.

## Tests
7 cases in `src/ui/render.test-cases.js` (group `render-lazy`, browser env): only the active tab renders at boot; first open loads and renders another tab and the screen switches after the load; the latest request wins; a data change on a hidden tab re-renders it on open; refresh and active-tab changes; a failed load is retried. tests.html 3382/3382 (was 3347). run-cases 2887 passed, 0 failed.

## Measured (production build, FT_NO_TESTS=1, fresh context, no service worker, load + 2.5 s)
5f3ab77: 32 requests, 334.6 KB gzip. With P3a: 31 requests, 316.4 KB gzip. Idle prefetch adds the three tab chunks back about 3 s after load (337 KB at 7 s), outside the first-load window.

## Left for P3b
`activity.js` is still reached statically from `main.js` via `import/import-ui.js` and `import/pdf-ui.js` (`openActivityToReview`), and `scenario/index.js` via `scenario/answer-top.js` from `main.js`; `plan-lists`/`income-layout` via `onboarding`. Plan and Future (`plan.js`, `future.js`, plan-buckets, future/*) are no longer reachable from `main.js`. Making those few edges dynamic is what releases the rest of the saving.
