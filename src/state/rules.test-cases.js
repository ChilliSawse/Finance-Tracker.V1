// Test cases for the "rules" group (B8.1 to B8.3, B8.6 to B8.8; registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { DEFAULT_CATEGORIES, categoriseDescription } from './categories.js';
import { merchantKey, categorise, resolveCategory, learnRule, removeRule, applyRuleToSimilar, similarUnconfirmed, planManualMerges } from './rules.js';

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
];
