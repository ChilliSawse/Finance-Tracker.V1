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

    // Variable income — event editor (income settings modal)
    'varInc.fromEvents': '— from events —',
    'varInc.eventsTitle': 'Income events — {name}',
    'varInc.fyTotal': '{fy}: {net} net · {count} {eventWord}',
    'varInc.eventOne': 'event',
    'varInc.eventMany': 'events',
    'varInc.noEvents': 'No income events yet — add your first one below.',
    'varInc.addEvent': '+ Add income event',
    'varInc.labelPh': 'Client / venue / gig',
    'varInc.gstTitle': 'Tick when this amount includes 10% GST you collected (registered for GST)',
    'varInc.penaltyTitle': 'Tick when this shift was paid at penalty rates (weekend, public holiday, late night)',
    'varInc.baseRate': 'Base hourly rate (optional)',
    'varInc.baseRateHint': 'Used only to show how much of a penalty-rate shift came from loadings. Never calculates award entitlements.',

    // Variable income — Income tab card
    'varInc.card.subtitle': 'Variable income · {fy} so far: {gross} gross',
    'varInc.card.recent': 'Recent events',
    'varInc.card.noEvents': 'No income events yet — add your first one via "Edit income & tax".',
    'varInc.card.byLabel': 'By client / venue ({fy})',
    'varInc.card.cashSplit': '{bank} banked + {cash} cash',
    'varInc.card.hours': '{hours} hrs · {rate}/hr effective',
    'varInc.card.penaltySplit': '{base} base + {loading} loadings on penalty shifts',
    'varInc.card.penaltyBadge': 'penalty rates',
    'varInc.card.gstBadge': 'incl. GST',
    'varInc.card.cashBadge': 'cash',
    'varInc.provision.title': 'Tax to set aside ({fy})',
    'varInc.provision.body': 'On your pace so far ({projGross}/yr gross), the year’s tax on this income comes to about {projTax}. By today that’s {toDate} — {withheld} is already withheld, so aim to have {still} put aside.',
    'varInc.provision.bodyCovered': 'On your pace so far ({projGross}/yr gross), the year’s tax on this income comes to about {projTax}. What’s already been withheld ({withheld}) covers the {toDate} you’d need by today. Nice.',
    'varInc.provision.gstNote': 'GST collected so far: {gst} — that’s the ATO’s, not income; keep it separate for your BAS.',

    // Volatility section (Home tab)
    'vol.title': 'Income history',
    'vol.subtitle': 'Your last 12 months, month by month',
    'vol.avgLine': '12-month average: {avg}/month',
    'vol.bestMonth': 'Best month',
    'vol.worstMonth': 'Worst month',
    'vol.monthlyAvg': 'Monthly average',
    'vol.ytd': 'This FY so far',
    'vol.quarterTitle': 'Quarterly summary — {fy}',
    'vol.quarterHint': 'Aligned to BAS quarters. Net is ex-GST + cash; GST collected belongs to the ATO.',
    'vol.q.quarter': 'Quarter',
    'vol.q.events': 'Events',
    'vol.q.net': 'Net income',
    'vol.q.tax': 'Tax withheld',
    'vol.q.gst': 'GST collected',
    'vol.slowSeason': 'Pattern spotted: {months} usually {runWord} quieter for you — worth padding the buffer beforehand.',
    'vol.slowSeasonOne': 'runs',
    'vol.slowSeasonMany': 'run',
    'vol.notEnoughHistory': "Not enough history yet — I'll let you know once you have a full year of income events.",
    'vol.monthAria': '{month}: {amount}',

    // Coaster card (Dashboard)
    'coast.months': 'You could coast for about {months} on what you’ve saved.',
    'coast.detail': '{assets} in assets ÷ {spend}/month average spending (last 3 months of transactions).',
    'coast.noExpenses': 'Add some expenses to see your coaster estimate — import a bank CSV/PDF so Ledger knows your average month.',
    'coast.monthOne': 'month',
    'coast.monthMany': 'months',

    // Tax provision card (Savings tab)
    'taxpot.checkboxTitle': 'Use this bucket as your tax provision pot',
    'taxpot.none': 'Tag an allocation bucket as your Tax pot (Edit assets, allocation & FI) to compare it against the estimated liability.',
    'taxpot.onTrack': '{name} holds {balance} — ahead of the {target} you’d want set aside by today. Nice buffer.',
    'taxpot.behind': '{name} holds {balance} — about {gap} short of the {target} you’d want set aside by today.',
    'taxpot.noEstimate': 'No variable income this financial year yet, so there’s nothing to provision against.',

    // Income statement export
    'stmt.none': 'No income events in that period yet — add events to a Variable income source first.',
    'stmt.popupBlocked': 'Your browser blocked the new tab — allow pop-ups for this site and try again.',

    // PDF import
    'pdf.loading': 'Loading PDF reader…',
    'pdf.loadFailed': "Couldn't load the PDF reader — check your internet connection and try again.",
    'pdf.parsingPage': 'Parsing page {page} of {total}…',
    'pdf.password': 'This PDF is password-protected — remove the password (print to PDF works) and try again.',
    'pdf.corrupt': "That file doesn't look like a readable PDF — try exporting it from your bank again.",
    'pdf.scanned': "This appears to be a scanned document — I can't read text from images yet. Try your bank's CSV export instead.",
    'pdf.noRows': "Couldn't find any date + amount pairs in this PDF. It may use a layout I don't know — the CSV export from your bank will work.",
    'pdf.detected': 'This looks like a {bank} statement — {count} transactions found. Check the preview below.',
    'pdf.detectedGeneric': "Didn't recognise the bank, so I used the generic reader — {count} transactions found. Double-check the amounts and signs below.",

    // Payslip autofill
    'payslip.uploadBtn': 'Upload payslip (PDF)…',
    'payslip.parsing': 'Reading payslip…',
    'payslip.applied': 'Filled from payslip: net {net} · tax {tax}{grossPart}{superPart}',
    'payslip.grossPart': ' · gross {gross}/yr',
    'payslip.superPart': ' · super {superAmt} (not added to figures)',
    'payslip.nothingFound': "Couldn't find pay figures in that PDF — is it a payslip? You can enter the numbers by hand.",
};
