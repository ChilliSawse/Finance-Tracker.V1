// S1: backup import and load hardening. Pure: storage and the store are in-memory fakes.

import {
    sanitizeFinanceData, sanitizeGuiSettings, normaliseCurrency, safeNumber, prepareImport, commitImport,
    quarantineCorruptSave, csvSafeText, buildTransactionsCsv, MAX_IMPORT_BYTES, PRE_RESTORE_KEY, CORRUPT_PREFIX,
} from './sanitize.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings } from './defaults.js';
import { formatCurrency } from '../utils.js';

const XSS = '<iframe srcdoc="<script nonce=ft-fouc-init>alert(1)</script>"></iframe>';

function memStorage(initial = {}, opts = {}) {
    const map = new Map(Object.entries(initial));
    return {
        map,
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem(k, v) { if (opts.throwOnSet) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    };
}

/** The reviewer's evil backup, as raw JSON text (so __proto__ is an own key, as JSON.parse makes it). */
function evilBackupText() {
    const fd = cloneDefaultFinanceData();
    fd.currency = XSS;
    fd.fiSettings.multiple = 25;
    fd.liabilities[0].interestRate = '3<b id=injected-rate>INJ</b>';
    fd.allocation[0].percentage = '"><iframe srcdoc=x>';
    fd.incomeSources[0].hoursPerCycle = 'NaN';
    fd.incomeSources[0].grossAnnual = 1e30;
    fd.assets[0].balance = '1e999';
    const text = JSON.stringify({ financeData: fd, guiSettings: cloneDefaultGuiSettings() });
    // Add prototype keys the way an attacker's file would carry them.
    return text.replace('"currency":', '"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"currency":');
}

function containsKey(o, names, seen = new Set()) {
    if (!o || typeof o !== 'object' || seen.has(o)) return false;
    seen.add(o);
    for (const k of Object.keys(o)) {
        if (names.includes(k) || containsKey(o[k], names, seen)) return true;
    }
    return false;
}

function allNumbersFinite(o, keys, seen = new Set()) {
    if (!o || typeof o !== 'object' || seen.has(o)) return true;
    seen.add(o);
    for (const k of Object.keys(o)) {
        const v = o[k];
        if (keys.includes(k) && (typeof v !== 'number' || !Number.isFinite(v))) return false;
        if (!allNumbersFinite(v, keys, seen)) return false;
    }
    return true;
}

function fakeStore() {
    return { financeData: { ...cloneDefaultFinanceData(), marker: 'before' }, guiSettingsData: cloneDefaultGuiSettings() };
}

export const SANITIZE_TEST_CASES = [
    {
        name: 'S1.1 currency: only a known three-letter code survives',
        fn(assert) {
            assert('valid', [normaliseCurrency('USD'), normaliseCurrency('AUD')], ['USD', 'AUD']);
            assert('hostile or odd', [normaliseCurrency(XSS), normaliseCurrency('aud'), normaliseCurrency('ZZZ'), normaliseCurrency(5), normaliseCurrency(null)],
                ['AUD', 'AUD', 'AUD', 'AUD', 'AUD']);
        },
    },
    {
        name: 'S1.2 formatCurrency never emits < or > for hostile currency or amounts',
        fn(assert) {
            const outs = [
                formatCurrency(12.5, XSS), formatCurrency(1, '<b>'), formatCurrency(NaN, 'USD'),
                formatCurrency(Infinity, 'EUR'), formatCurrency('<script>', 'AUD'), formatCurrency(1e300, 'GBP'),
                formatCurrency(5, 'ZZZ'), formatCurrency(5, '"><img src=x>'),
            ];
            assert('no angle brackets or quotes', outs.some((s) => /[<>"]/.test(s)), false);
            assert('still formats a normal amount', formatCurrency(12.5, 'AUD', 2).includes('12.50'), true);
        },
    },
    {
        name: 'S1.3 safeNumber: finite and bounded',
        fn(assert) {
            assert('values', [safeNumber(NaN), safeNumber(Infinity), safeNumber(-Infinity), safeNumber('12.5'), safeNumber('x'), safeNumber(1e30), safeNumber(-1e30), safeNumber({}), safeNumber(7)],
                [0, 0, 0, 12.5, 0, 1e12, -1e12, 0, 7]);
        },
    },
    {
        name: 'S1.4 sanitizeFinanceData: prototype keys gone at every depth, own copy',
        fn(assert) {
            const parsed = JSON.parse('{"__proto__":{"a":1},"currency":"AUD","plan":[{"constructor":{"x":1},"name":"n","nested":{"prototype":{"y":1}}}]}');
            const out = sanitizeFinanceData(parsed);
            assert('keys', containsKey(out, ['__proto__', 'constructor', 'prototype']), false);
            assert('prototype untouched', [Object.getPrototypeOf(out) === Object.prototype, ({}).a], [true, undefined]);
            assert('kept the rest', out.plan[0].name, 'n');
        },
    },
    {
        name: 'S1.5 sanitizeFinanceData: numeric fields coerced finite and bounded, strings stay strings',
        fn(assert) {
            const out = sanitizeFinanceData({
                currency: 'AUD',
                liabilities: [{ name: '<b>x</b>', balance: '5<b>', interestRate: NaN }],
                allocation: [{ name: 'A', percentage: Infinity, currentBalance: 1e30 }],
                savingModel: { transfers: { bankSetTo: { a: 'x', b: 250 } }, fire: { targets: [{ savedCents: 'zz', label: 'L' }] } },
                taxBrackets: [{ min: 0, max: null, rate: 0.1 }],
                unknown: { whatever: '<i>', n: 4 },
            });
            assert('numbers', [out.liabilities[0].balance, out.liabilities[0].interestRate, out.allocation[0].percentage, out.allocation[0].currentBalance],
                [0, 0, 0, 1e12]);
            assert('map and cents', [out.savingModel.transfers.bankSetTo, out.savingModel.fire.targets[0].savedCents], [{ a: 0, b: 250 }, 0]);
            assert('strings kept, not escaped', [out.liabilities[0].name, out.savingModel.fire.targets[0].label, out.unknown.whatever], ['<b>x</b>', 'L', '<i>']);
            assert('open top band stays null', out.taxBrackets[0].max, null);
        },
    },
    {
        name: 'S1.6 sanitizeFinanceData: long strings are capped; deep nesting is cut',
        fn(assert) {
            const out = sanitizeFinanceData({ note: 'x'.repeat(100000) });
            assert('cap', out.note.length, 5000);
            let deep = {}; let cur = deep;
            for (let i = 0; i < 200; i++) { cur.a = {}; cur = cur.a; }
            let n = 0; let c = sanitizeFinanceData(deep);
            while (c && typeof c === 'object') { c = c.a; n++; }
            assert('depth bounded', n < 100, true);
        },
    },
    {
        name: 'S1.7 sanitizeGuiSettings strips prototype keys and caps strings',
        fn(assert) {
            const out = sanitizeGuiSettings(JSON.parse('{"__proto__":{"p":1},"theme":"sunrise","x":{"constructor":1}}'));
            assert('clean', [containsKey(out, ['__proto__', 'constructor']), out.theme], [false, 'sunrise']);
        },
    },
    {
        name: 'S1.8 prepareImport: the crafted backup comes out safe (currency, numbers, prototype keys)',
        fn(assert) {
            const r = prepareImport(evilBackupText());
            assert('ok', r.ok, true);
            const fd = r.financeData;
            assert('currency', fd.currency, 'AUD');
            assert('no proto keys', containsKey(fd, ['__proto__', 'constructor', 'prototype']), false);
            assert('prototype of the data is plain', Object.getPrototypeOf(fd) === Object.prototype, true);
            assert('numbers finite', allNumbersFinite(fd, ['interestRate', 'percentage', 'hoursPerCycle', 'grossAnnual', 'balance']), true);
            assert('clamped', fd.incomeSources[0].grossAnnual, 1e12);
            assert('no angle brackets in any formatted value', formatCurrency(fd.assets[0].balance, fd.currency).includes('<'), false);
        },
    },
    {
        name: 'S1.9 prepareImport refuses an oversized or malformed file',
        fn(assert) {
            assert('big', prepareImport('x'.repeat(MAX_IMPORT_BYTES + 1)).ok, false);
            assert('not json', prepareImport('{nope').ok, false);
            assert('no data', prepareImport('{"financeData":{}}').ok, false);
        },
    },
    {
        name: 'S1.10 a failed import leaves the store deep-equal and writes nothing',
        fn(assert) {
            const store = fakeStore();
            const before = JSON.stringify(store);
            const st = memStorage({ financeTrackerData_v2: '{"old":1}' });
            const keysBefore = JSON.stringify([...st.map.entries()]);
            const bad = prepareImport('{"financeData":{"incomeSources":"no"},"guiSettings":{}}');
            assert('rejected', bad.ok, false);
            // A good import whose render throws is rolled back.
            const good = prepareImport(evilBackupText());
            let rendered = 0;
            const res = commitImport(store, good, { storage: st, render: () => { rendered++; if (rendered === 1) throw new Error('render boom'); }, save: () => { throw new Error('must not save'); } });
            assert('failed', res.ok, false);
            assert('store identical', JSON.stringify(store), before);
            const after = new Map(st.map); after.delete(PRE_RESTORE_KEY);
            assert('nothing else written', JSON.stringify([...after.entries()]), keysBefore);
        },
    },
    {
        name: 'S1.11 a successful import snapshots the old data to ft-pre-restore-backup, one copy',
        fn(assert) {
            const store = fakeStore();
            const st = memStorage({ financeTrackerData_v2: '{"old":1}' });
            let saved = 0;
            const good = prepareImport(evilBackupText());
            const r1 = commitImport(store, good, { storage: st, render: () => {}, save: () => { saved++; } });
            const r2 = commitImport(store, prepareImport(evilBackupText()), { storage: st, render: () => {}, save: () => { saved++; } });
            assert('ok and saved', [r1.ok, r2.ok, saved], [true, true, 2]);
            assert('snapshot key', [st.map.has(PRE_RESTORE_KEY), [...st.map.keys()].filter((k) => k.startsWith('ft-pre-restore')).length], [true, 1]);
            assert('store replaced', store.financeData.marker, undefined);
        },
    },
    {
        name: 'S1.12 import aborts when the safety copy cannot be written, store untouched',
        fn(assert) {
            const store = fakeStore();
            const before = JSON.stringify(store);
            const r = commitImport(store, prepareImport(evilBackupText()), { storage: memStorage({}, { throwOnSet: true }), render: () => {}, save: () => {} });
            assert('refused', [r.ok, JSON.stringify(store)], [false, before]);
        },
    },
    {
        name: 'S1.13 import treats a chain abort as a failed import',
        fn(assert) {
            // A bucket step that cannot balance aborts the chain; the data below makes needs() throw.
            const bad = JSON.stringify({
                financeData: { incomeSources: [], essentialExpenses: [], nonEssentialExpenses: [], assets: [], liabilities: [], fiSettings: { multiple: 25 }, dataVersion: 0, plan: 5, savingModel: { version: 0 }, allocation: [{ name: 'x', percentage: 50, currentBalance: 1 }] },
                guiSettings: {},
            });
            const r = prepareImport(bad);
            // Either it migrates cleanly or it is refused; it must never return ok with an aborted chain.
            assert('consistent', r.ok === true ? Array.isArray(r.financeData.plan) : typeof r.error === 'string', true);
        },
    },
    {
        name: 'S1.14 corrupt save: raw string copied once to ft-corrupt-save-<ts>',
        fn(assert) {
            const raw = '{"financeData":{"truncated';
            const st = memStorage({ financeTrackerData_v2: raw });
            const a = quarantineCorruptSave(raw, st, 1700000000000);
            const b = quarantineCorruptSave(raw, st, 1700000009999);
            assert('first creates', [a.created, a.key], [true, CORRUPT_PREFIX + '1700000000000']);
            assert('second reuses', [b.created, b.key], [false, CORRUPT_PREFIX + '1700000000000']);
            assert('exact bytes, one copy', [st.getItem(a.key), [...st.map.keys()].filter((k) => k.startsWith(CORRUPT_PREFIX)).length], [raw, 1]);
            assert('original kept', st.getItem('financeTrackerData_v2'), raw);
            assert('storage failure never throws', quarantineCorruptSave(raw, memStorage({}, { throwOnSet: true })).key, null);
        },
    },
    {
        name: 'S1.15 CSV: formula-starting text cells are neutralised, amounts stay numbers',
        fn(assert) {
            assert('prefix', ['=1+1', '+SUM(A1)', '-2+3', '@x', '\tx', '\rx', ' =HYPERLINK("u")'].map(csvSafeText),
                ["'=1+1", "'+SUM(A1)", "'-2+3", "'@x", "'\tx", "'\rx", "' =HYPERLINK(\"u\")"]);
            assert('plain untouched', [csvSafeText('Coles'), csvSafeText(''), csvSafeText(null), csvSafeText('a=b')], ['Coles', '', '', 'a=b']);
            const csv = buildTransactionsCsv([
                { date: '2026-01-02', description: '=HYPERLINK("http://x","Refund")', amountCents: -1234, categoryId: 'c1' },
                { date: '=2+2', description: 'Pay', amountCents: 500, categoryId: 'c2' },
            ], (id) => (id === 'c1' ? '@cat' : 'Other'));
            const lines = csv.split('\r\n');
            assert('header', lines[0], 'Date,Description,Amount,Category');
            assert('oldest first, desc neutralised, amount plain', lines[2], '2026-01-02,"\'=HYPERLINK(""http://x"",""Refund"")",-12.34,"\'@cat"');
            assert('bad date neutralised', lines[1], '"\'=2+2","Pay",5.00,"Other"');
        },
    },
];
