// English string catalogue — the i18n foundation.
//
// Keys are dot-namespaced by feature; values use {param} placeholders filled
// by t(). Adding a language = shipping a sibling file with the same keys and
// switching the import in strings.js. Numbers, currency and dates are NOT in
// here — they go through Intl (formatCurrency / toLocale*) at call sites.
//
// Coverage note: the Ledger-era surfaces (feed, onboarding, import, toasts)
// read from this catalogue. Longer-form guide copy inherited in index.html
// and pre-Ledger alert strings remain inline — see NOTES.md for the migration
// inventory.

export const en = {
    // Home greeting
    'greeting.lateNight': 'Up late?',
    'greeting.morning': 'Good morning',
    'greeting.afternoon': 'Good afternoon',
    'greeting.evening': 'Good evening',
    'insight.gettingStarted': "Let's get your money story started.",
    'insight.overspending': 'Spending is running ahead of income right now — worth a look at the Expenses tab.',
    'insight.netWorthUp': 'Net worth is up {pct}% this month. Keep it rolling.',
    'insight.savingsStrong': "You're saving {rate}% of your income. That's the good stuff.",
    'insight.savingsSome': "You're saving {rate}% of your income — every point counts.",
    'insight.default': "Here's what's happening with your money.",

    // Pulse tiles
    'pulse.netWorth': 'Net worth',
    'pulse.savingsRate': 'Savings rate',
    'pulse.leftover': 'Left over each fortnight',
    'pulse.leftoverSub': 'after tax and all expenses',
    'pulse.onTarget': 'on target',
    'pulse.deltaSuffix': ' this month',

    // Coming up (bills)
    'upcoming.title': 'Coming up',
    'upcoming.summary': '{count} {billWord} · {total} in the next fortnight',
    'upcoming.billOne': 'bill',
    'upcoming.billMany': 'bills',
    'bills.dueToday': 'today',
    'bills.dueTomorrow': 'tomorrow',
    'bills.dueInDays': 'in {days} days',

    // Feed clusters + events
    'feed.today': 'Today',
    'feed.yesterday': 'Yesterday',
    'feed.thisWeek': 'This week',
    'feed.thisMonth': 'This month',
    'feed.earlier': 'Earlier',
    'feed.import': 'You imported <strong>{count}</strong> {txnWord}{fromSource}.',
    'feed.import.txnOne': 'transaction',
    'feed.import.txnMany': 'transactions',
    'feed.import.fromSource': ' from {source}',
    'feed.milestone.netWorth': "Net worth crossed <strong>{threshold}</strong> — you're at {value}.",
    'feed.milestone.savingsRate': "Your savings rate hit <strong>{threshold}%</strong> — you're keeping {value}% of what you earn.",
    'feed.billDue': '<strong>{name}</strong> is due {due} — {amount}.',
    'feed.billDueSoon': 'soon',
    'feed.incomeAdded': 'You added <strong>{name}</strong>{amountPart}.',
    'feed.empty.title': 'Your story starts here',
    'feed.empty.sub': "As things happen — a bank import, a milestone, a bill coming up — they'll show up in this feed. Add your income and expenses to get the first entries rolling.",

    // Toasts
    'toast.milestone.netWorth': 'Nice one — net worth just crossed {threshold}.',
    'toast.milestone.savingsRate': 'Looking good — your savings rate hit {threshold}%.',
    'toast.onboarding.done': "You're all set — this feed fills up as your story unfolds.",
    'toast.sample.loaded': 'Meet Alex and Sam — a sample household with {count} transactions to explore.',
    'toast.sample.loadedNoTxns': 'Meet Alex and Sam — a sample household to explore.',

    // Onboarding summary
    'onboard.summary.plain': 'Your numbers are in — refine any of them from the tabs whenever you like.',
    'onboard.summary.saving': "On those numbers you're keeping about {fortnightly} a fortnight — a {rate}% savings rate. That's the number Ledger helps you grow.",
    'onboard.summary.overspending': 'On those numbers, spending is running ahead of income by about {fortnightly} a fortnight. Ledger will help you see exactly where it goes.',
    'onboard.sample.loading': 'Setting things up…',

    // CSV import flow
    'import.detect.saved': "We've used the column matching you saved for this file shape — adjust it if anything looks off.",
    'import.detect.auto': 'We had a go at matching the columns automatically — check the preview below and adjust if anything looks off.',
    'import.preview.title': 'Preview — {count} {txnWord} ready',
    'import.preview.none': 'No readable transactions with this column matching yet — try different columns above.',
    'import.preview.more': '…and {count} more. Rows beyond the preview are auto-categorised the same way.',
    'import.errors.title': "{count} {rowWord} be read (they'll be skipped):",
    'import.errors.rowOne': "row couldn't",
    'import.errors.rowMany': "rows couldn't",
    'import.errors.line': 'Line {line}: {message}',
    'import.errors.moreLines': '…and {count} more.',
    'import.commit': 'Import {count} {txnWord}',
    'import.commit.empty': 'Import',
    'import.emptyFile': 'That file looks empty — is it the right CSV export?',
    'import.readFailed': "Couldn't read that file. Try exporting it from your bank again.",
    'import.saveFailed': 'Saving failed: {message}. Nothing was imported.',
    'import.success.title': 'Done — {count} {txnWord} imported.{dupNote}',
    'import.success.dupOne': ' 1 duplicate was already here and got skipped.',
    'import.success.dupMany': ' {count} duplicates were already here and got skipped.',
    'import.success.sub': "They're in your activity feed and spending breakdowns now.",
    'import.undo.done': 'Undone — those {count} transactions are gone.',
    'import.another': 'Import another file',
    'import.undo': 'Undo this import',

    // Spending / year cards
    'spend.subtitle': 'Looks like {category} is your biggest expense this month.',
    'spend.everythingElse': 'Everything else',
    'spend.total': 'Total spent',
};
