// Test cases for the "income-other" group (A12b). Pure: the delete guard, the Self-employed / Variable
// sheet mapping, income events and the tax details. Shape: { name, fn(assert) }.

import {
    canRemoveIncomeSource, removeIncomeSource, otherIncomeFields, otherIncomeValues, applyOtherIncome,
    applyEvent, removeEvent, applyTaxDetails, hasPayslipJobOffer, declinePayslipJobOffer, acceptPayslipJobWithUndo,
    openOtherIncomeSheet,
} from './income-other.js';
import { store } from '../state/store.js';


const flagged = () => ({
    name: 'Cafe', incomeType: 'selfEmployed', paySchedule: 'fortnightly', invoicedPayPostTax: 2000, taxRemoved: 500,
    basis: 'selfEmployed', migrationPrompt: 'payslip-job', withholding: { claimsTaxFree: true, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0 },
});

const two = () => ({
    primaryIncomeIndex: 1,
    incomeSources: [
        { id: 'a', name: 'Cafe', incomeType: 'selfEmployed', paySchedule: 'weekly', invoicedPayPostTax: 900, taxRemoved: 100 },
        { id: 'b', name: 'Gigs', incomeType: 'variable', incomeEvents: [], baseHourlyRate: 30 },
    ],
});

export const INCOME_OTHER_TEST_CASES = [
    { name: 'A12b.1 the last income source cannot be deleted (guard kept as sheet validation)', fn(assert) {
        const one = { incomeSources: [{ name: 'Only' }] };
        assert('last source refused', canRemoveIncomeSource(one, 0) !== '', true);
        const res = removeIncomeSource(one, 0);
        assert('not removed', [res.ok, one.incomeSources.length], [false, 1]);
        assert('a missing index is refused', canRemoveIncomeSource(two(), 5) !== '', true);
        assert('two sources can lose one', canRemoveIncomeSource(two(), 0), '');
    } },
    { name: 'A12b.2 delete keeps the main income pointing at the same source, and Undo restores both', fn(assert) {
        const d = two();
        const res = removeIncomeSource(d, 0);
        assert('removed', [res.ok, d.incomeSources.length, d.primaryIncomeIndex], [true, 1, 0]);
        res.onUndo();
        assert('undone', [d.incomeSources.map((s) => s.id), d.primaryIncomeIndex], [['a', 'b'], 1]);
        const d2 = two();
        removeIncomeSource(d2, 1);
        assert('removing the main one falls back to the first', d2.primaryIncomeIndex, 0);
    } },
    { name: 'A12b.3 the Self-employed sheet round-trips pay figures; Variable keeps its events', fn(assert) {
        const d = two();
        assert('self-employed asks for pay figures', otherIncomeFields(d.incomeSources[0]).map((f) => f.key),
            ['name', 'incomeType', 'paySchedule', 'invoicedPayPostTax', 'taxRemoved', 'hoursPerCycle', 'primary']);
        assert('variable asks for the base rate', otherIncomeFields(d.incomeSources[1]).map((f) => f.key),
            ['name', 'incomeType', 'baseHourlyRate', 'primary']);
        const v = otherIncomeValues(d, 0);
        v.invoicedPayPostTax = 1000; v.primary = true;
        applyOtherIncome(d, 0, v);
        assert('saved', [d.incomeSources[0].invoicedPayPostTax, d.primaryIncomeIndex], [1000, 0]);
        const vv = otherIncomeValues(d, 1);
        vv.name = 'Gigs 2';
        applyOtherIncome(d, 1, vv);
        assert('events array kept', [d.incomeSources[1].name, Array.isArray(d.incomeSources[1].incomeEvents)], ['Gigs 2', true]);
    } },
    { name: 'A12b.4 income events add (newest first), edit and remove with Undo', fn(assert) {
        const s = { incomeEvents: [] };
        applyEvent(s, null, { date: '2026-11-01', label: 'A', netAmount: 100, taxWithheld: null, hours: 4, gstInclusive: false, penaltyRates: true });
        applyEvent(s, null, { date: '2026-11-02', label: 'B', netAmount: 200 });
        assert('newest first', s.incomeEvents.map((e) => e.label), ['B', 'A']);
        applyEvent(s, 1, { date: '2026-11-01', label: 'A2', netAmount: 150 });
        assert('edited in place', [s.incomeEvents[1].label, s.incomeEvents[1].netAmount, s.incomeEvents[1].id === undefined], ['A2', 150, false]);
        const res = removeEvent(s, 0);
        assert('removed', s.incomeEvents.length, 1);
        res.onUndo();
        assert('undone in place', s.incomeEvents.map((e) => e.label), ['B', 'A2']);
    } },
    { name: 'K2.1 a flagged Self-employed source is offered the Salary layout; unflagged ones are not', fn(assert) {
        assert('flagged', hasPayslipJobOffer(flagged()), true);
        assert('plain self-employed', hasPayslipJobOffer({ incomeType: 'selfEmployed' }), false);
        assert('missing source', hasPayslipJobOffer(null), false);
    } },
    { name: 'K2.2 Accept switches the layout, Undo puts the source back exactly (flag included)', fn(assert) {
        const s = flagged();
        const before = JSON.stringify(s);
        const undoIt = acceptPayslipJobWithUndo(s);
        assert('switched to Salary', [s.incomeType, s.basis, s.grossAnnual, s.migrationPrompt], ['salaried', 'salary', 65000, undefined]);
        assert('undo offered', typeof undoIt, 'function');
        undoIt();
        assert('restored, flag back', JSON.stringify(s), before);
        assert('nothing to accept when unflagged', acceptPayslipJobWithUndo({ incomeType: 'selfEmployed' }), null);
    } },
    { name: 'K2.3 Not now clears the flag for good', fn(assert) {
        const s = flagged();
        assert('declined', declinePayslipJobOffer(s), true);
        assert('flag gone, source otherwise unchanged', [s.migrationPrompt, s.incomeType, s.invoicedPayPostTax], [undefined, 'selfEmployed', 2000]);
        assert('no offer any more', hasPayslipJobOffer(s), false);
        assert('declining twice does nothing', declinePayslipJobOffer(s), false);
    } },
    { name: 'K2.4 the sheet for a flagged source shows the offer card with Accept and Not now', fn(assert) {
        if (typeof document === 'undefined') return;
        const saved = store.financeData;
        store.financeData = { primaryIncomeIndex: 0, incomeSources: [flagged(), { name: 'Plain', incomeType: 'selfEmployed', paySchedule: 'weekly' }] };
        try {
            assert('opened', openOtherIncomeSheet(0), true);
            assert('offer card shown', !!document.querySelector('[data-offer="payslip-job"]'), true);
            assert('two buttons', [...document.querySelectorAll('[data-offer] [data-offer-action]')].map((b) => b.dataset.offerAction), ['accept', 'dismiss']);
            document.querySelector('[data-sheet-action="close"]').click();
            assert('opened plain', openOtherIncomeSheet(1), true);
            assert('no offer on an unflagged source', !!document.querySelector('[data-offer="payslip-job"]'), false);
            document.querySelector('[data-sheet-action="close"]').click();
        } finally { store.financeData = saved; }
    } },
    { name: 'A12b.5 tax details write Medicare, HELP in the estimate and the HELP balance', fn(assert) {
        const d = {};
        applyTaxDetails(d, { includeMedicareLevy: true, includeHelpInEstimate: false, helpBalance: -5 });
        assert('written, balance floored at 0', d.taxSettings, { includeMedicareLevy: true, includeHelpInEstimate: false, helpBalance: 0 });
    } },
];
