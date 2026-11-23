// Test cases for the "income-layout" group (C6, registered in src/test-registry.js).
// Pure parts only: the sheet DOM is checked by eye. Fixtures are synthetic (an unnamed employee).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    layoutFor, sheetValuesFor, draftSource, applyIncomeValues, readoutFor, describeCheck,
    patchForFix, payAnchorFromNext, grossAnnualFrom, recordPayslipCheck, openIncomeSheet, saveIncomeSheet, superCapNote,
} from './income-layout.js';
import { store } from '../state/store.js';
import { AU_2025_26 } from '../calc/tax-tables/au-2025-26.js';
import { AU_2026_27 } from '../calc/tax-tables/au-2026-27.js';
import { acceptPayslipJob } from '../state/income-migration.js';

const TODAY = '2026-03-10';
const emp = (over = {}) => ({
    name: 'Job', incomeType: 'salaried', basis: 'salary', paySchedule: 'fortnightly', grossAnnual: 79500,
    hourlyRate: null, hoursPerWeek: null, superPct: null, payAnchor: '2026-03-06',
    withholding: { claimsTaxFree: true, hasStudyDebt: true, medicareExemption: false, extraPerPay: 0 }, ...over,
});
const vals = (over = {}) => ({ ...sheetValuesFor(emp(), 'salary', TODAY), ...over });

export const INCOME_LAYOUT_TEST_CASES = [
    {
        name: 'C6.1 layout routing',
        fn(assert) {
            assert('employee is Salary', layoutFor(emp()), 'salary');
            assert('rate and hours is Set hours', layoutFor(emp({ hourlyRate: 40, hoursPerWeek: 30 })), 'hours');
            assert('self-employed keeps its editor', layoutFor(emp({ incomeType: 'selfEmployed' })), null);
            assert('variable keeps its editor', layoutFor(emp({ incomeType: 'variable' })), null);
            assert('missing source', layoutFor(null), null);
        },
    },
    {
        name: 'C6.2 diagnosed payslip: match, then HELP off with a one-tap fix',
        fn(assert) {
            const v = vals();
            const on = describeCheck({ tax: 698, gross: 3057.69, date: TODAY }, draftSource(v, 'salary'), TODAY);
            assert('match state', on.state, 'match');
            assert('expected line', on.lines[0], 'Expected: A$626 tax + A$72 HELP = A$698');
            assert('payslip line', on.lines[1], 'Your payslip: A$698');

            const off = vals({ hasStudyDebt: 'no' });
            const d = describeCheck({ tax: 698, gross: 3057.69, date: TODAY }, draftSource(off, 'salary'), TODAY);
            assert('cause state', d.state, 'cause');
            assert('HELP copy', d.message, 'The A$72 difference is about what HELP takes on your pay.');
            assert('fix label', d.fixes[0].label, 'I have a HELP debt');
            const patch = patchForFix(d.fixes[0].fix);
            assert('patch turns HELP on', patch, { hasStudyDebt: 'yes' });
            const again = describeCheck({ tax: 698, gross: 3057.69, date: TODAY }, draftSource({ ...off, ...patch }, 'salary'), TODAY);
            assert('matches after the fix', again.state, 'match');
        },
    },
    {
        name: 'C6.3 pay date stored as payAnchor (X-9)',
        fn(assert) {
            assert('weekly', payAnchorFromNext('2026-03-20', 'weekly'), '2026-03-13');
            assert('fortnightly', payAnchorFromNext('2026-03-20', 'fortnightly'), '2026-03-06');
            assert('monthly keeps the day', payAnchorFromNext('2026-03-31', 'monthly'), '2026-01-31');
            assert('quarterly has none', payAnchorFromNext('2026-03-20', 'quarterly'), null);

            const s = emp({ payAnchor: null });
            const initial = { grossAnnual: s.grossAnnual, paySchedule: 'fortnightly', nextPay: '' };
            applyIncomeValues(s, vals({ nextPay: '2026-03-20' }), 'salary', initial);
            assert('anchor is the pay before', s.payAnchor, '2026-03-06');
            assert('no second field', 'nextPayDate' in s, false);

            const kept = emp();
            const init2 = { grossAnnual: kept.grossAnnual, paySchedule: 'fortnightly', nextPay: sheetValuesFor(kept, 'salary', TODAY).nextPay };
            applyIncomeValues(kept, { ...sheetValuesFor(kept, 'salary', TODAY), name: 'Renamed' }, 'salary', init2);
            assert('unchanged date keeps the anchor', kept.payAnchor, '2026-03-06');
        },
    },
    {
        name: 'C6.4 save writes the fields, per-payslip entry does not drift the gross',
        fn(assert) {
            const s = emp();
            const initial = { grossAnnual: s.grossAnnual, paySchedule: 'fortnightly', nextPay: '' };
            applyIncomeValues(s, vals({ enterAs: 'pay', amount: 3057.69, superPct: 11, hasStudyDebt: 'unsure', salarySacrifice: 'yes', medicareExemption: 'yes', extraPerPay: 20 }), 'salary', initial);
            assert('gross kept (rounding only)', s.grossAnnual, 79500);
            assert('super', s.superPct, 11);
            assert('HELP not sure is null', s.withholding.hasStudyDebt, null);
            assert('medicare stored', s.withholding.medicareExemption, true);
            assert('extra stored', s.withholding.extraPerPay, 20);
            assert('sacrifice stored', s.salarySacrifice, true);

            const h = emp();
            applyIncomeValues(h, { ...vals(), hourlyRate: 40, hoursPerWeek: 30 }, 'hours', initial);
            assert('hours gross', h.grossAnnual, 62400);
            assert('hours fields', [h.hourlyRate, h.hoursPerWeek, h.hoursPerCycle], [40, 30, 60]);
            assert('per payslip changed amount', grossAnnualFrom({ ...vals(), enterAs: 'pay', amount: 2000 }, 'salary', initial), 52000);
        },
    },
    {
        name: 'C6.5 what we work out',
        fn(assert) {
            const r = readoutFor(vals(), 'salary', { taxBrackets: [] }, TODAY);
            assert('gross a pay', r.gross, 3057.69);
            assert('parts', r.parts, 'A$626 tax + A$72 HELP');
            assert('total', r.total, 698);
            assert('net', Math.round(r.net * 100), Math.round((3057.69 - 698) * 100));
            assert('estimate kinds', ['refund', 'bill', 'even'].includes(r.refund.kind), true);
            assert('tables year', r.fy, '2025-26');
            const noHelp = readoutFor(vals({ hasStudyDebt: 'unsure' }), 'salary', { taxBrackets: [] }, TODAY);
            assert('before HELP when unsure', [noHelp.parts, noHelp.helpUnsure], ['A$626 tax', true]);
            assert('super on gross', readoutFor(vals({ superPct: 10 }), 'salary', {}, TODAY).superAnnual, 7950);
        },
    },
    {
        name: 'K2.5 a payslip check is stored on the source as {date, matched}',
        fn(assert) {
            const s = emp();
            assert('stored', recordPayslipCheck(s, true, '2026-03-06', TODAY), true);
            assert('shape', s.taxCheck, { date: '2026-03-06', matched: true });
            assert('same result stores nothing new', recordPayslipCheck(s, true, '2026-03-06', TODAY), false);
            assert('a differing result replaces it', recordPayslipCheck(s, false, '2026-03-20', TODAY), true);
            assert('replaced', s.taxCheck, { date: '2026-03-20', matched: false });
            assert('bad date falls back to today', recordPayslipCheck(s, true, 'x', TODAY) && s.taxCheck.date, TODAY);
            assert('non-boolean ignored', recordPayslipCheck(s, 'yes', '2026-03-06', TODAY), false);
            assert('no source', recordPayslipCheck(null, true, '2026-03-06', TODAY), false);
        },
    },
    {
        name: 'H4 the Salary sheet saves a pay day through its own onSave path (it threw "t is not a function")',
        async fn(assert) {
            const saved = store.financeData;
            const savedAuto = store.autoSave;
            let autosaved = 0;
            store.autoSave = { onDataChange() { autosaved++; } };
            // A migrated Self-employed source with no pay date, offered the Salary layout (the live shape).
            const src = { name: 'Job', incomeType: 'selfEmployed', basis: 'invoiced', paySchedule: 'fortnightly', grossAnnual: 0,
                invoicedPayPostTax: 2000, taxRemoved: 0, migrationPrompt: 'payslip-job' };
            const data = { primaryIncomeIndex: 0, incomeSources: [src], taxSettings: {}, plan: [] };
            store.financeData = data;
            try {
                assert('offer accepted', acceptPayslipJob(src), true);
                const layout = layoutFor(src);
                const initial = { grossAnnual: Number(src.grossAnnual) || 0, paySchedule: 'fortnightly', nextPay: '' };
                const v = { ...sheetValuesFor(src, layout, '2026-11-22'), nextPay: '2026-12-02' };
                let threw = null;
                try { await saveIncomeSheet({ source: src, data, layout, initial, draft: null, onSaved: null }, v); } catch (e) { threw = String(e && e.message || e); }
                // Node has no DOM, so the redraw after the autosave may fail on "document"; that is not this bug.
                if (threw && /document/.test(threw)) threw = null;
                assert('save does not throw', threw, null);
                assert('pay anchor stored', src.payAnchor, '2026-11-18');
                assert('autosave ran', autosaved > 0, true);
                // The Self-employed editor (H1 field) goes through the same persist.
                const { persist } = await import('./income-layout.js');
                let threw2 = null;
                try { await persist(); } catch (e) { threw2 = String(e && e.message || e); }
                if (threw2 && /document/.test(threw2)) threw2 = null;
                assert('persist does not throw', threw2, null);
            } finally { store.financeData = saved; store.autoSave = savedAuto; }
        },
    },
    {
        name: 'H5 saving a new salary moves the stored payslip tax and pay with it, and an unchanged salary leaves them',
        fn(assert) {
            const src = emp({ grossAnnual: 79500, taxRemoved: 698, invoicedPayPostTax: 2359.69, withholding: { claimsTaxFree: true, hasStudyDebt: false, medicareExemption: false, extraPerPay: 0 } });
            const initial = { grossAnnual: 79500, paySchedule: 'fortnightly', nextPay: '' };
            applyIncomeValues(src, { ...vals(), amount: 79500, enterAs: 'year', hasStudyDebt: 'no' }, 'salary', initial);
            assert('unchanged salary keeps the payslip figures', [src.taxRemoved, src.invoicedPayPostTax], [698, 2359.69]);
            applyIncomeValues(src, { ...vals(), amount: 150000, enterAs: 'year', hasStudyDebt: 'no' }, 'salary', initial);
            assert('tax rose', src.taxRemoved > 698, true);
            assert('pay rose', src.invoicedPayPostTax > 2359.69, true);
            assert('pay + tax moved by the gross difference', Math.round((src.taxRemoved + src.invoicedPayPostTax - 698 - 2359.69) * 100) / 100, Math.round(((150000 - 79500) / 26) * 100) / 100);
            const bare = emp({ grossAnnual: 79500, taxRemoved: null, invoicedPayPostTax: null });
            applyIncomeValues(bare, { ...vals(), amount: 150000, enterAs: 'year' }, 'salary', initial);
            assert('a source with no payslip figures gets none', [bare.taxRemoved, bare.invoicedPayPostTax], [null, null]);
        },
    },
    {
        name: 'K2.7 running the payslip check in the sheet stores {date, matched} on the source',
        fn(assert) {
            if (typeof document === 'undefined') return;
            const saved = store.financeData;
            const src = emp({ incomeType: 'salaried', grossAnnual: 65000 });
            store.financeData = { primaryIncomeIndex: 0, incomeSources: [src], taxSettings: {} };
            try {
                assert('opened', openIncomeSheet(0), true);
                const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
                set('ils-slip-date', '2026-03-06');
                set('ils-slip-tax', '1');
                assert('a result is stored', !!src.taxCheck && typeof src.taxCheck.matched === 'boolean', true);
                assert('with the payslip date', src.taxCheck && src.taxCheck.date, '2026-03-06');
                document.querySelector('[data-sheet-action="close"]').click();
            } finally { store.financeData = saved; }
        },
    },
    {
        name: 'DB18 employer super cap warning (FT-R-131 E)',
        fn(assert) {
            const ctx = (today, data) => ({ source: null, data, initial: {}, today });
            const v = (gross, pct) => ({ ...vals({ enterAs: 'year', amount: gross, superPct: pct }) });
            assert('under cap: no warning', superCapNote(v(150000, 12), 'salary', ctx('2026-03-10')), null);
            assert('a $300k single job at 12% is held to the base, no false warning', superCapNote(v(300000, 12), 'salary', ctx('2026-03-10')), null);
            const over = superCapNote(v(300000, 15), 'salary', ctx('2026-03-10'));
            assert('over cap: warns on super', over && over.field, 'superPct');
            assert('names the 2025-26 cap and the amount (30,000 + 9,000)', over && /2025.26/.test(over.message) && over.message.includes('30,000') && over.message.includes('39,000'), true);
            assert('says employer super', over && /^Your employer super/.test(over.message), true);
            assert('mentions carry-forward', over && /carry it forward/.test(over.message), true);
            assert('2025-26 cap used: 14% on 260k is over 30,000', superCapNote(v(260000, 14), 'salary', ctx('2026-03-10')) !== null, true);
            assert('2026-27 cap used: 14% on 230k = 32,200 is under 32,500', superCapNote(v(230000, 14), 'salary', ctx('2026-09-10')), null);
            assert('two jobs add up over the cap', superCapNote(v(150000, 12), 'salary', ctx('2026-09-10', { incomeSources: [{ incomeType: 'salaried', grossAnnual: 150000, superPct: 12 }] })) !== null, true);
            assert('blank super % counts as 0, like the readout', superCapNote(v(300000, null), 'salary', ctx('2026-03-10')), null);
            assert('a stale year (after the last table) shows no warning', superCapNote(v(300000, 15), 'salary', ctx('2031-03-10')), null);
            assert('caps are in the built-in tables', [AU_2025_26.concessionalCap, AU_2026_27.concessionalCap], [30000, 32500]);
        },
    },
    {
        name: 'C6.6 payslip-job offer uses acceptPayslipJob',
        fn(assert) {
            const s = { incomeType: 'selfEmployed', paySchedule: 'fortnightly', invoicedPayPostTax: 2000, taxRemoved: 500, migrationPrompt: 'payslip-job', withholding: { claimsTaxFree: true } };
            assert('self-employed has no sheet yet', layoutFor(s), null);
            assert('accepted', acceptPayslipJob(s), true);
            assert('now salary', [s.incomeType, s.grossAnnual, s.migrationPrompt], ['salaried', 65000, undefined]);
            assert('and opens the Salary layout', layoutFor(s), 'salary');
        },
    },
];
