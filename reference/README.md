# Ledger reference database

Shared, versioned reference data for Ledger (categories, merchants, asset types, saving models, later tax figures).
Design: vault `Web Prospects/Products/Ledger/research/R3 - reference database design.md`. The app never needs it to work: the
in-code defaults and the pinned baseline cover the offline case.

## Layout

```
reference/
  schemas/            JSON Schema 2020-12, one per kind (+ manifest, release, common)
  src/                the data you edit
    release.json      dataVersion (CalVer YYYY.MM.N), released, minApp
    categories.json
    merchants/        a.json .. z.json (0.json for digits), split by the first letter of key; _meta.json holds the rev
    asset-types.json
    models/           one file per saving model; _meta.json holds the rev
  baseline/           pinned snapshot, copied to dist/ref/baseline/ and precached by the service worker
  tools/build.mjs     validate, hash, write dist/ref/
  tools/gen-defaults.mjs   one-off bootstrap of categories.json and models/bucket-method.json from the app code
```

`npm run build` writes `dist/ref/`: `manifest.json` (the only mutable URL), content-hashed files, and `baseline/`.

## Rules for every entry

- Every entry has `source` (a URL or a plain description) and `reviewed` (a date, or `null` if no person has reviewed it). Merchants may carry `evidence` instead of `source`.
- Unknown is `null`. Never guess a value. A value you cannot source does not go in.
- Do not paste text you have no licence for. Descriptor strings from sources that forbid reuse (for example the Weel directory) are evidence only: link them, do not copy them.
- No real finance data, ever: no real account numbers, names or statement lines.
- Merchant `key`: for `match: "key"` or `"keyword"` it must equal `merchantKey(key)` and each alias must map to the same key. For `match: "word"` it is the normalised name (lowercase letters and digits, single spaces). No regular expressions.
- `categoryId` must exist in `categories.json`. `bucketRole` is a role (`daily`, `splurge`, ...), never a bucket id.
- A saving model's `model` is run through the app's `validateModelDef` unchanged. Engines the app does not know yet are rejected here.
- Raise the file's `rev` by 1 on every change to it (the PR diff comment warns if you forget). Raise `dataVersion` in `release.json` when you cut a release.

## How to add data

1. Edit files under `reference/src/`. Merchants go in the file for the first letter of the key.
2. `npm run ref:check` (schemas, the app validators, gzip caps, baseline integrity).
3. `node reference/tools/build.mjs --diff <base reference folder>` shows what you added, changed or removed.
4. Open a PR. CI (`.github/workflows/reference.yml`) runs the same check and posts the diff as a comment.

## The baseline

`reference/baseline/` is a snapshot of a built `ref/`. It is pinned on purpose: the service worker precaches it, so changing it
changes `sw.js` and triggers the app's "Update available" banner. A data-only change therefore leaves `sw.js` byte-identical.
Refresh it only when you cut an app release: `node reference/tools/build.mjs --refresh-baseline`. Cap: 250 KB gzip in total.

## Size caps (gzip, per built file)

categories 20 KB, merchants 150 KB, asset types 40 KB, models index 10 KB, each model 10 KB, tax 60 KB. Change a cap in `tools/build.mjs` on purpose, with a reason in the PR.

## Provenance

Append the agent name and model that touched a file to the changelog entry for that release.

## App release steps (reference data)

The repo keeps no other release checklist, so this is the one. Before cutting an app release:

1. Refresh the baseline: `node reference/tools/build.mjs --refresh-baseline`.
2. `npm run ref:check`, then commit `reference/baseline/` with the release.

Data-only reference changes between app releases do not touch the baseline, so they ship without an "Update available" banner.

## Service worker rules

`vite.config.js` precaches only `ref/baseline/**` (`globIgnores: ['ref/*.json', 'ref/!(baseline)/**']`, so a new `ref/` subfolder is also left out). `ref/manifest.json` is NetworkFirst (3 s timeout); the hashed data files are NetworkOnly because the browser client keeps its own hash-verified copies (`ft-ref-v1`). `tools/z1-coldload.mjs` fails if anything requests `/ref/` during the cold-load window.
