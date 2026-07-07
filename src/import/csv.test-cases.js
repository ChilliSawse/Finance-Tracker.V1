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
} from './csv.js';

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
];
