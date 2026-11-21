// Self-describing test cases for src/import/csv.js.
// Each case is { name, fn } where fn(assert) calls
// assert(label, actual, expected) — the harness compares with strict
// equality after JSON.stringify for objects/arrays.

import {
    parseCsv,
    detectColumns,
    parseAmountToCents,
    parseDateToIso,
    normaliseRows,
    toIsoIfValid,
    CSV_LIMITS,
    CsvLimitError,
} from './csv.js';
import { parseStatementPages } from './pdf-statement.js';
import { grossDecision } from './payslip.js';

export const CSV_TEST_CASES = [
    {
        name: 'parseCsv: quoted fields with commas and escaped quotes',
        fn(assert) {
            const { rows, errors } = parseCsv('a,"b, c","say ""hi"" now"\n');
            assert('field values', rows[0], ['a', 'b, c', 'say "hi" now']);
            assert('no errors', errors, []);
        },
    },
    {
        name: 'parseCsv: CRLF endings and trailing newline',
        fn(assert) {
            const { rows } = parseCsv('a,b\r\nc,d\r\n');
            assert('two rows only', rows.length, 2);
            assert('row 1', rows[0], ['a', 'b']);
            assert('row 2', rows[1], ['c', 'd']);
        },
    },
    {
        name: 'parseCsv: strips a leading BOM',
        fn(assert) {
            const { rows } = parseCsv('﻿' + 'Date,Amount\n01/01/2026,-1.00\n');
            assert('first header cell has no BOM', rows[0][0], 'Date');
            assert('BOM char code confirmed stripped', rows[0][0].charCodeAt(0), 68);
        },
    },
    {
        name: 'parseCsv: newline inside a quoted field stays one row',
        fn(assert) {
            const { rows } = parseCsv('a,"line one\nline two",z\nnext,row,here\n');
            assert('two logical rows', rows.length, 2);
            assert('embedded newline kept', rows[0][1], 'line one\nline two');
            assert('following row starts on line 3', rows[1].line, 3);
        },
    },
    {
        name: 'parseCsv: skips empty lines but keeps original line numbers',
        fn(assert) {
            const { rows } = parseCsv('a,b\n\n\nc,d\n');
            assert('empty lines dropped', rows.length, 2);
            assert('line numbers survive the gap', rows.map((r) => r.line), [1, 4]);
        },
    },
    {
        name: 'parseAmountToCents: currency symbol and thousands separators',
        fn(assert) {
            assert('$1,234.56', parseAmountToCents('$1,234.56'), 123456);
            assert('-1234.56', parseAmountToCents('-1234.56'), -123456);
            assert('bare integer is dollars', parseAmountToCents('1234'), 123400);
            assert('whitespace tolerated', parseAmountToCents('  -$2,000.00 '), -200000);
        },
    },
    {
        name: 'parseAmountToCents: parentheses mean negative',
        fn(assert) {
            assert('(1234.56)', parseAmountToCents('(1234.56)'), -123456);
            assert('($45.00)', parseAmountToCents('($45.00)'), -4500);
        },
    },
    {
        name: 'parseAmountToCents: CR/DR suffixes and unparseable input',
        fn(assert) {
            assert('CR is positive', parseAmountToCents('100.00 CR'), 10000);
            assert('DR is negative', parseAmountToCents('100.00 DR'), -10000);
            assert('lowercase dr', parseAmountToCents('55.10dr'), -5510);
            assert('empty is null', parseAmountToCents(''), null);
            assert('garbage is null', parseAmountToCents('N/A'), null);
            assert('date is not an amount', parseAmountToCents('03/01/2026'), null);
        },
    },
    {
        name: 'parseDateToIso: AU numeric formats are day-first',
        fn(assert) {
            assert('dd/mm/yyyy', parseDateToIso('03/01/2026'), '2026-01-03');
            assert('dd-mm-yyyy', parseDateToIso('03-01-2026'), '2026-01-03');
            assert('yyyy-mm-dd passes through', parseDateToIso('2026-01-03'), '2026-01-03');
            assert('day > 12 stays day-first', parseDateToIso('25/01/2026'), '2026-01-25');
        },
    },
    {
        name: 'parseDateToIso: two-digit year pivot at 50',
        fn(assert) {
            assert('49 → 2049', parseDateToIso('01/02/49'), '2049-02-01');
            assert('50 → 1950', parseDateToIso('01/02/50'), '1950-02-01');
        },
    },
    {
        name: 'parseDateToIso: dd Mon yyyy with names and abbreviations',
        fn(assert) {
            assert('03 Jan 2026', parseDateToIso('03 Jan 2026'), '2026-01-03');
            assert('case-insensitive full name', parseDateToIso('3 january 2026'), '2026-01-03');
            assert('sept abbreviation', parseDateToIso('15 Sept 2025'), '2025-09-15');
        },
    },
    {
        name: 'parseDateToIso: rejects impossible calendar dates',
        fn(assert) {
            assert('31 Feb', parseDateToIso('31/02/2026'), null);
            assert('29 Feb non-leap', parseDateToIso('29/02/2026'), null);
            assert('29 Feb leap year ok', parseDateToIso('29/02/2028'), '2028-02-29');
            assert('month 13', parseDateToIso('13/13/2026'), null);
            assert('not a date at all', parseDateToIso('Opening Balance'), null);
        },
    },
    {
        name: 'parseDateToIso: mm/dd fallback only when unambiguous',
        fn(assert) {
            // First component ≤ 12 and second > 12 can only be a US export.
            assert('01/25/2026 → Jan 25', parseDateToIso('01/25/2026'), '2026-01-25');
            // Ambiguous stays Australian day-first.
            assert('02/03/2026 → 2 Mar', parseDateToIso('02/03/2026'), '2026-03-02');
        },
    },
    {
        name: 'detectColumns: CBA-style headerless file (Date,Amount,Description,Balance)',
        fn(assert) {
            const rows = [
                ['03/01/2026', '-12.50', 'PURCHASE COFFEE CO', '1023.90'],
                ['04/01/2026', '1500.00', 'SALARY EMPLOYER PTY LTD', '2523.90'],
                ['05/01/2026', '-45.00', 'WOOLWORTHS 1234 MELBOURNE', '2478.90'],
            ];
            const result = detectColumns(rows);
            assert('no header detected', result.headerRow, false);
            // Balance (col 3) also parses as money but has no negatives,
            // so the signed column must win as amount.
            assert('mapping', result.mapping, {
                date: 0, description: 2, amount: 1, debit: null, credit: null,
            });
        },
    },
    {
        name: 'detectColumns: NAB-style headered file maps by name',
        fn(assert) {
            const rows = [
                ['Date', 'Amount', 'Account Number', 'Transaction Type', 'Transaction Details', 'Balance'],
                ['03/01/2026', '-12.50', '1234', 'PURCHASE', 'COFFEE CO', '1023.90'],
            ];
            const result = detectColumns(rows);
            assert('header detected', result.headerRow, true);
            assert('mapping', result.mapping, {
                date: 0, description: 4, amount: 1, debit: null, credit: null,
            });
        },
    },
    {
        name: 'detectColumns: Westpac-style debit/credit split columns',
        fn(assert) {
            const rows = [
                ['Bank Account', 'Date', 'Narrative', 'Debit Amount', 'Credit Amount', 'Balance'],
                ['032000123456', '03/01/2026', 'EFTPOS PURCHASE', '12.50', '', '1023.90'],
            ];
            const result = detectColumns(rows);
            assert('header detected', result.headerRow, true);
            assert('split columns, no signed amount', result.mapping, {
                date: 1, description: 2, amount: null, debit: 3, credit: 4,
            });
        },
    },
    {
        name: 'normaliseRows: CBA-style file end to end',
        fn(assert) {
            const text = '03/01/2026,"-12.50","PURCHASE COFFEE CO, MELBOURNE",1023.90\n'
                + '04/01/2026,"+1,500.00","SALARY  EMPLOYER   PTY LTD",2523.90\n';
            const { rows } = parseCsv(text);
            const { headerRow, mapping } = detectColumns(rows);
            const result = normaliseRows(rows, mapping, { skipHeader: headerRow });
            assert('no errors', result.errors, []);
            assert('transactions', result.transactions, [
                { date: '2026-01-03', description: 'PURCHASE COFFEE CO, MELBOURNE', amountCents: -1250 },
                { date: '2026-01-04', description: 'SALARY EMPLOYER PTY LTD', amountCents: 150000 },
            ]);
        },
    },
    {
        name: 'normaliseRows: bad date errors with original line number, good rows survive',
        fn(assert) {
            const text = 'Date,Description,Amount\n'
                + '01/01/2026,Coffee,-4.50\n'
                + '\n'
                + '31/02/2026,Ghost,-1.00\n'
                + '02/01/2026,Rent,-500.00\n';
            const { rows } = parseCsv(text);
            const { headerRow, mapping } = detectColumns(rows);
            const result = normaliseRows(rows, mapping, { skipHeader: headerRow });
            assert('good rows kept', result.transactions, [
                { date: '2026-01-01', description: 'Coffee', amountCents: -450 },
                { date: '2026-01-02', description: 'Rent', amountCents: -50000 },
            ]);
            assert('one error', result.errors.length, 1);
            // Line 4 in the ORIGINAL file — the skipped blank line still counts.
            assert('error line number', result.errors[0].line, 4);
            assert('error message', result.errors[0].message, 'Couldn\'t read a date from "31/02/2026"');
        },
    },
    {
        name: 'normaliseRows: invert option flips all signs',
        fn(assert) {
            const rows = [
                ['01/01/2026', 'Coffee', '4.50'],
                ['02/01/2026', 'Refund', '-10.00'],
            ];
            const mapping = { date: 0, description: 1, amount: 2, debit: null, credit: null };
            const result = normaliseRows(rows, mapping, { invert: true });
            assert('signs flipped', result.transactions.map((t) => t.amountCents), [-450, 1000]);
        },
    },
    {
        name: 'normaliseRows: debit/credit split combines as credit minus debit',
        fn(assert) {
            const rows = [
                ['01/01/2026', 'Groceries', '54.20', ''],
                ['02/01/2026', 'Refund', '', '10.00'],
                ['03/01/2026', 'Signed debit column', '-32.50', ''],
            ];
            const mapping = { date: 0, description: 1, debit: 2, credit: 3, amount: null };
            const result = normaliseRows(rows, mapping, {});
            assert('no errors', result.errors, []);
            assert('amounts', result.transactions.map((t) => t.amountCents), [-5420, 1000, -3250]);
        },
    },
    {
        name: 'normaliseRows: zero/empty amount with empty description is skipped silently',
        fn(assert) {
            const rows = [
                ['01/01/2026', 'Coffee', '-4.50'],
                ['', '', ''],
                ['02/01/2026', '', '0.00'],
            ];
            const mapping = { date: 0, description: 1, amount: 2, debit: null, credit: null };
            const result = normaliseRows(rows, mapping, {});
            assert('only the real row kept', result.transactions.length, 1);
            assert('no errors for junk rows', result.errors, []);
        },
    },
    {
        name: 'D3a: synthetic CBA-style headerless layout (fake data) still imports unchanged',
        fn(assert) {
            const text = '03/01/2025,"-45.50","WOOLWORTHS 1234 FAKETOWN","+1204.50"\n04/01/2025,"+1850.00","FAKE EMPLOYER PAY","+3054.50"\n';
            const { rows, errors } = parseCsv(text);
            const det = detectColumns(rows);
            const { transactions } = normaliseRows(rows, det.mapping, { skipHeader: det.headerRow });
            assert('no parse errors', errors, []);
            assert('headerless', det.headerRow, false);
            assert('amounts', transactions.map((t) => t.amountCents), [-4550, 185000]);
            assert('dates', transactions.map((t) => t.date), ['2025-01-03', '2025-01-04']);
        },
    },
    {
        name: 'D3a: synthetic debit/credit header layout (fake data) still imports unchanged',
        fn(assert) {
            const text = 'Date,Transaction Details,Debit,Credit,Balance\n3 Jan 2025,FAKE CAFE,12.30,,500.00\n4 Jan 2025,FAKE REFUND,,20.00,520.00\n';
            const { rows } = parseCsv(text);
            const det = detectColumns(rows);
            const { transactions, errors } = normaliseRows(rows, det.mapping, { skipHeader: det.headerRow });
            assert('header found', det.headerRow, true);
            assert('no errors', errors, []);
            assert('signed cents', transactions.map((t) => t.amountCents), [-1230, 2000]);
        },
    },
    {
        name: 'S3.M6 CSV caps: file size, line length, column count, rows',
        fn(assert) {
            const code = (text) => { try { parseCsv(text); return 'ok'; } catch (e) { return e instanceof CsvLimitError ? e.code : 'other'; } };
            assert('normal file', code('a,b\n1,2\n'), 'ok');
            assert('too many columns', code(','.repeat(CSV_LIMITS.maxCols + 5)), 'too-many-columns');
            assert('exactly the column cap is fine', code(','.repeat(CSV_LIMITS.maxCols - 1)), 'ok');
            assert('line too long', code('x'.repeat(CSV_LIMITS.maxLineChars + 10)), 'line-too-long');
            assert('long quoted field across lines still counted per line', code('"' + ('x'.repeat(100) + '\n').repeat(500) + '"'), 'ok');
            assert('file too large', code('a'.repeat(CSV_LIMITS.maxFileBytes + 1)), 'too-large');
            assert('too many rows', code('a\n'.repeat(CSV_LIMITS.maxRows + 1)), 'too-many-rows');
        },
    },
    {
        name: 'S3.L1 amount parsing is linear on hostile cells',
        fn(assert) {
            const t0 = Date.now();
            assert('spaces between letters', parseAmountToCents('a' + ' '.repeat(300000) + 'b'), null);
            assert('spaces before CR', parseAmountToCents('x' + ' '.repeat(300000) + 'CR'), null);
            assert('many CRs', parseAmountToCents('CR'.repeat(100000)), null);
            assert('fast', Date.now() - t0 < 500, true);
            assert('CR/DR still work', [parseAmountToCents('12.50 CR'), parseAmountToCents('$12.50DR.'), parseAmountToCents('CR')], [1250, -1250, null]);
            assert('long date cell', parseDateToIso('1' + ' '.repeat(5000) + '/1/2026'), null);
        },
    },
    {
        name: 'S3.L2 amounts must be finite and safe in cents; skipped rows are counted',
        fn(assert) {
            assert('400 digits', parseAmountToCents('9'.repeat(400)), null);
            assert('20 digits', parseAmountToCents('12345678901234567890.00'), null);
            assert('largest safe amount', parseAmountToCents('90071992547409.91'), 9007199254740991);
            assert('one cent past it', parseAmountToCents('90071992547409.92'), null);
            assert('ordinary', parseAmountToCents('1,234.56'), 123456);
            const rows = [
                ['Date', 'Description', 'Amount'],
                ['01/02/2026', 'OK ROW', '-10.00'],
                ['02/02/2026', 'HUGE', '9'.repeat(400)],
                ['03/02/2026', 'HUGE2', '-12345678901234567890.00'],
                ['04/02/2026', 'JUNK', 'abc'],
            ];
            const res = normaliseRows(rows, { date: 0, description: 1, amount: 2, debit: null, credit: null }, { skipHeader: true });
            assert('good row survives', res.transactions.map((t) => t.amountCents), [-1000]);
            assert('out-of-range count excludes plain junk', res.outOfRange, 2);
            assert('three errors', res.errors.length, 3);
            const split = normaliseRows([['01/02/2026', 'X', '9'.repeat(30), '']], { date: 0, description: 1, amount: null, debit: 2, credit: 3 });
            assert('split columns too', [split.transactions.length, split.outOfRange], [0, 1]);
        },
    },
    {
        name: 'S3.L3 calendar dates are validated without relying on engine leniency',
        fn(assert) {
            assert('31 Feb', toIsoIfValid(2026, 2, 31), null);
            assert('29 Feb 2026', toIsoIfValid(2026, 2, 29), null);
            assert('29 Feb 2028', toIsoIfValid(2028, 2, 29), '2028-02-29');
            assert('31 Apr', toIsoIfValid(2026, 4, 31), null);
            assert('fractions', toIsoIfValid(2026, 1.5, 3), null);
            assert('csv 31/02/2026', parseDateToIso('31/02/2026'), null);
            const L = (...p) => ({ y: 0, items: p.map(([x, str]) => ({ x, str })), text: p.map((q) => q[1]).join(' ') });
            const page = [
                L([50, 'Account activity 2026']),
                L([50, '31 Jan'], [150, 'COFFEE'], [400, '-4.50']),
                L([50, '31 Feb'], [150, 'IMPOSSIBLE'], [400, '-5.00']),
                L([50, '29 Feb'], [150, 'NO LEAP DAY'], [400, '-6.00']),
                L([50, '30 Apr'], [150, 'TEA'], [400, '-3.00']),
            ];
            const res = parseStatementPages([page]);
            assert('only real dates', res.transactions.map((t) => t.date.slice(5) + ' ' + t.description), ['01-31 COFFEE', '04-30 TEA']);
            assert('impossible ones counted as skipped', res.skipped, 2);
        },
    },
    {
        name: 'S3.M6 PDF line grouping sorts then sweeps (fast, same lines)',
        async fn(assert) {
            const { groupRows } = await import('./pdfjs-loader.js');
            const it = (x, y, str) => ({ str, transform: [1, 0, 0, 1, x, y] });
            const rows = groupRows([it(200, 100.4, 'b'), it(50, 100, 'a'), it(50, 90, 'c'), it(10, 500, 'top'), it(5, 5, ' ')]);
            assert('top line first, blanks dropped', rows.map((r) => r.items.map((i) => i.str).sort()), [['top'], ['a', 'b'], ['c']]);
            const many = [];
            for (let i = 0; i < 60000; i++) many.push(it(i % 500, i * 7, 'w' + i));
            const t0 = Date.now();
            const big = groupRows(many);
            assert('60k distinct baselines', big.length, 60000);
            assert('fast (not quadratic)', Date.now() - t0 < 1500, true);
        },
    },
    {
        name: 'S3.L7 payslip gross is only written unseen when it is read, not estimated, and nothing differs',
        fn(assert) {
            const read = { gross: 2000, tax: 400, net: 1600, grossDerived: false };
            assert('fresh source, read gross: writes', grossDecision(read, { grossAnnual: 0 }, 'fortnightly', 26).needsConfirm, false);
            assert('same as stored: writes', grossDecision(read, { grossAnnual: 52000, paySchedule: 'fortnightly' }, 'fortnightly', 26).needsConfirm, false);
            assert('different from stored: asks', grossDecision(read, { grossAnnual: 70000, paySchedule: 'fortnightly' }, 'fortnightly', 26).needsConfirm, true);
            const est = { gross: 2000, tax: 400, net: 1600, grossDerived: true };
            assert('estimated: always asks', grossDecision(est, { grossAnnual: 0 }, 'fortnightly', 26).needsConfirm, true);
            assert('proposed annual', grossDecision(est, {}, 'fortnightly', 26).proposedAnnual, 52000);
            assert('failed parse: nothing proposed', grossDecision({ gross: null, grossDerived: false }, { grossAnnual: 52000 }, 'weekly', 52), { proposedAnnual: null, stored: false, needsConfirm: false });
            assert('infinite gross: nothing proposed', grossDecision({ gross: Infinity }, {}, 'weekly', 52).proposedAnnual, null);
        },
    },
];
