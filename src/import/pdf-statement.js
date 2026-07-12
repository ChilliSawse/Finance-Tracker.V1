// Bank statement PDF → transactions. Pure parsing over the positioned lines
// that pdfjs-loader.extractPagesLines produces — no DOM, no store, no pdf.js
// import — so the whole engine is unit-testable with fabricated line arrays.
//
// Strategy: one generic engine (date at the line start + money at the line
// end) tuned by a per-bank config chosen from header text. The engine deals
// with the three things AU statements actually vary on:
//   1. date formats (dd/mm/yyyy vs "01 Jul" without a year),
//   2. signed single amount vs unsigned debit/credit columns,
//   3. a trailing running-balance column that must be ignored.
// Unsigned debit/credit columns are resolved by x-position against the header
// row ("Debit"/"Withdrawals"/"Money out" …), which positioned extraction makes
// reliable. Amounts land in integer CENTS via the shared parseAmountToCents.

import { parseAmountToCents, parseDateToIso } from './csv.js';

// ---------- bank detection ----------

export const BANK_CONFIGS = [
    { id: 'ing', name: 'ING', detect: /ing\s*(bank|direct)|ing\.com\.au|orange everyday|bsb.*923/i },
    { id: 'up', name: 'Up', detect: /\bup\b.*(statement|account)|up\.com\.au|ferocia/i },
    { id: 'westpac', name: 'Westpac', detect: /westpac/i },
    { id: 'anz', name: 'ANZ', detect: /\banz\b|australia and new zealand banking/i },
    { id: 'commbank', name: 'CommBank', detect: /commonwealth bank|commbank|netbank/i },
    { id: 'nab', name: 'NAB', detect: /\bnab\b|national australia bank/i },
    { id: 'bendigo', name: 'Bendigo Bank', detect: /bendigo( and adelaide)? bank/i },
];

/** Pick a bank config from the document's text, or null for the generic path. */
export function detectBank(allText) {
    for (const cfg of BANK_CONFIGS) {
        if (cfg.detect.test(allText)) return cfg;
    }
    return null;
}

// ---------- helpers ----------

const SKIP_LINE = /opening balance|closing balance|balance brought forward|balance carried forward|^total[s]?\b|statement (of|period|number)|page \d+ of|continued (on|from)|interest rate|bsb\b/i;

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "01 Jul" / "1 July" — day + month with NO year (CommBank/NAB style).
function parseDayMonth(str) {
    const m = String(str).trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?$/);
    if (!m) return null;
    const day = Number(m[1]);
    const monIdx = MONTHS_SHORT.indexOf(m[2].slice(0, 3).toLowerCase());
    if (monIdx === -1 || day < 1 || day > 31) return null;
    return { day, month: monIdx + 1 };
}

/** Every 4-digit year present in the document — used to pin year-less dates. */
export function collectYears(allText) {
    const years = new Set();
    for (const m of allText.matchAll(/\b(19[7-9]\d|20[0-4]\d)\b/g)) years.add(Number(m[1]));
    return [...years].sort();
}

// Money token: something parseAmountToCents accepts AND that actually looks
// monetary (has a decimal point or a $/CR/DR marker) — bare integers like a
// receipt number or the "4" in "Page 4" must not count.
function moneyCents(str) {
    const s = String(str).trim();
    if (!/\d/.test(s)) return null;
    if (!/[.$]|(\bCR\b)|(\bDR\b)/i.test(s)) return null;
    return parseAmountToCents(s);
}

// ---------- header (column) detection for unsigned debit/credit layouts ----------

const DEBIT_HEAD = /debit|withdraw|money out|spent/i;
const CREDIT_HEAD = /credit|deposit|money in|received/i;
const BALANCE_HEAD = /balance/i;

/**
 * Find debit/credit/balance column x-centres from a header line, if the page
 * has one. Returns null when the statement doesn't use that layout.
 */
export function findColumns(pageLines) {
    for (const line of pageLines) {
        if (!DEBIT_HEAD.test(line.text) || !CREDIT_HEAD.test(line.text)) continue;
        let debitX = null, creditX = null, balanceX = null;
        for (const item of line.items) {
            if (debitX === null && DEBIT_HEAD.test(item.str)) debitX = item.x;
            else if (creditX === null && CREDIT_HEAD.test(item.str)) creditX = item.x;
            else if (balanceX === null && BALANCE_HEAD.test(item.str)) balanceX = item.x;
        }
        if (debitX !== null && creditX !== null) return { debitX, creditX, balanceX };
    }
    return null;
}

// Classify an amount item against detected column positions. Amounts are
// right-aligned, so compare the item's x to the nearest header x.
function classifyByColumn(item, cols) {
    const candidates = [
        { kind: 'debit', x: cols.debitX },
        { kind: 'credit', x: cols.creditX },
    ];
    if (cols.balanceX !== null) candidates.push({ kind: 'balance', x: cols.balanceX });
    let best = null;
    for (const c of candidates) {
        const dist = Math.abs(item.x - c.x);
        if (!best || dist < best.dist) best = { kind: c.kind, dist };
    }
    // Tolerance: right-aligned numbers start left of the header text’s x, but
    // hugely distant matches mean “not actually in a column”.
    return best && best.dist <= 120 ? best.kind : null;
}

// ---------- the engine ----------

/**
 * Parse positioned page lines into normalised transactions.
 * @param {Array<Array<{y, text, items:[{x, str}]}>>} pages - from extractPagesLines.
 * @param {{invert?: boolean}} [options] - invert flips all signs (statements
 *     that print spending as positive with no debit/credit columns).
 * @returns {{transactions: Array<{date, description, amountCents}>,
 *            bank: ?object, skipped: number}}
 */
export function parseStatementPages(pages, options = {}) {
    const { invert = false } = options;
    const allText = pages.map(lines => lines.map(l => l.text).join('\n')).join('\n');
    const bank = detectBank(allText);
    const years = collectYears(allText);
    const fallbackYear = years.length ? years[years.length - 1] : new Date().getFullYear();

    const transactions = [];
    let skipped = 0;
    let last = null; // most recent transaction — absorbs wrapped description lines

    for (const pageLines of pages) {
        const cols = findColumns(pageLines);

        for (const line of pageLines) {
            if (SKIP_LINE.test(line.text)) { last = null; continue; }

            // 1. Date — from the first one-to-three items on the line.
            const parsed = readLeadingDate(line, fallbackYear, years);
            if (!parsed) {
                // Continuation line: description text wrapped under its transaction.
                if (last && line.items.length && !line.items.some(i => moneyCents(i.str) !== null)) {
                    const extra = line.text.trim();
                    if (extra && last.description.length + extra.length < 180) {
                        last.description = `${last.description} ${extra}`.trim();
                    }
                }
                continue;
            }

            // 2. Money — the trailing amount items.
            const moneyItems = [];
            for (let i = line.items.length - 1; i >= parsed.consumed; i--) {
                const cents = moneyCents(line.items[i].str);
                if (cents === null) break; // stop at the first non-money from the right
                moneyItems.unshift({ item: line.items[i], cents });
            }
            if (!moneyItems.length) { last = null; continue; }

            // 3. Description — everything between the date and the money.
            const desc = line.items
                .slice(parsed.consumed, line.items.length - moneyItems.length)
                .map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();

            // 4. Amount + sign.
            const amountCents = resolveAmount(moneyItems, cols);
            if (amountCents === null) { skipped++; last = null; continue; }

            const txn = {
                date: parsed.date,
                description: desc,
                amountCents: invert && amountCents !== 0 ? -amountCents : amountCents,
            };
            transactions.push(txn);
            last = txn;
        }
    }
    return { transactions, bank, skipped };
}

// Leading date: dd/mm/yyyy-style in the first item(s), or "01 Jul" pinned to a
// year seen in the document. Returns { date, consumed } — how many leading
// items the date used — or null.
function readLeadingDate(line, fallbackYear, years) {
    const items = line.items;
    if (!items.length) return null;

    // Single-item full date ("13/06/2026", "13 Jun 2026", "2026-06-13").
    const one = parseDateToIso(items[0].str);
    if (one) return { date: one, consumed: 1 };

    // Two/three items forming "13 Jun 2026" (pdf text often splits tokens).
    for (const take of [2, 3]) {
        if (items.length >= take) {
            const joined = items.slice(0, take).map(i => i.str).join(' ').trim();
            const multi = parseDateToIso(joined);
            if (multi) return { date: multi, consumed: take };
        }
    }

    // Year-less "01 Jul" (single item or split across two).
    for (const take of [1, 2]) {
        if (items.length < take) continue;
        const joined = items.slice(0, take).map(i => i.str).join(' ').trim();
        const dm = parseDayMonth(joined);
        if (dm) {
            const year = pickYear(dm, years, fallbackYear);
            const iso = `${year}-${String(dm.month).padStart(2, '0')}-${String(dm.day).padStart(2, '0')}`;
            return { date: iso, consumed: take };
        }
    }
    return null;
}

// A year-less date belongs to whichever candidate year doesn't put it in the
// future — statements are historical documents.
function pickYear(dm, years, fallbackYear) {
    const now = new Date();
    const candidates = years.length ? [...years].reverse() : [fallbackYear];
    for (const y of candidates) {
        const d = new Date(y, dm.month - 1, dm.day);
        if (d.getTime() <= now.getTime() + 24 * 3600 * 1000) return y;
    }
    return candidates[candidates.length - 1];
}

// Turn the trailing money items into one signed transaction amount.
function resolveAmount(moneyItems, cols) {
    // With detected debit/credit columns: classify each amount by x-position.
    if (cols) {
        let debit = null, credit = null;
        for (const { item, cents } of moneyItems) {
            const kind = classifyByColumn(item, cols);
            if (kind === 'debit' && debit === null) debit = Math.abs(cents);
            else if (kind === 'credit' && credit === null) credit = Math.abs(cents);
            // balance / unclassified → ignored
        }
        if (debit !== null && credit === null) return -debit;
        if (credit !== null && debit === null) return credit;
        if (debit !== null && credit !== null) return credit - debit; // both printed (rare)
        // Columns exist but nothing classified — fall through to the generic path.
    }

    // Generic: last amount is the running balance when there are ≥2; otherwise
    // the single amount IS the transaction. Trust explicit signs (parse keeps
    // them); an unsigned single amount is taken as-is (the invert toggle and
    // preview exist for exactly this ambiguity).
    const usable = moneyItems.length >= 2
        ? moneyItems.slice(0, -1)
        : moneyItems;
    // Prefer an explicitly signed amount if any survived.
    const signed = usable.find(m => m.cents < 0);
    if (signed) return signed.cents;
    return usable[usable.length - 1].cents;
}
