// Test cases for the "sorting" group (DB2: stronger merchantKey, lookup-time rule matching, keyword boundaries,
// own-account transfer wording). Synthetic, made-up strings only. Shape: { name, fn(assert) }, assert(label, actual, expected).

import { DEFAULT_CATEGORIES, merchantKey, categoriseDescription, categoriseDetailed } from './categories.js';
import { looksLikeOwnTransfer, transferSuggestion } from '../calc/transfer-suggest.js';
import { resolveImportRow } from './import-rows.js';
import { learnRule, similarUnconfirmed } from './rules.js';

const cats = DEFAULT_CATEGORIES;
const cat = (d) => categoriseDescription(d, cats);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Wide list of made-up shapes: rail text, punctuation, wallet prefixes, digits, short words, empties.
const SHAPES = [
    'VISA DEBIT PURCHASE CARD 1234 ZEDCO 5522', 'V2878 06/11 ALDI STORES 4410 SOMEWHERE', 'V2878 06/11 ZEDCO 4410', 'BIG W 0119', 'Big W',
    'Direct Debit 123456 AGL SALES PTY LIM', 'direct debit', 'visa debit', 'eftpos', 'pos', 'purchase', 'contactless',
    'PURCHASE, ZEDCO', 'Purchase: Zedco', 'EFTPOS, ZEDCO STORES', 'Contactless; Zedco', 'VISA PURCHASE - PURCHASE ZEDCO', 'POS - CAFE ROMA',
    '- PURCHASE CAFE ROMA', 'Card Purchase - Tap and Pay Zedco', 'CARD PURCHASE WITH PIN ZEDCO 0445', 'DEBIT CARD PURCHASE ZEDCO 6302 AUS',
    'RECURRING PAYMENT ZEDCO.COM', 'SQ *ZEDCO CAFE', 'DD *ZEDCO', 'LGC*ZEDCO SHOP', 'PAYPAL *ZEDCO 12', 'eftpos sq *zedco', 'SP ZEDCO 12', 'sp sports',
    'EFTPOS DEBIT ~448813HJs ZEDCO 0412', 'EFTPOS DEBIT 448813 ZEDCO', 'ZEDCO CARD XX1234 VALUE DATE 06/11/2026', "McZed's 12", 'COCA-COLA ZED', 'ZED.COM.AU',
    '7-ELEVEN 123', 'MR J SMITH', 'DR K NGUYEN', 'A B C', 'ZEDCO', 'zedco zed zed zed', '12 34 56', '', '   ', '***', '--', 'purchase purchase purchase',
    'tap and pay', 'tap and go ZEDCO', 'card x', 'v1234 06/11', '06/11 ZEDCO', 'PURCHASE 06/11 ZEDCO 12', 'EFTPOS PURCHASE 06/11 ZEDCO',
];

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
            assert('old cases: joined words', [merchantKey('COCA-COLA ZED'), merchantKey("MCZED'S 12")], ['cocacola zed', 'mczeds']);
            assert('a bare leading SP is not a wallet prefix', merchantKey('SP SPORTS 12'), 'sp sports');
            assert('dd and lgc prefixes need the star', [merchantKey('DD *GYMCO 12'), merchantKey('DD GYMCO 12'), merchantKey('LGC*ZEDCO 1')], ['gymco', 'dd gymco', 'zedco']);
        },
    },
    {
        name: 'DB2.1b merchantKey: punctuation between rail text and the name (D5 4.2 step 2)',
        fn(assert) {
            for (const s of ['PURCHASE, ZEDCO', 'Purchase: Zedco', 'EFTPOS, ZEDCO', 'Contactless; Zedco', 'VISA PURCHASE - PURCHASE ZEDCO', '- PURCHASE ZEDCO', 'Card Purchase - Tap and Pay Zedco', 'POS - ZEDCO']) {
                assert(s, merchantKey(s), 'zedco');
            }
        },
    },
    {
        name: 'DB2.1c merchantKey: no general one-letter word (names with initials stay apart)',
        fn(assert) {
            assert('MR J SMITH and MR J BROWN differ', [merchantKey('MR J SMITH'), merchantKey('MR J BROWN')], ['mr smith', 'mr brown']);
            assert('DR K NGUYEN and DR K PATEL differ', [merchantKey('DR K NGUYEN'), merchantKey('DR K PATEL')], ['dr nguyen', 'dr patel']);
            assert('big w is the one named case', [merchantKey('BIG W 12'), merchantKey('BIG X 12')], ['big w', 'big']);
        },
    },
    {
        name: 'DB2.1d merchantKey is idempotent over a wide list of shapes, and over a generated mix',
        fn(assert) {
            const bad = SHAPES.filter((s) => merchantKey(merchantKey(s)) !== merchantKey(s));
            assert('every listed shape', bad, []);
            const pool = ['purchase', 'eftpos', 'visa', 'debit', 'card', 'pos', 'direct', 'tap', 'and', 'pay', 'zedco', 'big', 'w', 'a', '12', '06/11', 'v1234', '-', ',', ':', '*', 'sq', 'dd', 'x1234', "o'zed", 'zed.com'];
            let seed = 7;
            const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
            const failures = [];
            for (let i = 0; i < 1500; i++) {
                const n = 1 + (next() % 6);
                const s = Array.from({ length: n }, () => pool[next() % pool.length]).join(next() % 3 ? ' ' : '');
                const k = merchantKey(s);
                if (merchantKey(k) !== k) failures.push(s);
            }
            assert('generated mixes', failures.slice(0, 3), []);
        },
    },
    {
        name: 'DB2.2 default keywords: false hits gone',
        fn(assert) {
            const none = ['CURRENT ACCOUNT FEE', 'PARENT TEACHER NIGHT', 'COCA COLA AMATIL', 'SHELLHARBOUR POOL', 'GYMPIE MARKET', 'EAGLE BOYS 1234', 'POTATO SHED 12',
                'ALDINGA BEACH', 'MISTEAMS 12', 'SEA SHELLS 12', 'ATOS 12', 'RACING CLUB'];
            for (const d of none) assert(d, cat(d), 'other');
        },
    },
    {
        name: 'DB2.3 default keywords: every existing correct hit still works, joined forms too',
        fn(assert) {
            const hits = [
                ['RENT PAYMENT', 'housing'], ['RENTAL BOND', 'housing'], ['RENTS 12', 'housing'], ['RENTPAY 12', 'housing'],
                ['OLA CABS 12', 'transport'], ['SHELL 2144', 'transport'], ['BP 1234', 'transport'], ['BP.', 'transport'],
                ['PUREGYM 12', 'fitness'], ['24 HR GYM', 'fitness'], ['GYMS R US', 'fitness'], ['GYMNASIUM CLUB', 'fitness'],
                ['AGL SALES PTY LIM', 'utilities'], ['AGL', 'utilities'], ['AGLENERGY 12', 'utilities'],
                ['MCDONALDS 1234', 'dining'], ['DOMINOS 12', 'dining'], ['HUNGRY JACKS 12', 'dining'], ['KFCTHORNBURY 12', 'dining'], ['KFC 12', 'dining'],
                ['WATER CORPORATION', 'utilities'], ['HCFHEALTH', 'health'], ['MEDICARETR 12', 'health'],
                ['DTSOPAL4 12', 'transport'], ['LINKTGO 1', 'transport'], ['DIDIMOBILITY 3', 'transport'],
                ['PAYPAL *SPOTIFY', 'entertainment'], ['SHEINCOM 12', 'shopping'], ['COLES 0123', 'groceries'],
                ['IGA 1234', 'groceries'], ['NIB 12', 'health'], ['ATO TAX REFUND', 'income'], ['STAN 12', 'entertainment'],
                ['BIG W 0119', 'shopping'], ['TELSTRA 12', 'phone-internet'], ['AMAZON AU 12', 'shopping'],
                ['STEAMGAMES.COM', 'entertainment'], ['KAYOSPORTS', 'entertainment'], ['TARGETAUSTRALIA', 'shopping'], ['MYERONLINE', 'shopping'],
                ['NBNCO 12', 'phone-internet'], ['TPGINTERNET', 'phone-internet'], ['QBEINSURANCE', 'insurance'], ['STRATAPLAN 12', 'housing'],
                ['IKEA 12', 'shopping'], ['BCF 12', 'shopping'], ['TEMU.COM', 'shopping'],
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
        name: 'DB2.5 old rules keep matching at lookup time, and nothing is rewritten',
        fn(assert) {
            const rules = [
                { key: 'dd doordash', categoryId: 'shopping' },      // learned from DD *DOORDASH under the old key
                { key: 'lgc officeworks', categoryId: 'dining' },
                { key: 'purchase zedco', categoryId: 'travel' },     // learned from PURCHASE, ZEDCO before the fix
                { key: 'sp sports', categoryId: 'travel' },
                { key: 'big', categoryId: 'health' },                // old key of BIG W 0119
            ];
            const before = clone(rules);
            const by = (d) => categoriseDetailed(d, cats, rules);
            assert('DD *DOORDASH', [by('DD *DOORDASH 12').by, by('DD *DOORDASH 12').categoryId], ['rule', 'shopping']);
            assert('LGC*OFFICEWORKS', by('LGC*OFFICEWORKS 4').categoryId, 'dining');
            assert('PURCHASE, ZEDCO', by('PURCHASE, ZEDCO 7').categoryId, 'travel');
            assert('plain ZEDCO now matches the same rule', by('ZEDCO 7').categoryId, 'travel');
            assert('a bare SP line matches the stored sp key', by('SP SPORTS 12').categoryId, 'travel');
            assert('BIG W line matches the old big rule', by('BIG W 0119').categoryId, 'health');
            assert('rules array untouched', rules, before);
            const wide = (key, d) => categoriseDetailed(d, cats, [{ key, categoryId: 'shopping' }]).by;
            assert('paypal australia does not catch AUSTRALIA POST', wide('paypal australia', 'AUSTRALIA POST 3071'), 'none');
            assert('zip pay does not catch PAY ANYONE', wide('zip pay', 'PAY ANYONE J SMITH'), 'none');
            assert('zip water does not catch a water line', wide('zip water', 'WATERLINE 12'), 'none');
            assert('sp builders / tyro payments / ls travel / sq cafe do not catch the second word', [wide('sp builders', 'BUILDERS 12'), wide('tyro payments', 'PAYMENTS 1'), wide('ls travel', 'TRAVEL 1'), wide('sq zedshop', 'ZEDSHOP 1')], ['none', 'none', 'none', 'none']);
            assert('dd and lgc keys still match', [wide('dd doordash', 'DOORDASH 12'), wide('lgc officeworks', 'OFFICEWORKS 1')], ['rule', 'rule']);
            const data = { rules: [] };
            learnRule(data, 'PURCHASE, ZEDCO', 'dining');
            assert('a rule learned now still matches', categoriseDescription('PURCHASE, ZEDCO 7', cats, data.rules), 'dining');
            const rows = [{ id: 'a', description: 'PURCHASE, ZEDCO 9', status: 'review' }, { id: 'b', description: 'OTHER SHOP', status: 'review' }];
            assert('similarUnconfirmed uses the same matching', similarUnconfirmed(rules[2], rows).map((r) => r.id), ['a']);
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
        name: 'DB2.8 own-account wording: out only, evidence needed, never the category',
        fn(assert) {
            const yes = [['Internal Transfer', -100], ['Transfer between accounts', -5], ['Osko payment to own account', -9], ['PayID to myself', -9],
                ['Transfer to savings account', -5000], ['INTERNET TRANSFER SAVINGS', -100], ['COMMSEC 12', -2000], ['RAIZ INVEST', -50],
                ['Super contribution', -300], ['AUSTRALIANSUPER 12345', -300], ['Australian Super', -300], ['STAKE AU', -20]];
            for (const [d, a] of yes) assert('guess: ' + d, looksLikeOwnTransfer(d, a), true);
            const no = [['Transfer To J Smith rent', -9], ['TRANSFER TO ZED AGENCY RENT', -9], ['INTERNET TRANSFER J SMITH', -9], ['OSKO PAYMENT LANDLORD', -9],
                ['TRANSFER FROM ACME PTY LTD WAGES', 5000], ['Transfer from savings', 5000], ['Internal Transfer', 100], ['COMMSEC DIVIDEND', 5000],
                ['WOOLWORTHS 12', -5], ['TRANSFERWISE', -5], ['STAKE AUSSIE', -5]];
            for (const [d, a] of no) assert('no guess: ' + d, looksLikeOwnTransfer(d, a), false);
            const data = { categories: cats, allocation: [], rules: [] };
            assert('the category and spending status stay, with the flag', resolveImportRow('INTERNAL TRANSFER', -4000, undefined, data),
                { categoryId: 'other', status: 'review', transferSuggested: true });
            assert('never a transfer category from wording', resolveImportRow('COMMSEC 12', -4000, undefined, data).categoryId !== 'transfer', true);
            assert('a keyword hit is never overridden', resolveImportRow('TRANSFER TO OWN ACCOUNT RENT', -4000, undefined, data),
                { categoryId: 'housing', status: 'ok' });
            assert('income keyword on a credit is untouched', resolveImportRow('TRANSFER FROM ACME PTY LTD WAGES', 400000, undefined, data).transferSuggested, undefined);
            assert('a learned rule wins', resolveImportRow('INTERNAL TRANSFER', -4000, undefined, { ...data, rules: [{ key: 'internal transfer', categoryId: 'dining' }] }).categoryId, 'dining');
            assert('a preview pick wins', resolveImportRow('INTERNAL TRANSFER', -4000, 'dining', data), { categoryId: 'dining', status: 'ok' });
            assert('the bucket-label path is unchanged', resolveImportRow('Transfer to Fire', -4000, undefined, { ...data, allocation: [{ id: 'fire', bankLabel: 'Fire' }] }),
                { categoryId: 'transfer', bucketId: 'fire', bucketSuggested: true, status: 'review' });
            assert('transferSuggestion itself has no wording path', transferSuggestion({ description: 'INTERNAL TRANSFER', amountCents: -1 }, { allocation: [] }), null);
        },
    },
];
