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

## Review fixes
- The offer toast carries Apply and Undo (and Dismiss: it stays until used, WCAG 2.2.1). `toast.js` accepts `action` as one `{label, onAction}` or a list. Undo puts the row back and takes the learned rule back; the Undo after Apply also takes back the rows, the rule and the edit.
- Apply: money out only, never a suggested transfer or bucket, a transfer (id or category kind), or a split; reference suggestion fields are dropped. One IndexedDB transaction to apply and one to undo; undo skips rows edited since the apply; a failed apply shows `a.quickAdd.failed` and changes nothing.
- Keys: processor, BNPL and filler words (paypal, afterpay, zip, klarna, pty, ltd ...) and more bank words never make a key; a key starting with a bank word is taken again from the text after it (`ruleKeyFor`).
- A correction back to "other" removes the rule with that exact key (undoable). A spending row moved to an income category learns nothing.
- If `learn.js` fails to load the plain "Updated" + Undo toast shows from core; errors in it never reach the save catch. Delete is as it was (static, no dependence on `learn.js`).
- Cold-load headroom: 1,049 strings used only by one lazy screen moved out of the first-load catalogue into `src/i18n/en-lazy-<screen>.js` (activity, plan, plan-lists, future, onboarding, income-layout, scenario, results). Each file registers itself in `en` and is the first import of its screen's entry module, so the strings are there before the screen renders. Chosen from the built chunks: a key moved only if every use sits in that one lazy chunk (dynamic key prefixes included); settings-screen strings were left alone. `test-registry.js` loads them all for the tests.
