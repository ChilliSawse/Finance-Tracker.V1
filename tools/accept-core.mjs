// D4: the acceptance report. Pure functions that run the REAL import code (csv.js,
// xlsx.js rows, pdf-statement.js, payslip.js) over a file Chilli picks and build a
// report that carries NO text from the file: no amounts, descriptions, names or
// account numbers. The report is a flat object of integers, booleans and members
// of fixed vocabularies; renderReport() prints it from a fixed label table only.
// Used by tools/accept.html (browser) and by src/import/accept.test-cases.js.

import { detectColumns, normaliseRows } from '../src/import/csv.js';
import { parseStatementPages, BANK_CONFIGS } from '../src/import/pdf-statement.js';
import { parsePayslipLines } from '../src/import/payslip.js';
import { makeTransaction } from '../src/state/transactions.js';

// The only words a report may contain besides labels. Provider names are the
// payslip parser's own fixed list; anything else collapses to 'unknown'.
const PROVIDER_NAMES = ['Xero', 'MYOB', 'ADP', 'KeyPay', 'Employment Hero'];
const SCHEDULES = ['weekly', 'fortnightly', 'monthly'];
const BANK_NAMES = BANK_CONFIGS.map((b) => b.name);

const int = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
const bool = (v) => v === true || (v != null && v !== false && v !== 0 && v !== '');
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const monthOf = (iso) => (/^\d{4}-\d{2}/.test(String(iso)) ? String(iso).slice(0, 7) : null);

/**
 * Stand-in for the real add-then-add-again run (accept.html uses addTransactions on a
 * scratch IndexedDB): count-based dedupe on the real transactionHash.
 * @param {Array<{hash:string}>} txns
 */
export async function pureReimport(txns) {
    const seen = new Set();
    const keyed = (list) => {
        const occ = new Map();
        return list.map((t) => { const n = (occ.get(t.hash) || 0) + 1; occ.set(t.hash, n); return n === 1 ? t.hash : `${t.hash}#${n}`; });
    };
    for (const k of keyed(txns)) seen.add(k);
    let duplicates = 0;
    for (const k of keyed(txns)) if (seen.has(k)) duplicates++;
    return { added: 0, duplicates };
}

async function transactionStats(kind, txns, extra, reimport) {
    const rows = txns.filter((t) => Number.isInteger(t.amountCents));
    let negative = 0, positive = 0, zero = 0;
    const months = [];
    for (const t of rows) {
        if (t.amountCents < 0) negative++; else if (t.amountCents > 0) positive++; else zero++;
        const m = monthOf(t.date);
        if (m) months.push(m);
    }
    months.sort();
    const built = rows.map((t) => makeTransaction({ date: t.date, description: t.description, amountCents: t.amountCents, source: 'csv' }));
    const re = built.length ? await reimport(built) : { duplicates: 0 };
    return {
        kind,
        rows: rows.length,
        firstMonth: months[0] || null,
        lastMonth: months[months.length - 1] || null,
        negative, positive, zero,
        duplicatesOnReimport: int(re.duplicates),
        ...extra,
    };
}

/**
 * CSV or XLSX rows (string[][] from parseCsv().rows or readXlsx().rows).
 * @param {'csv'|'xlsx'} kind
 */
export async function reportFromRows(kind, rows, { parseErrors = 0, invert = false, reimport = pureReimport } = {}) {
    const detected = detectColumns(rows);
    const m = detected.mapping;
    const split = m.debit != null && m.credit != null;
    const norm = normaliseRows(rows, m, { skipHeader: !!detected.headerRow, invert });
    return transactionStats(kind, norm.transactions, {
        unparsed: int(norm.errors.length) + int(parseErrors),
        outOfRange: int(norm.outOfRange),
        bank: null,
        provider: null,
        fields: {
            headerRowDetected: bool(detected.headerRow),
            dateColumn: m.date != null,
            descriptionColumn: m.description != null,
            amountColumn: m.amount != null,
            splitDebitCreditColumns: split,
        },
    }, reimport);
}

/** PDF bank statement: pages = extractPagesLines() output. */
export async function reportFromStatementPages(pages, { invert = false, reimport = pureReimport } = {}) {
    const r = parseStatementPages(pages, { invert });
    return transactionStats('pdf', r.transactions, {
        unparsed: int(r.skipped),
        outOfRange: 0,
        bank: r.bank ? oneOf(r.bank.name, BANK_NAMES, 'unknown') : 'none',
        provider: null,
        fields: { bankDetected: !!r.bank, anyRows: r.transactions.length > 0 },
    }, reimport);
}

/** Payslip: lines = string[] (one per visual line). */
export function reportFromPayslipLines(lines) {
    const p = parsePayslipLines(lines);
    return {
        kind: 'payslip',
        rows: 0, firstMonth: null, lastMonth: null, negative: 0, positive: 0, zero: 0,
        duplicatesOnReimport: 0,
        unparsed: 0, outOfRange: 0,
        bank: null,
        provider: p.provider ? oneOf(p.provider, PROVIDER_NAMES, 'unknown') : 'none',
        schedule: p.schedule ? oneOf(p.schedule, SCHEDULES, 'unknown') : 'none',
        fields: {
            net: p.net != null, tax: p.tax != null, gross: p.gross != null,
            super: p.super != null, help: p.help != null,
            grossWasDerived: bool(p.grossDerived),
        },
    };
}

// ---- rendering: fixed labels + numbers/booleans/whitelisted words only ----

const yn = (v) => (v ? 'yes' : 'no');
const FIELD_LABELS = {
    headerRowDetected: 'Header row detected',
    dateColumn: 'Date column found',
    descriptionColumn: 'Description column found',
    amountColumn: 'Amount column found',
    splitDebitCreditColumns: 'Separate debit and credit columns',
    bankDetected: 'Bank recognised',
    anyRows: 'Any transaction rows read',
    net: 'Net pay found',
    tax: 'Tax found',
    gross: 'Gross found',
    super: 'Super found',
    help: 'HELP repayment found',
    grossWasDerived: 'Gross was worked out (net + tax)',
};

/** @returns {string} the report as plain text. Nothing in it comes from the file but numbers, booleans and fixed words. */
export function renderReport(r) {
    const out = [`Ledger acceptance report (${oneOf(r.kind, ['csv', 'xlsx', 'pdf', 'payslip'], 'unknown')})`];
    if (r.kind === 'payslip') {
        out.push(`Provider detected: ${oneOf(r.provider, [...PROVIDER_NAMES, 'unknown', 'none'], 'unknown')}`);
        out.push(`Pay schedule detected: ${oneOf(r.schedule, [...SCHEDULES, 'unknown', 'none'], 'unknown')}`);
    } else {
        out.push(`Rows read: ${int(r.rows)}`);
        const okMonth = (m) => /^[0-9]{4}-[0-9]{2}$/.test(String(m));
        out.push(`Month range: ${okMonth(r.firstMonth) && okMonth(r.lastMonth) ? `${r.firstMonth} to ${r.lastMonth}` : 'none'}`);
        out.push(`Sign split: ${int(r.negative)} negative, ${int(r.positive)} positive, ${int(r.zero)} zero`);
        out.push(`Duplicates on re-import: ${int(r.duplicatesOnReimport)} of ${int(r.rows)}`);
        out.push(`Unparsed lines: ${int(r.unparsed)}`);
        out.push(`Amounts out of range: ${int(r.outOfRange)}`);
        if (r.kind === 'pdf') out.push(`Bank detected: ${oneOf(r.bank, [...BANK_NAMES, 'unknown', 'none'], 'unknown')}`);
    }
    for (const [key, label] of Object.entries(FIELD_LABELS)) {
        if (key in r.fields) out.push(`${label}: ${yn(r.fields[key])}`);
    }
    return out.join('\n');
}
