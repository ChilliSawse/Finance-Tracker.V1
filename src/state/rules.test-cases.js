// Test cases for the "rules" group (B8.1 to B8.3, B8.6 to B8.8; registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { DEFAULT_CATEGORIES, categoriseDescription } from './categories.js';
import { learnKeyFor, ruleKeyFor, isLearnableKey, learnFromCorrection, learnRule, applyRuleToSimilar, similarUnconfirmed } from './rule-learn.js';
import { resolveImportRow } from './import-rows.js';
import { merchantKey, categorise, categoriseDetailed, resolveCategory, removeRule, planManualMerges } from './rules.js';

const cats = DEFAULT_CATEGORIES;
const row = (o) => ({ id: 'r', date: '2026-11-10', description: 'X', amountCents: -1000, categoryId: 'other', source: 'csv', hash: 'h', ...o });

export const RULES_TEST_CASES = [
    {
        name: 'B8.1 merchantKey',
        fn(assert) {
            assert('store number and suburb dropped', merchantKey('WOOLWORTHS 1234 NEWTOWN'), 'woolworths');
            assert('two words kept', merchantKey('SQ *MELB FARMERS MKT'), 'melb farmers');
            assert('paypal prefix', merchantKey('PAYPAL *SPOTIFY'), 'spotify');
            assert('eftpos prefix', merchantKey('EFTPOS Bunnings 0412'), 'bunnings');
            assert('nothing usable', merchantKey('7-ELEVEN 123'), '');
        },
    },
    {
        name: 'B8.2 learned rules beat keywords; two-argument call unchanged',
        fn(assert) {
            const rules = [{ key: 'woolworths', categoryId: 'dining' }];
            assert('keyword alone', categoriseDescription('WOOLWORTHS 1234', cats), 'groceries');
            assert('rule wins', categoriseDescription('WOOLWORTHS 1234 NEWTOWN', cats, rules), 'dining');
            assert('categorise passes rules', categorise('WOOLWORTHS 1234', cats, rules), 'dining');
            assert('no rules is the old answer', categorise('WOOLWORTHS 1234', cats), 'groceries');
            assert('rule to a missing category ignored', categorise('WOOLWORTHS 1', cats, [{ key: 'woolworths', categoryId: 'gone' }]), 'groceries');
            assert('unknown merchant', categorise('ZZZ PTY LTD', cats, rules), 'other');
        },
    },
    {
        name: 'B8.3 FT-R-55 review status only when uncategorised',
        fn(assert) {
            const chem = resolveCategory('CHEMIST WAREHOUSE 12', null, cats, []);
            assert('keyword health is ok', chem, { categoryId: 'health', status: 'ok' });
            const unk = resolveCategory('QWERTY HOLDINGS', null, cats, []);
            assert('unknown falls to other and is review', unk, { categoryId: 'other', status: 'review' });
            const rule = resolveCategory('QWERTY HOLDINGS', null, cats, [{ key: 'qwerty', categoryId: 'health' }]);
            assert('rule hit is ok', rule, { categoryId: 'health', status: 'ok' });
            assert('rule to other is ok', resolveCategory('QWERTY HOLDINGS', null, cats, [{ key: 'qwerty', categoryId: 'other' }]).status, 'ok');
            assert('preview pick of a category is ok', resolveCategory('QWERTY HOLDINGS', 'dining', cats, []).status, 'ok');
            assert('preview left on other is review', resolveCategory('QWERTY HOLDINGS', 'other', cats, []).status, 'review');
        },
    },
    {
        name: 'B8.6 learnRule and applyRuleToSimilar',
        fn(assert) {
            const data = { rules: [] };
            const r1 = learnRule(data, 'QWERTY HOLDINGS 12', 'dining');
            assert('rule stored', data.rules, [{ key: 'qwerty holdings', categoryId: 'dining' }]);
            assert('created', r1.created, true);
            learnRule(data, 'QWERTY HOLDINGS 99', 'shopping', 'splurge');
            assert('same key updates, no duplicate', data.rules, [{ key: 'qwerty holdings', categoryId: 'shopping', bucketId: 'splurge' }]);
            assert('empty key refused', learnRule(data, '123', 'dining').ok, false);
            const u = learnRule(data, 'ABC SHOP', 'shopping');
            u.onUndo();
            assert('undo removes the new rule', data.rules.length, 1);
            assert('removeRule', removeRule(data, 'qwerty holdings'), true);

            const rule = { key: 'qwerty holdings', categoryId: 'dining', bucketId: 'splurge' };
            const rows = [
                row({ id: 'a', description: 'QWERTY HOLDINGS 1', status: 'review' }),
                row({ id: 'b', description: 'QWERTY HOLDINGS 2', status: 'ok' }),
                row({ id: 'c', description: 'QWERTY HOLDINGS 3', status: 'review', confirmed: true }),
                row({ id: 'd', description: 'OTHER PLACE', status: 'review' }),
            ];
            assert('only the unconfirmed same-merchant row', similarUnconfirmed(rule, rows).map((r) => r.id), ['a']);
            const out = applyRuleToSimilar(rule, rows);
            assert('re-categorised and ok', [out[0].categoryId, out[0].status, out[0].bucketId], ['dining', 'ok', 'splurge']);
            assert('input not mutated', rows[0].status, 'review');
            assert('idempotent', applyRuleToSimilar(rule, out).length, 0);
        },
    },
    {
        name: 'B8.7 import merge of a manual row (pure plan)',
        fn(assert) {
            const manual = row({ id: 'm1', source: 'manual', date: '2026-11-08', amountCents: -4550, hash: 'manual|m1' });
            const near = row({ id: 'm2', source: 'manual', date: '2026-11-09', amountCents: -4550, hash: 'manual|m2' });
            const bank = row({ id: 'b1', date: '2026-11-10', amountCents: -4550, hash: '2026-11-10|x|-4550' });
            const p = planManualMerges([bank], [manual, near]);
            assert('merged with the nearest date', p.merges.map((m) => m.manualId), ['m2']);
            assert('bank row left out of the add list', p.remaining.length, 0);
            assert('manual row takes the bank hash', p.merges[0].hash, bank.hash);
            const far = planManualMerges([{ ...bank, date: '2026-11-13' }], [manual]);
            assert('outside 3 days is added', [far.merges.length, far.remaining.length], [0, 1]);
            assert('different amount is added', planManualMerges([{ ...bank, amountCents: -4551 }], [manual]).merges.length, 0);
            const twice = planManualMerges([bank, { ...bank, id: 'b2' }], [near]);
            assert('one manual row merges once', [twice.merges.length, twice.remaining.length], [1, 1]);
            const re = planManualMerges([bank], [near, row({ id: 'old', hash: bank.hash })]);
            assert('a re-import (hash stored) does not merge', re.merges.length, 0);
            const rec = planManualMerges([bank], [{ ...near, reconciled: true }]);
            assert('reconciled manual row skipped', rec.merges.length, 0);
        },
    },
    {
        name: 'B8.8 apply-to-similar never touches confirmed rows',
        fn(assert) {
            const rule = { key: 'qwerty', categoryId: 'dining' };
            const confirmed = row({ id: 'k', description: 'QWERTY 5', status: 'ok', categoryId: 'other' });
            assert('confirmed other row untouched', applyRuleToSimilar(rule, [confirmed]).length, 0);
        },
    },
    {
        name: 'DB9.1 a correction learns a merchant rule; the next import gets it as by rule',
        fn(assert) {
            const before = row({ id: 'q1', description: 'ZEDCO 1234 NEWTOWN', categoryId: 'other', status: 'review', amountCents: -500 });
            const key = learnKeyFor(before, 'dining', cats);
            assert('key from the stored description', key, 'zedco');
            const data = { rules: [], categories: cats };
            const res = learnRule(data, before.description, 'dining');
            assert('rule stored', [res.ok, data.rules], [true, [{ key: 'zedco', categoryId: 'dining' }]]);
            const next = categoriseDetailed('ZEDCO 77 OTHERTOWN', cats, data.rules);
            assert('next import: the user category, by rule', [next.categoryId, next.by], ['dining', 'rule']);
            assert('and it counts as confirmed (FT-R-55)', resolveImportRow('ZEDCO 77', -100, undefined, { categories: cats, rules: data.rules }, null), { categoryId: 'dining', status: 'ok' });
            const again = learnRule(data, 'ZEDCO 5', 'travel');
            assert('a second correction replaces, not duplicates', [data.rules.length, data.rules[0].categoryId, again.created], [1, 'travel', false]);
            again.onUndo();
            assert('undo restores the earlier rule', data.rules[0].categoryId, 'dining');
        },
    },
    {
        name: 'DB9.2 what does not learn: empty or rail key, same category, other, manual, income, transfer',
        fn(assert) {
            const base = row({ id: 'n', description: 'ZEDCO 12', categoryId: 'other', status: 'review', amountCents: -500 });
            const k = (o, to = 'dining') => learnKeyFor({ ...base, ...o }, to, cats);
            assert('baseline learns', k({}), 'zedco');
            assert('empty description', k({ description: '' }), '');
            assert('digits only', k({ description: '7-ELEVEN 123' }), '');
            assert('card rail text only', k({ description: 'VISA DEBIT PURCHASE CARD 1234' }), '');
            assert('bank wording only', [k({ description: 'INTERNET TRANSFER 5' }), k({ description: 'Direct Debit 123456' }), k({ description: 'BPAY PAYMENT 9' })], ['', '', '']);
            assert('isLearnableKey', [isLearnableKey(''), isLearnableKey('transfer payment'), isLearnableKey('zedco'), isLearnableKey('bank zedco')], [false, false, true, true]);
            assert('same category is no correction', k({ categoryId: 'dining' }), '');
            assert('to other learns nothing', k({}, 'other'), '');
            assert('to a missing category learns nothing', k({}, 'gone'), '');
            assert('a manual row does not learn', [k({ source: 'manual' }), k({ source: 'sample' })], ['', '']);
            assert('income does not learn', k({ amountCents: 500 }), '');
            assert('a transfer row, or a move to transfer, does not learn', [k({ categoryId: 'transfer' }), k({}, 'transfer')], ['', '']);
        },
    },
    {
        name: 'DB9.3 offer counts only unconfirmed same-key rows; transfers and splits never change',
        fn(assert) {
            const rule = { key: 'zedco', categoryId: 'dining' };
            const rows = [
                row({ id: 'a', description: 'ZEDCO 1', status: 'review' }),
                row({ id: 'b', description: 'ZEDCO 2 SUBURB', status: 'review' }),
                row({ id: 'c', description: 'ZEDCO 3', status: 'ok' }),
                row({ id: 'd', description: 'ZEDCO 4', status: 'review', confirmed: true }),
                row({ id: 'e', description: 'QWERTY 5', status: 'review' }),
                row({ id: 'f', description: 'ZEDCO 6', status: 'review', categoryId: 'transfer' }),
                row({ id: 'g', description: 'ZEDCO 7', status: 'review', splits: [{ categoryId: 'dining', amountCents: -500 }] }),
            ];
            assert('only a and b are offered', similarUnconfirmed(rule, rows).map((r) => r.id), ['a', 'b']);
            const out = applyRuleToSimilar(rule, rows);
            assert('applied rows get the category and ok', out.map((r) => [r.id, r.categoryId, r.status]), [['a', 'dining', 'ok'], ['b', 'dining', 'ok']]);
            assert('inputs untouched', rows[0].status, 'review');
        },
    },
    {
        name: 'DB9.6 broad keys: processors, BNPL, bank words; a key never catches a different merchant',
        fn(assert) {
            const none = ['PAYPAL 4029357733', 'AFTERPAY 99812', 'ZIP PAY 1234', 'ZIPPAY 77', 'KLARNA 12', 'PAYPAL AUSTRALIA 1234', 'AFTERPAY AU PTY LTD', 'Osko payment 1234', 'NETBANK TFR 55', 'Fast transfer', 'Pay Anyone', 'Repayment 1234', 'Member payment', 'Purchase authorisation 9', 'Withdrawal 12'];
            assert('no merchant, no key', none.map(ruleKeyFor), none.map(() => ''));
            assert('a key that starts with bank wording is refused, so payments to a payee never learn', ['Transfer Zarnok Quill', 'Payment Zarnok Plumbing', 'Osko Zarnok Quill 55', 'Transfer to Zarnok Quill', 'Payment to Zarnok Plumbing', 'Card payment Zarnok'].map(ruleKeyFor), ['', '', '', '', '', '']);
            assert('a processor with a merchant keeps the merchant', ruleKeyFor('PAYPAL *ZARNOKSHOP 4029357733'), 'zarnokshop');
            const catches = (src, other) => { const k = ruleKeyFor(src); return !!k && categoriseDetailed(other, cats, [{ key: k, categoryId: 'dining' }]).by === 'rule'; };
            assert('a merchant key does not catch a different merchant', [catches('ZARNOK CAFE 12', 'ZARNOK HARDWARE 3'), catches('ZARNOK CAFE 12', 'ZARNOK CAFE 99')], [false, true]);
        },
    },
    {
        name: 'DB9.7 spending moved to income learns nothing; a move to other removes the old rule, with undo; apply skips money-in and suggestions',
        async fn(assert) {
            const withInc = [...cats, { id: 'wages', kind: 'income', keywords: [] }, { id: 'invest', kind: 'transfer', keywords: [] }];
            const base = row({ id: 'n', description: 'ZEDCO 12', categoryId: 'dining', status: 'ok', amountCents: -500 });
            assert('to an income-kind category', [learnKeyFor(base, 'wages', withInc), learnKeyFor(base, 'income', withInc), learnKeyFor(base, 'invest', withInc)], ['', '', '']);
            const data = { categories: withInc, rules: [{ key: 'zedco', categoryId: 'dining' }, { key: 'qwerty', categoryId: 'health' }] };
            const res = await learnFromCorrection(data, base, 'other');
            assert('rule with that exact key removed', data.rules.map((r) => r.key), ['qwerty']);
            res.onUndo();
            assert('undo puts it back in place', data.rules.map((r) => r.key), ['zedco', 'qwerty']);
            const away = [...withInc, { id: 'super', kind: 'transfer', keywords: [] }];
            assert('leaving a transfer-kind category learns nothing', [learnKeyFor({ ...base, categoryId: 'super' }, 'dining', away), learnKeyFor({ ...base, categoryId: 'super' }, 'other', away)], ['', '']);
            assert('no rule for the key: nothing to do', await learnFromCorrection({ categories: withInc, rules: [] }, base, 'other'), null);
            const rule = { key: 'zedco', categoryId: 'dining' };
            const rows = [
                row({ id: 'a', description: 'ZEDCO 1', status: 'review', referenceSuggested: true, refConfidence: 'high', refId: 'x' }),
                row({ id: 'b', description: 'ZEDCO 2', status: 'review', amountCents: 500 }),
                row({ id: 'c', description: 'ZEDCO 3', status: 'review', transferSuggested: true }),
                row({ id: 'd', description: 'ZEDCO 4', status: 'review', bucketSuggested: true }),
                row({ id: 'e', description: 'ZEDCO 5', status: 'review', categoryId: 'invest' }),
            ];
            assert('only the plain money-out row', similarUnconfirmed(rule, rows, withInc).map((r) => r.id), ['a']);
            const out = applyRuleToSimilar(rule, rows, withInc)[0];
            assert('reference fields dropped', [out.referenceSuggested, out.refConfidence, out.refId, out.status], [undefined, undefined, undefined, 'ok']);
        },
    },
    {
        name: 'DB9.4 a learned rule beats a reference merchant',
        fn(assert) {
            const ref = { sources: { merchants: 'cache' }, categories: [], merchants: [{ id: 'zed', key: 'zed', type: 'merchant', categoryId: 'transport', confidence: 'high', match: 'word', patterns: ['zedco'] }] };
            const d = (rules) => ({ categories: cats, rules });
            assert('reference alone suggests it', resolveImportRow('ZEDCO 12', -100, undefined, d([]), ref).categoryId, 'transport');
            const data = { rules: [], categories: cats };
            learnRule(data, 'ZEDCO 12', 'dining');
            const r = resolveImportRow('ZEDCO 99', -100, undefined, d(data.rules), ref);
            assert('the learned rule wins, confirmed', [r.categoryId, r.status, r.referenceSuggested || false], ['dining', 'ok', false]);
        },
    },
];
