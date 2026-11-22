# DB9 learn on correct (FT-R-56)

- Changing an existing spending row's category in Quick-add edit (a To-review row confirmed with a different category counts) stores a
  merchant rule (`learnRule`, key only) that runs ahead of the keywords. Nothing learns from a new entry, a manual or sample row, income,
  a transfer, a move to `other`, or an empty or bank-wording key (`isLearnableKey`).
- The toast then reads "Updated {name}. Also sort {count} more like this?" with Apply, counting only same-key rows still in review (never a
  confirmed row, a transfer or a split). Apply sorts them (`applyRuleToStoredUndoable`), then "Sorted {count} more as {category}." with Undo.
  With nothing to offer the usual Undo toast shows, and its Undo also takes the learned rule back.
- Cold-load budget: the code is loaded by `import()` at save time (`ui/learn.js`, `state/rule-learn.js`). `learnRule`, `similarUnconfirmed`,
  `applyRuleToSimilar` and `applyRuleToStored` MOVED from `rules.js` to `rule-learn.js` (left in `rules.js` they were pulled into the core
  chunk); the three strings are in `i18n/en-learn.js`, filled in by `learn.js`, not by `t()`. `showUndoToast` takes an optional `actionLabel`.
- Tests: `rules` DB9.1 to DB9.4 (pure), `transactions` DB9.5 (stored rows, apply, undo).
