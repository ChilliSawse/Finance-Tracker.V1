// Test cases for the "sorting" group (DB2: stronger merchantKey, rule re-keying, keyword boundaries, own-account transfers).
// Synthetic, made-up strings only. Shape: { name, fn(assert) }, assert(label, actual, expected).

import { DEFAULT_CATEGORIES, merchantKey, categoriseDescription } from './categories.js';
import { migrateRuleKeys, needsRulesMigration } from './rules-migration.js';
import { runMigrationChain } from './migration-chain.js';
import { looksLikeOwnTransfer, transferSuggestion } from '../calc/transfers.js';
import { resolveImportRow } from './rules.js';

const cats = DEFAULT_CATEGORIES;
const cat = (d) => categoriseDescription(d, cats);
const clone = (v) => JSON.parse(JSON.stringify(v));

export const SORTING_TEST_CASES = [
    {
        name: 'DB2.1 merchantKey strips rail text and keeps the brand',
        fn(assert) {
            assert('visa debit purchase card', merchantKey('VISA DEBIT PURCHASE CARD 1234 WOOLWORTHS 5522'), 'woolworths');
            assert('NAB-style lead', merchantKey('V2878 06/11 ALDI STORES 4410 SOMEWHERE'), 'aldi stores');
            assert('NAB-style lead, brand only', merchantKey('V2878 06/11 ALDI 4410'), 'aldi');
            assert('direct debit with a reference', merchantKey('Direct Debit 123456 AGL SALES PTY LIM'), 'agl sales');
            assert('eftpos debit with a card reference', merchantKey('EFTPOS DEBIT ~448813HJs BUNNINGS 0412'), 'bunnings');
            assert('card x suffix and value date dropped', merchantKey('BAKERY ONE CARD XX1234 VALUE DATE 06/11/2026'), 'bakery one');
            assert('big w keeps its one-letter word', merchantKey('BIG W 0119'), 'big w');
            assert('old cases: store number', merchantKey('WOOLWORTHS 1234 NEWTOWN'), 'woolworths');
            assert('old cases: square prefix', merchantKey('SQ *MELB FARMERS MKT'), 'melb farmers');
            assert('old cases: paypal prefix', merchantKey('PAYPAL *SPOTIFY'), 'spotify');
            assert('old cases: nothing usable', merchantKey('7-ELEVEN 123'), '');
            assert('a bare leading SP is not a wallet prefix', merchantKey('SP SPORTS 12'), 'sp sports');
            assert('dd prefix needs the star', [merchantKey('DD *GYMCO 12'), merchantKey('DD GYMCO 12')], ['gymco', 'dd gymco']);
            for (const s of ['VISA DEBIT PURCHASE CARD 1234 WOOLWORTHS 5522', 'V2878 06/11 ALDI STORES 4410', 'BIG W 0119', 'Direct Debit 12 AGL SALES', 'visa debit']) {
                assert('idempotent: ' + s, merchantKey(merchantKey(s)), merchantKey(s));
            }
        },
    },
    {
        name: 'DB2.2 default keywords: false hits gone',
        fn(assert) {
            assert('CURRENT ACCOUNT FEE is not rent', cat('CURRENT ACCOUNT FEE'), 'other');
            assert('PARENT TEACHER NIGHT is not rent', cat('PARENT TEACHER NIGHT'), 'other');
            assert('COCA COLA is not ola', cat('COCA COLA AMATIL'), 'other');
            assert('SHELLHARBOUR is not shell', cat('SHELLHARBOUR POOL'), 'other');
            assert('GYMPIE alone is not gym', cat('GYMPIE MARKET'), 'other');
            assert('EAGLE BOYS is not agl', cat('EAGLE BOYS 1234'), 'other');
            assert('POTATO SHED is not ato', cat('POTATO SHED 12'), 'other');
            assert('ALDINGA is not aldi', cat('ALDINGA BEACH'), 'other');
            assert('STEAMBOAT is not steam', cat('STEAMBOAT PLACE'), 'other');
        },
    },
    {
        name: 'DB2.3 default keywords: every existing correct hit still works',
        fn(assert) {
            const hits = [
                ['RENT PAYMENT', 'housing'], ['RENTAL BOND', 'housing'], ['RENTS 12', 'housing'],
                ['OLA CABS 12', 'transport'], ['SHELL 2144', 'transport'], ['BP 1234', 'transport'], ['BP.', 'transport'],
                ['PUREGYM 12', 'fitness'], ['24 HR GYM', 'fitness'], ['GYMS R US', 'fitness'],
                ['AGL SALES PTY LIM', 'utilities'], ['AGL', 'utilities'],
                ['MCDONALDS 1234', 'dining'], ['DOMINOS 12', 'dining'], ['HUNGRY JACKS 12', 'dining'],
                ['WATER CORPORATION', 'utilities'], ['HCFHEALTH', 'health'], ['MEDICARETR 12', 'health'],
                ['DTSOPAL4 12', 'transport'], ['LINKTGO 1', 'transport'], ['DIDIMOBILITY 3', 'transport'],
                ['PAYPAL *SPOTIFY', 'entertainment'], ['SHEINCOM 12', 'shopping'], ['COLES 0123', 'groceries'],
                ['IGA 1234', 'groceries'], ['NIB 12', 'health'], ['ATO TAX REFUND', 'income'], ['STAN 12', 'entertainment'],
                ['BIG W 0119', 'shopping'], ['TARGET 12', 'shopping'], ['TELSTRA 12', 'phone-internet'], ['AMAZON AU 12', 'shopping'],
            ];
            for (const [d, id] of hits) assert(d, cat(d), id);
        },
    },
    {
        name: 'DB2.4 user-typed keywords keep substring matching',
        fn(assert) {
            const mine = [{ id: 'mine', name: 'Mine', keywords: ['rent'] }, { id: 'other', name: 'Other', keywords: [] }];
            assert('a keyword in a user category stays a substring', categoriseDescription('CURRENT ACCOUNT', mine), 'mine');
            const edited = clone(cats).map((c) => (c.id === 'groceries' ? { ...c, keywords: ['wool'] } : c));
            assert('an edited default keyword is a substring too', categoriseDescription('SWOOLEN SHOP', edited), 'groceries');
        },
    },
    {
        name: 'DB2.5 rules migration: re-key, collision keeps the newest, idempotent, keeps rail-text keys',
        fn(assert) {
            const d = { rules: [
                { key: 'visa debit', categoryId: 'dining' },
                { key: 'woolworths', categoryId: 'groceries' },
                { key: 'eftpos bunnings', categoryId: 'shopping' },
                { key: 'bunnings', categoryId: 'groceries', bucketId: 'daily' },
            ] };
            assert('pending', needsRulesMigration(d), true);
            assert('changed', migrateRuleKeys(d), true);
            assert('result', d.rules, [
                { key: 'visa debit', categoryId: 'dining' },
                { key: 'woolworths', categoryId: 'groceries' },
                { key: 'bunnings', categoryId: 'groceries', bucketId: 'daily' },
            ]);
            assert('second run is a no-op', [needsRulesMigration(d), migrateRuleKeys(d)], [false, false]);
            const e = { rules: [{ key: 'agl sales', categoryId: 'housing' }, { key: 'direct debit agl sales', categoryId: 'utilities' }] };
            migrateRuleKeys(e);
            assert('the later rule wins, with its own category', e.rules, [{ key: 'agl sales', categoryId: 'utilities' }]);
            assert('no rules at all', [needsRulesMigration({}), migrateRuleKeys({ rules: [] })], [false, false]);
            const x = { rules: [null, { categoryId: 'a' }, { key: 'eftpos zed', categoryId: 'a' }] };
            migrateRuleKeys(x);
            assert('junk rows survive', x.rules, [null, { categoryId: 'a' }, { key: 'zed', categoryId: 'a' }]);
        },
    },
    {
        name: 'DB2.6 rules migration in the chain, and the backup round trip keeps the rules',
        fn(assert) {
            const d = { dataVersion: 2, savingModel: { version: 1 }, assetDebtVersion: 1, allocation: [{ name: 'Daily', percentage: 100 }],
                incomeSources: [{ name: 'Job', incomeType: 'salaried', withholding: { claimsTaxFree: true } }],
                rules: [{ key: 'eftpos zed', categoryId: 'dining' }, { key: 'zed', categoryId: 'shopping' }] };
            runMigrationChain(d, { storage: null, modules: [] });
            const storage = { getItem: () => null, setItem() {} };
            const r = runMigrationChain(d, { raw: JSON.stringify({ financeData: d }), storage, source: 'import' });
            assert('not aborted, changed', [r.aborted, r.changed], [false, true]);
            assert('collapsed to the newer', d.rules, [{ key: 'zed', categoryId: 'shopping' }]);
            const round = JSON.parse(JSON.stringify({ financeData: d })).financeData;
            const again = runMigrationChain(round, { raw: null, storage, source: 'import' });
            assert('a backup round trip keeps the rules and changes nothing', [again.changed, round.rules], [false, [{ key: 'zed', categoryId: 'shopping' }]]);
        },
    },
    {
        name: 'DB2.7 a rule learned from a rail-text description matches the brand, not every card line',
        fn(assert) {
            const rules = [{ key: merchantKey('VISA DEBIT PURCHASE CARD 1234 ZEDCO 5522'), categoryId: 'shopping' }];
            assert('rule key', rules[0].key, 'zedco');
            assert('matches another line', categoriseDescription('V2878 06/11 ZEDCO 12', cats, rules), 'shopping');
            assert('does not match every visa debit line', categoriseDescription('VISA DEBIT PURCHASE CARD 1234 QWERTY 5522', cats, rules), 'other');
        },
    },
    {
        name: 'DB2.8 own-account transfer wording',
        fn(assert) {
            const yes = [['Transfer to savings account', -5000], ['NETBANK Transfer from Everyday', 5000], ['Internal Transfer', -100], ['INTERNET TRANSFER 123', 100],
                ['Funds TFER to 123', -5], ['Osko payment to own account', -9], ['PayID to myself', -9], ['COMMSEC 12', -2000], ['RAIZ INVEST', -50], ['Super contribution', -300]];
            for (const [d, a] of yes) assert('transfer: ' + d, looksLikeOwnTransfer(d, a), true);
            const no = [['OSKO PAYMENT LANDLORD', -9], ['Transfer to Fire fan shop', 5000], ['COMMSEC DIVIDEND', 5000], ['WOOLWORTHS 12', -5], ['TRANSFERWISE', -5], ['STAKE AUSSIE', -5]];
            for (const [d, a] of no) assert('not a transfer: ' + d, looksLikeOwnTransfer(d, a), false);
            assert('suggestion: no bucket, left in review', transferSuggestion({ description: 'Transfer to savings', amountCents: -100 }, { allocation: [] }), { categoryId: 'transfer', status: 'review' });
            assert('a learned rule still wins', transferSuggestion({ description: 'Transfer to savings', amountCents: -100 }, { categoryBy: 'rule' }), null);
            const data = { categories: cats, allocation: [], rules: [] };
            assert('import resolves as a transfer, not spending', resolveImportRow('INTERNAL TRANSFER', -4000, undefined, data), { categoryId: 'transfer', status: 'review' });
            assert('a preview pick wins', resolveImportRow('INTERNAL TRANSFER', -4000, 'dining', data).categoryId, 'dining');
        },
    },
];
