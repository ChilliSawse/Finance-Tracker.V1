# Reference data changelog

Lists added, changed and removed ids per release. Releases are tagged `ref-YYYY.MM.N`.

## 2026.11.2 (2026-11-22)

- merchants rev 2 (FT-0032 DB5, from D5): 418 merchants and keyword rows, split a.json to z.json. Every `categoryId` is one of the app's 15 ids; D5's finer category is kept in the new optional field `refCategory` (schema change: `refCategory` added to `merchants.schema.json`, an id like `categoryId`). Never used for sorting today.
- Confidence: 74 high (descriptor seen on a published page), 225 medium, 119 low. Income-category rows are capped at medium. Unconfirmed entries are never high.
- Left out (85): merchants whose D5 category maps only to `other` (gifts and charity, BNPL, credit card, loans, fees, interest, cash, refund, pets, education, kids and family, tax, other government, payment to a person, other) and those that map to the app's `transfer` id, which is not one of the 15 (transfers, savings, investments, super). New categories are offered later, never added silently (R3 section 8).
- `reference/src/proposed/categories-d5.json`: D5's 63 categories, proposed only. The build does not read that folder. `categories.json` is unchanged (still the generated defaults, rev 1).
- Fixture round-trip: `reference/tests/fixtures.json` (made-up lines, false-hit traps included), `tools/fixtures.mjs` and `tools/import-path.mjs`, run by `npm run ref:check` through the app's own matcher (FT-0032 DB6).
- merchants rev 3 (DB6): too-generic keys removed or guarded (`liberty`, `evie`, `tab`, `sonic`, `h m`, `hj`, `google youtube` kept on youtube-premium only), parking/fine excludes on council rows and `city of`, `amazon web services`/`aws` excluded from amazon-au, central-coast-water now needs the word water. 17 more trap lines in the fixtures.
- Evidence links point at a third-party directory; no descriptor strings from it are in the repo.
- baseline not refreshed (done at app release).
- Agents: claude-code (claude-sonnet-5-5; DB5).
- asset types rev 2 (FT-0032 DB8, from D2, D3, D4 and their checks): 65 types. 47 depreciating, 1 stable, 3 appreciating, 9 invested, 4 cash, 1 setting. Values are market loss (FT-R-114); the ATO effective life sits in a separate `effectiveLife` tagged `taxOnly` with its instrument (LI 2025/20). Every type is `suggested: true` and `reviewed: null` (no person has reviewed it).
- Cars carry the D2 section 5.3 powertrain factor (`powertrainFactor`: petrol and diesel 1; hybrid, plug-in hybrid and EV as ratios to the same body's curve at years 1, 3, 5, 10). The hybrid, plug-in and EV types keep their own D2 curves. No schema change was needed (the asset type schema allows extra fields).
- New `match` words cover van, SUV, trailer, camper, jet ski, scooter, motorhome. Three types have no market curve and a null rate (`vehicle_motorhome`, `vehicle_trailer`, `vehicle_jetski`): only the ATO life is sourced. Also null by design: `property_regional` growth (D4's 5.0 had no source), `crypto` (no reliable rate), `cash_everyday` and `cash_offset` interest. `rentalYield` is folded into the house and unit types. `inflation_cpi` has kind `setting`, `legacyKind: null` and no match words (it is not an asset).
- `watch_luxury_scarce` has kind `stable` and `legacyKind: depreciating` (the app has no flat kind). The D4 words `td` and bare `diversified` were dropped (wrong-kind risk); `bank account` moved from savings to the new everyday type.
- Matching: whole word or phrase on normalised text, the same as merchants `match: 'word'` in the app; longest phrase wins; an `exclude` phrase vetoes a type. `reference/tools/asset-match.mjs` runs 87 name cases (`reference/tests/asset-fixtures.json`) and content rules inside `npm run ref:check`.
- Effective lives are quoted from the ATO determination (legislation.gov.au, CC BY 4.0 as recorded by the D3 check).
- baseline not refreshed (done at app release).
- Agents: claude-code (claude-sonnet-5-5; DB8).

## 2026.11.1 (2026-11-22)

- Scaffold only (FT-0032 DB1): schemas, build, CI, service-worker rules.
- categories rev 1: the app's 15 default categories, generated from `DEFAULT_CATEGORIES`. `reviewed` is null (no person has reviewed them as reference data).
- models rev 1: `bucket-method`, generated from `BUCKET_METHOD`, so the picker lists it like any other model.
- merchants rev 1 and asset types rev 1: empty.
- Agents: claude-code (claude-sonnet-5-5; DB1).
