// D4 tests: the acceptance report (tools/accept-core.mjs) runs the real import code and
// carries no text from the file. Synthetic fixtures only (tools/accept-fixtures.mjs).

import { parseCsv } from './csv.js';
import { readXlsx } from './xlsx.js';
import { buildXlsx } from '../../tools/make-xlsx.mjs';
import { reportFromRows, reportFromStatementPages, reportFromPayslipLines, renderReport } from '../../tools/accept-core.mjs';
import {
    CSV_FIXTURE, XLSX_ROWS, STATEMENT_PAGES, PAYSLIP_LINES, FAKE_NAME, FAKE_ACCOUNT, buildStatementPdf,
} from '../../tools/accept-fixtures.mjs';

const SECRETS = [
    'WOOLWORTHS', 'THORNBURY', 'EMPLOYER', 'NETFLIX', 'ROSSI', 'ACME', 'Jane', 'Citizen', FAKE_NAME,
    '062000', '12345678', FAKE_ACCOUNT, '45.50', '1850', '1,200.00', '3,200', '2,560', '640.00', 'Westpac Banking',
];
const leaks = (text) => SECRETS.filter((s) => text.toLowerCase().includes(s.toLowerCase()));

export const ACCEPT_TEST_CASES = [
    {
        name: 'D4.1 CSV fixture: counts, month range, sign split, re-import duplicates, unparsed',
        async fn(assert) {
            const { rows, errors } = parseCsv(CSV_FIXTURE);
            const r = await reportFromRows('csv', rows, { parseErrors: errors.length });
            assert('rows', r.rows, 5);
            assert('range', [r.firstMonth, r.lastMonth], ['2026-03', '2026-04']);
            assert('sign split', [r.negative, r.positive, r.zero], [4, 1, 0]);
            assert('every row is a duplicate on re-import', r.duplicatesOnReimport, 5);
            assert('the junk line is counted, not shown', r.unparsed, 1);
            assert('fields', r.fields, { headerRowDetected: true, dateColumn: true, descriptionColumn: true, amountColumn: true, splitDebitCreditColumns: false });
        },
    },
    {
        name: 'D4.3 PDF statement pages: bank detected by name from the fixed list, rows and range',
        async fn(assert) {
            const r = await reportFromStatementPages(STATEMENT_PAGES);
            assert('bank', r.bank, 'Westpac');
            assert('rows', r.rows, 3);
            assert('range', [r.firstMonth, r.lastMonth], ['2026-03', '2026-03']);
            assert('sign split', [r.negative, r.positive], [2, 1]);
            assert('bank field', r.fields.bankDetected, true);
        },
    },
    {
        name: 'D4.4 payslip lines: provider, schedule and fields as booleans',
        fn(assert) {
            const r = reportFromPayslipLines(PAYSLIP_LINES);
            assert('provider', r.provider, 'Xero');
            assert('schedule', r.schedule, 'fortnightly');
            assert('fields', r.fields, { net: true, tax: true, gross: true, super: true, help: false, grossWasDerived: false });
        },
    },
    {
        name: 'D4.5 privacy: a CSV with names, descriptions and an account number gives a report with none of them',
        async fn(assert) {
            const { rows } = parseCsv(CSV_FIXTURE);
            const text = renderReport(await reportFromRows('csv', rows));
            assert('no leaked text', leaks(text), []);
            assert('has no digits beyond counts and the month range', /\b\d{6,}\b/.test(text), false);
        },
    },
    {
        name: 'D4.7 the report builder cannot be steered by file text: hostile bank, provider and dates are ignored',
        fn(assert) {
            const evil = renderReport({
                kind: 'pdf', rows: '9; DROP', firstMonth: 'Jane Citizen', lastMonth: '1850.00 WOOLWORTHS',
                negative: 'x', positive: -4, zero: NaN, duplicatesOnReimport: '12345678', unparsed: 1.9, outOfRange: 0,
                bank: 'Jane Citizen', provider: 'ACME PAY', schedule: 'x', fields: { bankDetected: 'Jane' },
            });
            assert('no leaked text', leaks(evil), []);
            assert('month range falls back', evil.includes('Month range: none'), true);
            assert('bank falls back', evil.includes('Bank detected: unknown'), true);
        },
    },
    {
        name: 'D4.8 the fixture PDF builder writes a PDF header and the statement text',
        fn(assert) {
            const text = new TextDecoder().decode(buildStatementPdf());
            assert('header', text.startsWith('%PDF-1.4'), true);
            assert('has a table row', text.includes('(EFTPOS WOOLWORTHS 1234) Tj'), true);
        },
    },
];

// env browser: the XLSX reader needs DOMParser.
export const ACCEPT_XLSX_TEST_CASES = [
    {
        name: 'D4.2 XLSX fixture goes through the real reader and the split-column path',
        async fn(assert) {
            const { rows } = await readXlsx(await buildXlsx({ rows: XLSX_ROWS }));
            const r = await reportFromRows('xlsx', rows);
            assert('rows', r.rows, 3);
            assert('sign split', [r.negative, r.positive], [2, 1]);
            assert('split columns found', r.fields.splitDebitCreditColumns, true);
            assert('kind', r.kind, 'xlsx');
        },
    },
    {
        name: 'D4.6 privacy: XLSX, PDF and payslip reports carry none of the file text either',
        async fn(assert) {
            const { rows } = await readXlsx(await buildXlsx({ rows: XLSX_ROWS }));
            const texts = [
                renderReport(await reportFromRows('xlsx', rows)),
                renderReport(await reportFromStatementPages(STATEMENT_PAGES)),
                renderReport(reportFromPayslipLines(PAYSLIP_LINES)),
            ];
            assert('no leaked text', texts.map(leaks), [[], [], []]);
        },
    },
];
