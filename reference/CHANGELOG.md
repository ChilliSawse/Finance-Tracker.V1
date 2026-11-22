# Reference data changelog

Lists added, changed and removed ids per release. Releases are tagged `ref-YYYY.MM.N`.

## 2026.11.2 (2026-11-22)

- merchants rev 2 (FT-0032 DB5, from D5): 418 merchants and keyword rows, split a.json to z.json. Every `categoryId` is one of the app's 15 ids; D5's finer category is kept in the new optional field `refCategory` (schema change: `refCategory` added to `merchants.schema.json`, an id like `categoryId`). Never used for sorting today.
- Confidence: 74 high (descriptor seen on a published page), 225 medium, 119 low. Income-category rows are capped at medium. Unconfirmed entries are never high.
- Left out (85): merchants whose D5 category maps only to `other` (gifts and charity, BNPL, credit card, loans, fees, interest, cash, refund, pets, education, kids and family, tax, other government, payment to a person, other) and those that map to the app's `transfer` id, which is not one of the 15 (transfers, savings, investments, super). New categories are offered later, never added silently (R3 section 8).
- `reference/src/proposed/categories-d5.json`: D5's 63 categories, proposed only. The build does not read that folder. `categories.json` is unchanged (still the generated defaults, rev 1).
- Fixture round-trip: `reference/tests/fixtures.json` (made-up lines, false-hit traps included), `tools/match.mjs`, `tools/fixtures.mjs`, run by `npm run ref:check`.
- Evidence links point at a third-party directory; no descriptor strings from it are in the repo.
- baseline not refreshed (done at app release).
- Agents: claude-code (claude-sonnet-5-5; DB5).

## 2026.11.1 (2026-11-22)

- Scaffold only (FT-0032 DB1): schemas, build, CI, service-worker rules.
- categories rev 1: the app's 15 default categories, generated from `DEFAULT_CATEGORIES`. `reviewed` is null (no person has reviewed them as reference data).
- models rev 1: `bucket-method`, generated from `BUCKET_METHOD`, so the picker lists it like any other model.
- merchants rev 1 and asset types rev 1: empty.
- Agents: claude-code (claude-sonnet-5-5; DB1).
