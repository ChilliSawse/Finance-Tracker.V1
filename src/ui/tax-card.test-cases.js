// Test cases for the "tax-card" group (C8). Pure parts, fixed dates. Fixtures are synthetic.
import { taxCardModel, buildTaxCardHtml, dismissTaxCheck } from './tax-card.js';
import { confirmTaxCheck } from './income-layout.js';
import { acceptPayslipJob } from '../state/income-migration.js';
import { showIncomePattern } from './future.js';
import { taxTablesStatus } from '../calc/tax-tables/index.js';
import { t } from '../i18n/strings.js';

export const TAX_CARD_TEST_CASES = [
    {
        name: 'U2.1 the tax card shows in any month until a check or a dismiss (clock pinned by the date argument)',
        fn(assert) {
            const job = () => ({ incomeSources: [{ incomeType: 'salaried', grossAnnual: 85000, paySchedule: 'fortnightly' }] });
            assert('November, never checked: due', taxCardModel('2026-11-21', job()), { kind: 'july', fy: '2026-27', late: true });
            assert('November status: due', taxTablesStatus('2026-11-21', job()).checkDue, true);
            assert('May, never checked: due', taxCardModel('2027-05-10', job()), { kind: 'july', fy: '2026-27', late: true });
            const checked = job();
            assert('confirm', confirmTaxCheck(checked, '2026-11-10', '2026-11-21'), true);
            assert('after a payslip check: not due', taxCardModel('2026-11-21', checked), null);
            assert('after a payslip check: status settled', taxTablesStatus('2026-11-21', checked).checkDue, false);
            const dismissed = job();
            dismissTaxCheck(dismissed, '2026-11-21');
            assert('after a dismiss: not due', taxCardModel('2026-11-22', dismissed), null);
            assert('dismissal sits in taxCheck, per year', dismissed.taxCheck, { fy: '2026-27', done: false, dismissed: true });
            const lastYear = { ...job(), taxCheck: { fy: '2025-26', done: false, dismissed: true } };
            assert('a dismissal for last year does not hide this year (due again in July)', taxCardModel('2026-07-01', lastYear), { kind: 'july', fy: '2026-27' });
            assert('and not in November either', taxCardModel('2026-11-21', lastYear), { kind: 'july', fy: '2026-27', late: true });
            assert('next July, past the shipped tables: the quiet label, not hidden', taxCardModel('2027-07-01', dismissed).kind, 'stale');
            assert('no payslip job: no card in November', taxCardModel('2026-11-21', { incomeSources: [{ incomeType: 'variable' }] }), null);
            assert('no sources: no card in November', taxCardModel('2026-11-21', {}), null);
        },
    },
    {
        name: 'U2.2 the heading switches in October',
        fn(assert) {
            const job = { incomeSources: [{ incomeType: 'salaried', grossAnnual: 85000 }] };
            const heading = (d) => (/<h2[^>]*>([^<]*)<\/h2>/.exec(buildTaxCardHtml(taxCardModel(d, job))) || [])[1];
            assert('July', heading('2026-07-01'), 'New tax year: 2026-27');
            assert('September', heading('2026-09-30'), 'New tax year: 2026-27');
            assert('October', heading('2026-10-01'), 'Check your take-home for 2026-27');
            assert('November', heading('2026-11-21'), 'Check your take-home for 2026-27');
            assert('June', heading('2027-06-30'), 'Check your take-home for 2026-27');
            assert('string key', t('c.tax.late.title', { fy: '2026-27' }), 'Check your take-home for 2026-27');
        },
    },
    {
        name: 'C8.1 accepting the payslip-job prompt: gross 79,499.94, payslip pay kept',
        fn(assert) {
            const s = { incomeType: 'selfEmployed', paySchedule: 'fortnightly', invoicedPayPostTax: 2359.69, taxRemoved: 698, migrationPrompt: 'payslip-job' };
            assert('accepted', acceptPayslipJob(s), true);
            assert('salaried', [s.incomeType, s.basis], ['salaried', 'salary']);
            assert('gross', s.grossAnnual, 79499.94);
            assert('pay kept', s.invoicedPayPostTax, 2359.69);
            assert('prompt cleared', s.migrationPrompt, undefined);
        },
    },
    {
        name: 'C8.2 July card from 1 July until a payslip is checked (fixed dates)',
        fn(assert) {
            const prev = { taxCheck: { fy: '2025-26', done: true } };
            assert('30 June: nothing', taxCardModel('2026-06-30', prev), null);
            assert('1 July: card', taxCardModel('2026-07-01', prev), { kind: 'july', fy: '2026-27' });
            assert('no record: nothing to confirm', taxCardModel('2026-07-01', {}), null);
            const d = { ...prev };
            assert('confirm writes taxCheck', confirmTaxCheck(d, '2026-07-10', '2026-07-12'), true);
            assert('stored shape', d.taxCheck, { fy: '2026-27', done: true });
            assert('card gone once checked', taxCardModel('2026-07-12', d), null);
            assert('last year payslip does not confirm', confirmTaxCheck({ ...prev }, '2026-06-20', '2026-07-12'), false);
        },
    },
    {
        name: 'C8.3 explicit dismiss, stale label, escaping',
        fn(assert) {
            const d = { taxCheck: { fy: '2025-26', done: true } };
            dismissTaxCheck(d, '2026-08-01');
            assert('dismissed record', d.taxCheck, { fy: '2026-27', done: false, dismissed: true });
            assert('hidden after dismiss', taxCardModel('2026-08-01', d), null);
            assert('new year shows it again', taxCardModel('2027-07-01', { taxCheck: d.taxCheck }), { kind: 'stale', fy: '2026-27' });
            const m = taxCardModel('2027-08-01', {});
            assert('stale after the shipped tables', m.kind, 'stale');
            assert('quiet label', buildTaxCardHtml(m).includes('tax-stale'), true);
            assert('no card html', buildTaxCardHtml(null), '');
            assert('fy escaped', buildTaxCardHtml({ kind: 'july', fy: '<b>' }).includes('<b>'), false);
        },
    },
    {
        name: 'C8.4 Income pattern shows for Variable sources only',
        fn(assert) {
            assert('variable', showIncomePattern({ incomeSources: [{ incomeType: 'variable' }] }), true);
            assert('salaried only', showIncomePattern({ incomeSources: [{ incomeType: 'salaried' }] }), false);
            assert('self-employed only', showIncomePattern({ incomeSources: [{ incomeType: 'selfEmployed' }] }), false);
            assert('none', showIncomePattern({}), false);
        },
    },
];
