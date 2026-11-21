# P3e: fewer startup requests, a light tab icon, no Today flash on first run (FT-R-104)

Target set by the owner: at most about 180 KB gzip and about 12 requests at startup, pdf.js lazy.

## What changed
- `vite.config.js`: `output.codeSplitting` (renamed from the deprecated `advancedChunks` at merge) merges the modules every first load needs (state and calculation core, the English catalogue, Today and the tab shell, shared sheet and toast; an explicit list, all already reached from `main.js`) into one `core` chunk, and the service-worker registration code into one `pwa` chunk. A module not in the list just stays in a chunk of its own, and the list holds nothing lazy, so the first download does not grow.
- `src/ui/tax-card.js`: the salary sheet (`income-layout.js`) loads when Check is pressed, not at startup (it took income-layout, and with it confirm and CSS, into the first download). `src/ui/scenario/make-real.js`: removed a dynamic import of itself. Both `INEFFECTIVE_DYNAMIC_IMPORT` warnings are gone from the build.
- Icons: new `public/icons/favicon-32.png` (1.3 KB, a 32 px copy of the same artwork) is the only `rel="icon"`; the 192 and 512 stay for the manifest and `apple-touch-icon`. Both were recompressed losslessly with `tools/recompress-png.mjs` (pixels verified identical): 192 from 20,164 to 17,559 bytes, 512 from 111,068 to 94,690.
- `.wi-kind` is scoped: `.wi-top .wi-kind` in `activity.css` (the "where it went" list) and `.wi-change .wi-kind` in `scenario.css` (the change pill). Checked in a browser in both load orders: identical styles.
- First run: `startFirstRunSetup` puts `body.setup-pending` on the page until Setup has opened (or failed to load); `shell.css` hides `.app` meanwhile, so a new user sees the ground colour, then Setup. `tools/z1-firstframe.mjs` samples every frame: before, 3 frames of Today at 1440; after, 0 at 390 and 1440.
- `tools/z1-coldload.mjs` (`npm run check:coldload`): builds with `FT_NO_TESTS=1` into a temp folder (the build that includes `tests.html` splits chunks differently, so a plain `dist/` is not what is deployed), serves it, and measures a returning user and a first run at 390 and 1440. Fails if the returning user is over 180 KB gzip or 12 requests, if pdf.js loads, or if a request fails. It is not in `deploy.yml`: it adds a second full build and would stop a deploy on a size change, which is the owner's call (CI already installs Chromium, so adding it later is one step).

## Tests
- run-cases: 1 case added (`P3e.1`, the pending class is set while Setup loads and cleared on success and on failure): 2938 passed, 0 failed. tests.html 3441/3441 (was 3437).
- `tools/z1-coldload.mjs`, `tools/z1-firstframe.mjs` run on the built app; `z1-firstuse.mjs` still passes.

## Measured (fresh context, no service worker, gzip, 390 and 1440 identical)
Returning user: 30 requests, 208.4 KB to **9 requests, 174.2 KB**. First run (adds Setup): 34 requests, 235.2 KB to **17 requests, 210.6 KB**.

## Not done
- All seven string catalogue files stay at startup (30 KB): `t()` is synchronous and most screens use many keys; splitting needs an async catalogue or a per-screen key split. `main.css` (16.8 KB) holds rules for Settings, sheets and help that a first Today does not paint; splitting is possible but needs a per-rule review. The core chunk still holds some Plan and Future helpers that `main.js` reaches (calc/fi, goal-planner, scenario state): worth a look in a later step.
- Slack under budget is about 6 KB; the font (30 KB) is the largest single item left.
