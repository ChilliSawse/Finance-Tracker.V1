// FT-0032 DB11 (FT-R-128): suggested kinds held out of FI with a count, each loan's "This loan is for" link, and the couples rule.
// Spread into the "fi" group (FI_TEST_CASES). Pure: no DOM, no storage.

import { runPlan, projectNetWorth, fiSummary } from '../calc/fi.js';
import { loanScope, heldOutAssets, pendingLoanLinks } from '../calc/assets-debts.js';
import { calculateTotals } from '../calc/calculations.js';
import { checkItems } from '../ui/plan-assets-debts.js';
import { migrateLoanLinks, needsLoanLinkMigration, suggestLoanLink } from './loan-link-migration.js';
import { runMigrationChain, BACKUP_KEY } from './migration-chain.js';
import { buildSampleHousehold } from './sample-data.js';
import { migrateAssetDebtDetail } from './asset-debt-migration.js';

const TODAY = '2026-11-21';
const flat = (o) => () => ({ dateIso: TODAY, inflationPct: 0, expectedReturnPct: 0, fiNumber: 0, fireYear: 0, superYear: 0, ...o });
const run0 = (start, o = {}) => runPlan(start, flat({ fiNumber: 1e12, ...o }), { years: 0, untilFI: false }).path[0];

const home = (o = {}) => ({ id: 'a-home', name: 'Home', balance: 900000, kind: 'appreciating', kindSuggested: false, use: 'liveIn', useSuggested: false, ...o });
const rental = (o = {}) => ({ id: 'a-rent', name: 'Rental', balance: 900000, kind: 'appreciating', kindSuggested: false, use: 'investment', useSuggested: false, ...o });
const etf = (o = {}) => ({ id: 'a-etf', name: 'ETF', balance: 500000, kind: 'invested', kindSuggested: false, ...o });
const loan = (o = {}) => ({ id: 'l-mort', name: 'Home loan', balance: 600000, interestRate: 0, minRepayment: 0, forAssetId: null, forAssetSuggested: false, ...o });
const baseData = (assets, liabilities, extra = {}) => ({ assets, liabilities, incomeSources: [], fiSettings: { multiple: 25, inflation: 2.5, expectedReturn: 7 }, ...extra });

export const LOAN_LINK_TEST_CASES = [
    {
        name: 'DB11.1 every asset whose kind is only suggested stays out of FI, with a count and the ids; net worth still counts it (FT-R-128 1)',
        fn(assert) {
            const assets = [
                { id: 'a-1', name: 'Savings', balance: 1000, kind: 'cash', kindSuggested: true },
                { id: 'a-2', name: 'Shares', balance: 2000, kind: 'invested', kindSuggested: true },
                { id: 'a-3', name: 'Car', balance: 3000, kind: 'depreciating', kindSuggested: true },
                { id: 'a-4', name: 'Super', balance: 4000, kind: 'invested', kindSuggested: true, isSuper: true },
                { id: 'a-5', name: 'Empty', balance: 0, kind: 'cash', kindSuggested: true },
                { id: 'a-6', name: 'Cash', balance: 10000, kind: 'cash', kindSuggested: false },
            ];
            const p = run0({ assets }, { age: 70 });
            assert('only the confirmed 10,000 counts toward FI, even with super unlocked', p.fiNetWorth, 10000);
            assert('net worth counts all of them at the entered balance', p.netWorth, 20000);
            assert('the held-out value is its own line', p.heldOutValue, 10000);
            assert('the count matches the Check card (a zero balance included), and the ids are listed', p.heldOut, { count: 5, ids: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'] });
            const d = baseData(assets, []);
            const sum = fiSummary(d, { today: TODAY });
            assert('the summary carries the same count for the screen', sum.heldOut, { count: 5, ids: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'] });
            assert('and it equals the number of asset lines on the Check card', checkItems(d).filter((x) => x.type === 'asset').length, sum.heldOut.count);
            assert('heldOutAssets gives the same answer on the list alone', heldOutAssets(assets), sum.heldOut);
            const confirmed = assets.map((a) => ({ ...a, kindSuggested: false }));
            const q = run0({ assets: confirmed }, { age: 70 });
            assert('confirmed, all but the car (it loses value) count and nothing is held out', [q.fiNetWorth, q.heldOut.count], [17000, 0]); // the 3,000 car loses value, so it never counts
            const later = runPlan({ assets }, flat({ fiNumber: 1e12 }), { years: 3, untilFI: false }).path;
            assert('held out items stay flat in net worth over the years, FI untouched', [later[3].heldOutValue, later[3].fiNetWorth], [10000, 10000]);
        },
    },
    {
        name: 'DB11.2 a confirmed link to a home you live in takes the loan out of FI with the home, and keeps it in net worth (D7: 900k home, 600k loan, 500k invested)',
        fn(assert) {
            const unlinked = run0({ assets: [home(), etf()], debts: [loan()] });
            assert('unlinked (before): FI is minus 100,000', unlinked.fiNetWorth, -100000);
            const linked = run0({ assets: [home(), etf()], debts: [loan({ forAssetId: 'a-home' })] });
            assert('linked to the home you live in: FI is 500,000', linked.fiNetWorth, 500000);
            assert('net worth still has the home and the whole loan: 800,000', linked.netWorth, 800000);
            assert('the loan is split in the snapshot: none in FI, 600,000 out of it, 600,000 in all', [linked.debtsFi, linked.debtsOutOfFi, linked.debts], [0, 600000, 600000]);
            assert('loanScope says why', loanScope(loan({ forAssetId: 'a-home' }), [home()]), { fi: 'no', reason: 'liveIn' });
            const linkedData = baseData([home(), etf()], [loan({ forAssetId: 'a-home' })]);
            const sum = fiSummary(linkedData, { today: TODAY });
            assert('the same through the summary the screens use (Future and What If)', [sum.now.fiNetWorth, sum.now.netWorth], [500000, 800000]);
            assert('and calculateTotals agrees on net worth', calculateTotals(structuredClone(linkedData)).netWorth, 800000);
        },
    },
    {
        name: 'DB11.3 a confirmed link to an investment property keeps the loan in FI, so the property counts net of it',
        fn(assert) {
            const p = run0({ assets: [rental(), etf()], debts: [loan({ name: 'Investment loan', forAssetId: 'a-rent' })] });
            assert('900,000 + 500,000 - 600,000', [p.fiNetWorth, p.netWorth, p.debtsOutOfFi], [800000, 800000, 0]);
            assert('loanScope says investment', loanScope(loan({ forAssetId: 'a-rent' }), [rental()]), { fi: 'yes', reason: 'investment' });
            const flipped = run0({ assets: [home({ use: 'investment' }), etf()], debts: [loan({ forAssetId: 'a-home' })] });
            assert('the same home switched to investment: the loan comes back into FI', flipped.fiNetWorth, 800000);
        },
    },
    {
        name: 'DB11.4 a suggested link has no effect until it is confirmed (FT-R-117)',
        fn(assert) {
            const guess = loan({ forAssetId: 'a-home', forAssetSuggested: true });
            const a = run0({ assets: [home(), etf()], debts: [guess] });
            const b = run0({ assets: [home(), etf()], debts: [loan()] });
            assert('FI with a suggested link equals FI with no link', [a.fiNetWorth, a.debtsFi, a.debtsOutOfFi], [b.fiNetWorth, 600000, 0]);
            assert('loanScope: the guess is ignored', loanScope(guess, [home()]), { fi: 'yes', reason: 'suggestedLink' });
            const d = baseData([home(), etf()], [guess]);
            assert('the summary counts the pending guess so the screen can ask', fiSummary(d, { today: TODAY }).loanLinksPending, { count: 1, ids: ['l-mort'] });
            assert('confirming (the flag off) is what changes the figure', run0({ assets: [home(), etf()], debts: [{ ...guess, forAssetSuggested: false }] }).fiNetWorth, 500000);
        },
    },
    {
        name: 'DB11.5 unlinked loans, and links that point at nothing usable, leave the maths as it was',
        fn(assert) {
            const fi = (l, assets) => run0({ assets, debts: [l] }).fiNetWorth;
            assert('no fields at all (an old save)', fi({ id: 'l', balance: 100000 }, [home(), etf()]), 400000);
            assert('forAssetId null', fi(loan({ forAssetId: null, balance: 100000 }), [home(), etf()]), 400000);
            assert('a link to an asset that no longer exists', fi(loan({ forAssetId: 'gone', balance: 100000 }), [home(), etf()]), 400000);
            assert('a link to something that is not a property', fi(loan({ forAssetId: 'a-etf', balance: 100000 }), [home(), etf()]), 400000);
            assert('a link to a property whose own kind is only a guess keeps the loan in until the kind is confirmed', fi(loan({ forAssetId: 'a-home', balance: 100000 }), [home({ kindSuggested: true }), etf()]), 400000);
            assert('pendingLoanLinks ignores confirmed, unlinked and paid-off loans', pendingLoanLinks([loan({ forAssetId: 'a-home' }), loan({ id: 'x', forAssetId: null }), loan({ id: 'y', forAssetId: 'a-home', forAssetSuggested: true, balance: 0 })]), { count: 0, ids: [] });
        },
    },
    {
        name: 'DB11.6 Fire money that pays off a loan which is out of FI moves net worth, not the FI figure, and is not counted as growth',
        fn(assert) {
            const start = { assets: [home(), etf({ balance: 0 })], debts: [loan({ forAssetId: 'a-home', balance: 50000 })], sinks: [{ type: 'debt', id: 'l-mort' }] };
            const path = runPlan(start, flat({ fiNumber: 1e12, fireYear: 10000 }), { years: 1, untilFI: false }).path;
            assert('FI unchanged, net worth up 10,000, growth 0', [path[1].fiNetWorth, path[1].netWorth - path[0].netWorth, path[1].growth], [0, 10000, 0]);
        },
    },
    {
        name: 'DB11.7 an offset account is still cash with the loan in full; a live-in loan leaves FI whole, and the offset cash counts (D7 is silent on the pair)',
        fn(assert) {
            const offset = { id: 'a-off', name: 'Offset', balance: 80000, kind: 'cash', kindSuggested: false, isOffset: true };
            const p = run0({ assets: [home(), offset, etf({ balance: 0 })], debts: [loan({ forAssetId: 'a-home' })] });
            assert('cash 80,000 in FI; the loan 600,000 is in full in net worth and out of FI', [p.fiNetWorth, p.cash, p.debts, p.debtsFi, p.netWorth], [80000, 80000, 600000, 0, 380000]);
        },
    },
    {
        name: 'DB11.8 couples: all super unlocks when the younger person turns 60 (FT-R-128 2)',
        fn(assert) {
            const d = baseData([{ id: 'a-s', name: 'Super', balance: 100000, kind: 'invested', kindSuggested: false, isSuper: true }], [], { fiSettings: { multiple: 25, inflation: 2.5, expectedReturn: 7, birthYears: [1960, 1990] } });
            const at = (today) => projectNetWorth(d, { today, years: 0 }).path[0];
            assert('the older one is 66 now, the younger 36: locked', [at(TODAY).superCounted, at(TODAY).superLocked], [false, 100000]);
            assert('the year before the younger turns 60 (2049): still locked', at('2049-06-01').superCounted, false);
            assert('in the year the younger turns 60 (2050): all of it counts', [at('2050-06-01').superCounted, at('2050-06-01').superLocked], [true, 0]);
            const old = projectNetWorth({ ...d, fiSettings: { ...d.fiSettings, birthYears: [1960] } }, { today: TODAY, years: 1 }).path[0];
            assert('the older one alone: unlocked now', old.superCounted, true);
            const people = projectNetWorth({ ...d, fiSettings: { ...d.fiSettings, birthYears: [] }, people: [{ name: 'A', birthYear: 1960 }, { name: 'B', birthYear: 1990 }] }, { today: TODAY, years: 0 }).path[0];
            assert('the same rule from the people list', people.superCounted, false);
        },
    },
    {
        name: 'DB11.9 loan link suggestions come from the names, and stay unlinked when the match is unclear',
        fn(assert) {
            const one = [{ id: 'a-h', name: 'House', kind: 'appreciating' }, { id: 'a-c', name: 'Car', kind: 'depreciating' }];
            assert('Home loan with the only property', suggestLoanLink({ name: 'Home loan' }, one), 'a-h');
            assert('Mortgage with the only property', suggestLoanLink({ name: 'Westpac mortgage' }, one), 'a-h');
            assert('a car loan never links', suggestLoanLink({ name: 'Car loan' }, one), null);
            assert('a card, HELP and a personal loan never link', [suggestLoanLink({ name: 'Credit card' }, one), suggestLoanLink({ name: 'HELP' }, one), suggestLoanLink({ name: 'Personal loan' }, one)], [null, null, null]);
            assert('one property and no never-link word: links without a home word', [suggestLoanLink({ name: 'Dad' }, one), suggestLoanLink({ name: 'Thornbury' }, one)], ['a-h', 'a-h']);
            assert('finance, lease, novated and car makes never link, even with one property', [suggestLoanLink({ name: 'Car finance' }, one), suggestLoanLink({ name: 'Novated lease' }, one), suggestLoanLink({ name: 'Mazda loan' }, one), suggestLoanLink({ name: 'Toyota' }, one)], [null, null, null, null]);
            const two = [{ id: 'a-1', name: 'Smith St house', kind: 'appreciating' }, { id: 'a-2', name: 'Jones Rd unit', kind: 'appreciating' }];
            assert('several properties, a generic name: unclear', suggestLoanLink({ name: 'Home loan' }, two), null);
            assert('several properties, a name match picks one', suggestLoanLink({ name: 'Jones Rd mortgage' }, two), 'a-2');
            assert('a word that matches both is unclear', suggestLoanLink({ name: 'Smith Jones loan' }, two), null);
            const makes = [{ id: 'a-1', name: 'Mazda St house', kind: 'appreciating' }, { id: 'a-2', name: 'Thornbury unit', kind: 'appreciating' }];
            assert('a car make shared with a property name does not link', suggestLoanLink({ name: 'Mazda loan' }, makes), null);
            assert('a shared word alone does not link when the loan says nothing about a home', [suggestLoanLink({ name: 'Thornbury' }, makes), suggestLoanLink({ name: 'Mazda St' }, makes)], [null, null]);
            assert('with a home word the name match does link', suggestLoanLink({ name: 'Thornbury mortgage' }, makes), 'a-2');
            assert('no property at all', suggestLoanLink({ name: 'Mortgage' }, [{ id: 'a-c', name: 'Car', kind: 'depreciating' }]), null);
        },
    },
    {
        name: 'DB11.10 the loan link step: adds fields only where absent, suggests a link, is idempotent, keeps a confirmed link, survives a backup round trip, renames no ft- key',
        fn(assert) {
            const mk = () => ({
                assets: [{ id: 'a-h', name: 'House', balance: 500000, kind: 'appreciating' }],
                liabilities: [{ id: 'l-1', name: 'Home loan', balance: 300000 }, { id: 'l-2', name: 'Car loan', balance: 9000 }, { id: 'l-3', name: 'Mortgage', balance: 1, forAssetId: null, forAssetSuggested: false }],
            });
            const d = mk();
            assert('a save before the step needs it', needsLoanLinkMigration(d), true);
            assert('it ran', migrateLoanLinks(d), true);
            assert('the home loan is linked as a suggestion', [d.liabilities[0].forAssetId, d.liabilities[0].forAssetSuggested], ['a-h', true]);
            assert('the car loan has no link and no suggestion', [d.liabilities[1].forAssetId, d.liabilities[1].forAssetSuggested], [null, false]);
            assert('a field already there (the person left it unlinked) is kept', [d.liabilities[2].forAssetId, d.liabilities[2].forAssetSuggested], [null, false]);
            assert('names and balances are untouched, the version is stamped', [d.liabilities.map((l) => [l.name, l.balance]), d.loanLinkVersion], [[['Home loan', 300000], ['Car loan', 9000], ['Mortgage', 1]], 1]);
            const flagless = { assets: [{ id: 'a-h', name: 'House', balance: 1, kind: 'appreciating', kindSuggested: false, use: 'liveIn', useSuggested: false }], liabilities: [{ id: 'l-x', name: 'Loan', balance: 5, forAssetId: 'a-h' }] };
            migrateLoanLinks(flagless);
            assert('a link with no flag is read as suggested, not confirmed (FT-R-117)', [flagless.liabilities[0].forAssetId, flagless.liabilities[0].forAssetSuggested], ['a-h', true]);
            assert('and the maths ignores a link whose flag is missing', loanScope({ id: 'l-x', balance: 5, forAssetId: 'a-h' }, flagless.assets), { fi: 'yes', reason: 'suggestedLink' });
            const once = structuredClone(d);
            assert('idempotent: the second run does nothing and changes nothing', [migrateLoanLinks(d), d], [false, once]);
            const confirmed = mk();
            confirmed.liabilities[0].forAssetId = 'a-h'; confirmed.liabilities[0].forAssetSuggested = false;
            migrateLoanLinks(confirmed);
            assert('a confirmed link already on the save is not turned back into a guess', [confirmed.liabilities[0].forAssetId, confirmed.liabilities[0].forAssetSuggested], ['a-h', false]);
            // The chain: a migrated save exported and imported again comes back identical.
            const sample = buildSampleHousehold(TODAY).data;
            const store = new Map();
            const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
            migrateAssetDebtDetail(sample);
            runMigrationChain(sample, { storage, today: TODAY });
            assert('the chain stamps the loan link version', sample.loanLinkVersion, 1);
            const exported = JSON.parse(JSON.stringify(sample));
            const before = structuredClone(exported);
            runMigrationChain(exported, { storage, today: TODAY, isImport: true });
            assert('a backup round trip (export, import, chain again) changes nothing', exported, before);
            const old = JSON.parse(JSON.stringify(sample));
            delete old.loanLinkVersion;
            old.liabilities.forEach((l) => { delete l.forAssetId; delete l.forAssetSuggested; });
            runMigrationChain(old, { storage, today: TODAY, isImport: true });
            const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((n) => [n, v[n]])) : v));
            assert('an older backup without the fields is brought forward to the same result', canon(old), canon(before));
            assert('the backup key keeps its name', BACKUP_KEY, 'ft-backup-pre-plan');
            assert('only ft- keys were written to storage', [...store.keys()].every((k) => k.startsWith('ft-')), true);
        },
    },
];
