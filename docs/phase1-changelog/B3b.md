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
