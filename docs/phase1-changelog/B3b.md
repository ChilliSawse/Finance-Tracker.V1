# B3b effectiveBucket and per-bucket leftThisPay (pure)

- `plan.js`: `defaultBucketRole` (essential gives daily, else splurge), `effectiveBucket(txn, category, planItem, allocation)`
  (txn, plan item, category `bucketId`, derived role, Daily role, then `SPENDABLE_POOL` = `'pool'`; credits and transfers give `null`;
  a `bucketId` no longer in the allocation is skipped), `SPENDABLE_POOL`.
- `pay-cycle.js`: `leftThisPay({data, totals, txns, today})`. Pools by `allocateCents` over the allocation percentages
  (`totals.netCents` or `netPerPayCents(data)`); headline fields are Daily's, `buckets[]` holds every bucket
  `{id, role, poolCents, spentCents, billsDueCents, leftCents}`; also `mode`, `netCents`, `toReview` (count of `status:'review'` rows).
  Missed and upcoming unmatched bills count, matched ones only once (as spend). Month mode (variable, or no anchor that
  `inferPayAnchor` can find) uses income credits received so far as net. Unconfigured allocation: whole net is spendable.
- Tests B3b.1 to B3b.8 (45 assertions) in `pay-cycle.test-cases.js`; figures 495.21 and 246.85 reconciled exactly.
  `tests.html` 701 to 746; `run-cases` 505 to 550.

## Follow-up: month-mode income counts events and transactions (FT-R-58)

- Month-mode net is now variable-income events dated in the month up to today (`eventFigures(e).net`, any variable
  source) plus Income-category credits, each receipt once. There is no existing link field, so an event matches a
  credit by `event.txnId === credit.id` when the event carries one, else by amount (the event's net or banked
  figure, to the cent) within 3 days; each credit matches at most one event. Unmatched credits count in full.
- Test B3b.8b (6 assertions): events only, transactions only, overlap counted once, over-3-days apart, explicit link,
  one credit per event. `run-cases` 550 to 556.
