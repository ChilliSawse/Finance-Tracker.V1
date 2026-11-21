// Test cases for the "xlsx" group (registered in src/test-registry.js, env 'browser':
// DOMParser and DecompressionStream). Owner step writes these first.
// Shape: { name, fn(assert) }, assert(label, actual, expected).
// Fixtures are synthetic and generated at test time by tools/make-xlsx.mjs.

import { readXlsx, serialToIso, XlsxError, XLSX_LIMITS, inflateCapped } from './xlsx.js';
import { detectColumns, normaliseRows } from './csv.js';
import { buildXlsx, buildZip } from '../../tools/make-xlsx.mjs';

const DATE = (serial, style) => ({ serial, style });

async function code(promise) {
    try {
        const r = await promise;
        return 'resolved:' + JSON.stringify(r.rows);
    } catch (e) {
        return e instanceof XlsxError ? e.code : 'other:' + e;
    }
}

const SIMPLE = [
    ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
    [DATE(45658), 'WOOLWORTHS 1234 THORNBURY', '45.50', null, '1204.50'],
    [DATE(45659, 2), 'EMPLOYER PTY LTD PAY', null, '1850.00', '3054.50'],
];

export const XLSX_TEST_CASES = [
    {
        name: 'D3a.1 shared strings and inline strings read the same',
        async fn(assert) {
            const a = await readXlsx(await buildXlsx({ rows: SIMPLE }));
            const b = await readXlsx(await buildXlsx({ rows: SIMPLE, inline: true }));
            assert('shared == inline', a.rows, b.rows);
            assert('header', a.rows[0], ['Date', 'Description', 'Debit', 'Credit', 'Balance']);
            assert('data row', a.rows[1], ['2025-01-01', 'WOOLWORTHS 1234 THORNBURY', '45.50', '', '1204.50']);
            assert('sheet name', a.sheetName, 'Statement');
            assert('stored entries work too', (await readXlsx(await buildXlsx({ rows: SIMPLE, method: 0 }))).rows, a.rows);
            assert('line numbers', a.rows.map((r) => r.line), [1, 2, 3]);
        },
    },
    {
        name: 'D3a.2 serial dates: 1900 system with the leap-year bug, 1904 system',
        async fn(assert) {
            assert('45658', serialToIso(45658), '2025-01-01');
            assert('1', serialToIso(1), '1900-01-01');
            assert('59', serialToIso(59), '1900-02-28');
            assert('60 is the phantom day', serialToIso(60), '1900-02-29');
            assert('61', serialToIso(61), '1900-03-01');
            assert('time fraction ignored', serialToIso(45658.75), '2025-01-01');
            assert('1904', serialToIso(0 + 1, true), '1904-01-02');
            assert('bad', serialToIso(-3), null);
            const r = await readXlsx(await buildXlsx({ rows: [['a', 'b'], [DATE(45658), DATE(45659, 2)]] }));
            assert('built-in and custom date formats', r.rows[1], ['2025-01-01', '2025-01-02']);
            const plain = await readXlsx(await buildXlsx({ rows: [['a', 'b'], [45658, 12.5]] }));
            assert('General-format numbers stay numbers', plain.rows[1], ['45658', '12.5']);
            const r1904 = await readXlsx(await buildXlsx({ date1904: true, rows: [['a', 'b'], [DATE(1), 'x']] }));
            assert('1904 workbook', r1904.rows[1][0], '1904-01-02');
        },
    },
    {
        name: 'D3a.3 numbers stored as text and float noise import as money',
        async fn(assert) {
            const r = await readXlsx(await buildXlsx({
                rows: [['Date', 'Description', 'Amount'], [{ text: '03/01/2025' }, 'FAKE CAFE', '-1,234.56'], [DATE(45660), 'FAKE REFUND', 12.100000000000001]],
            }));
            assert('float noise cleaned', r.rows[2][2], '12.1');
            const det = detectColumns(r.rows);
            const { transactions, errors } = normaliseRows(r.rows, det.mapping, { skipHeader: det.headerRow });
            assert('no row errors', errors, []);
            assert('text date and text amount', transactions.map((t) => [t.date, t.amountCents]), [['2025-01-03', -123456], ['2025-01-03', 1210]]);
        },
    },
    {
        name: 'D3a.4 merged banner and title rows are skipped; header detection still works',
        async fn(assert) {
            const rows = [
                ['FAKE BANK  Account statement', null, null, null],
                ['Account: 000-000 (synthetic)'],
                [],
                ['Date', 'Description', 'Debit', 'Credit'],
                [DATE(45658), 'FAKE SHOP', '10.00', null],
            ];
            const r = await readXlsx(await buildXlsx({ rows, merges: ['A1:D1'] }));
            assert('header first', r.rows[0], ['Date', 'Description', 'Debit', 'Credit']);
            assert('sheet row numbers kept', r.rows.map((x) => x.line), [4, 5]);
            const det = detectColumns(r.rows);
            assert('detected', [det.headerRow, det.mapping.date, det.mapping.debit], [true, 0, 2]);
        },
    },
    {
        name: 'D3a.5 corrupt, encrypted, unsupported and oversize workbooks are refused, never junk rows',
        async fn(assert) {
            const good = await buildXlsx({ rows: SIMPLE });
            assert('garbage', await code(readXlsx(new Uint8Array(500).fill(7))), 'corrupt');
            assert('empty', await code(readXlsx(new Uint8Array(0))), 'corrupt');
            assert('truncated', await code(readXlsx(good.slice(0, good.length - 40))), 'corrupt');
            const stored = await buildXlsx({ rows: SIMPLE, inline: true, method: 0 });
            const flipped = stored.slice();
            const at = new TextDecoder('latin1').decode(flipped).indexOf('WOOLWORTHS');
            flipped[at] ^= 0x01; // one flipped bit inside the stored sheet data
            assert('bit rot', await code(readXlsx(flipped)), 'corrupt');
            const ole = new Uint8Array(600);
            ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
            assert('password-protected (OLE2) container', await code(readXlsx(ole)), 'encrypted');
            const enc = await buildZip([{ name: 'xl/workbook.xml', data: '<x/>', flags: 1 }]);
            assert('encrypted zip entry', await code(readXlsx(enc)), 'encrypted');
            const odd = await buildZip([{ name: 'xl/workbook.xml', data: '<x/>', method: 0 }]);
            const cd = new DataView(odd.buffer).getUint32(odd.length - 6, true);
            new DataView(odd.buffer).setUint16(cd + 10, 12, true);
            assert('unsupported method', await code(readXlsx(odd)), 'unsupported');
            assert('no workbook part', await code(readXlsx(await buildZip([{ name: 'hello.txt', data: 'hi' }]))), 'corrupt');
            assert('empty sheet', await code(readXlsx(await buildXlsx({ rows: [] }))), 'empty');
            const badIdx = await buildXlsx({ rows: [['a', 'b']], files: { 'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>99</v></c></row></sheetData></worksheet>' } });
            assert('shared string index out of range', await code(readXlsx(badIdx)), 'corrupt');
            const badXml = await buildXlsx({ rows: [['a', 'b']], files: { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData></worksheet>' } });
            assert('malformed xml', await code(readXlsx(badXml)), 'corrupt');
        },
    },
    {
        name: 'D3a.5 limits: entity expansion, zip bomb, entry count, size',
        async fn(assert) {
            const dt = '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>&b;</t></si></sst>';
            assert('DOCTYPE/ENTITY refused', await code(readXlsx(await buildXlsx({ rows: [['a', 'b']], files: { 'xl/sharedStrings.xml': dt } }))), 'unsafe');

            const bomb = await buildXlsx({ rows: [['a', 'b']], files: { 'xl/worksheets/sheet2.xml': new Uint8Array(XLSX_LIMITS.maxEntryBytes - 1) } });
            assert('zip bomb ratio', await code(readXlsx(bomb)), 'too-large');

            const many = [];
            for (let i = 0; i <= XLSX_LIMITS.maxEntries; i++) many.push({ name: 'f' + i + '.txt', data: 'x', method: 0 });
            assert('too many entries', await code(readXlsx(await buildZip(many))), 'too-large');

            const good = await buildXlsx({ rows: SIMPLE });
            assert('file size cap', await code(readXlsx(good, { maxFileBytes: 100 })), 'too-large');
            assert('entry size cap', await code(readXlsx(good, { maxEntryBytes: 50 })), 'too-large');
            assert('total size cap', await code(readXlsx(good, { maxTotalBytes: 50 })), 'too-large');
            assert('row cap', await code(readXlsx(good, { maxRows: 2 })), 'too-large');
            assert('cell cap', await code(readXlsx(good, { maxCells: 3 })), 'too-large');
            assert('column cap', await code(readXlsx(good, { maxCols: 2 })), 'too-large');

            // header lies about the size: streaming inflate must still stop at the declared size
            const liar = await buildXlsx({ rows: SIMPLE });
            const ldv = new DataView(liar.buffer);
            let p = ldv.getUint32(liar.length - 6, true);
            for (;;) {
                const nlen = ldv.getUint16(p + 28, true);
                const name = new TextDecoder().decode(liar.subarray(p + 46, p + 46 + nlen));
                if (name === 'xl/workbook.xml') { ldv.setUint32(p + 24, 5, true); break; } // usize = 5
                p += 46 + nlen + ldv.getUint16(p + 30, true) + ldv.getUint16(p + 32, true);
            }
            assert('declared size is enforced', ['too-large', 'corrupt'].includes(await code(readXlsx(liar))), true);
        },
    },
    {
        name: 'S3.M2 inflate aborts at the cap and does not buffer the whole bomb',
        async fn(assert) {
            // 128 MB of zeros deflates to ~128 KB (ratio ~1000:1). Read with a 1 MB cap.
            const big = new Uint8Array(128 * 1024 * 1024);
            const cs = new CompressionStream('deflate-raw');
            const w = cs.writable.getWriter();
            w.write(big); w.close();
            const parts = [];
            const r = cs.readable.getReader();
            for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); }
            const comp = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
            let o = 0; for (const p of parts) { comp.set(p, o); o += p.length; }
            const slices = Math.ceil(comp.length / (16 * 1024));
            assert('fixture is a real bomb', comp.length < 512 * 1024 && slices >= 6, true);

            const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
            const before = mem();
            const stats = {};
            let err = null;
            try { await inflateCapped(comp, 1024 * 1024, { stats }); } catch (e) { err = e; }
            assert('refused as too-large', err instanceof XlsxError && err.code, 'too-large');
            assert('input was not fed to the end', stats.fed < comp.length, true);
            assert('at most a few slices were fed', stats.fed <= 4 * 16 * 1024, true);
            if (performance.memory) assert('heap growth stays small (< 96 MB)', mem() - before < 96 * 1024 * 1024, true);

            let ratioErr = null;
            try { await inflateCapped(comp, Infinity, { maxRatio: 100, minRatioBytes: 1024 * 1024 }); } catch (e) { ratioErr = e; }
            assert('ratio guard trips while inflating', ratioErr instanceof XlsxError && ratioErr.code, 'too-large');

            const small = await buildXlsx({ rows: SIMPLE });
            assert('normal workbooks still read', (await readXlsx(small)).rows.length, 3);
        },
    },
    {
        name: 'S3.L4 repeated r="1" rows still hit the row cap',
        async fn(assert) {
            const row = '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c></row>';
            const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + row.repeat(5) + '</sheetData></worksheet>';
            const x = await buildXlsx({ rows: [['a', 'b']], files: { 'xl/worksheets/sheet1.xml': sheet } });
            assert('5 rows with r=1 against maxRows 3', await code(readXlsx(x, { maxRows: 3 })), 'too-large');
            const ok = await readXlsx(x, { maxRows: 10 });
            assert('under the cap they read, with increasing line numbers', ok.rows.map((r) => r.line), [1, 2, 3, 4, 5]);
        },
    },
];
