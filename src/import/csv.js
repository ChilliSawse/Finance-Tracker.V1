// CSV import pipeline for Australian bank exports.
// Pure module: no DOM, no store — importable from tests and workers alike.
// Amounts are integer CENTS, negative = money out (codebase convention).
//
// Line-number bookkeeping: quoted fields can span physical lines and empty
// lines are dropped, so each row array returned by parseCsv carries a
// non-enumerable-ish extra `line` property (the 1-based line the row STARTED
// on in the original text). JSON.stringify ignores it, so rows still compare
// as plain arrays; normaliseRows falls back to index+1 when it's absent.

/**
 * Tokenizes CSV text (RFC-4180-ish) into rows of string fields.
 * Handles quoted fields, escaped quotes (""), commas/newlines inside quotes,
 * CRLF and LF line endings, a trailing newline, and a leading UTF-8 BOM.
 * Fully-empty physical lines are skipped. Column counts are NOT validated
 * here — mapping/normalisation deal with ragged rows later.
 * @param {string} text - Raw CSV file contents.
 * @returns {{rows: string[][], errors: {line: number, message: string}[]}}
 */
export function parseCsv(text) {
    const rows = [];
    const errors = [];
    if (typeof text !== 'string' || text === '') return { rows, errors };
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    let field = '';
    let row = [];
    let inQuotes = false;
    let line = 1;    // current physical line while scanning
    let rowLine = 1; // line the in-progress row started on

    const endField = () => {
        row.push(field);
        field = '';
    };
    const endRow = () => {
        endField();
        // A blank physical line tokenizes to a single empty field — skip it.
        // Rows with real delimiters (e.g. ",,") are kept for later validation.
        if (!(row.length === 1 && row[0].trim() === '')) {
            row.line = rowLine;
            rows.push(row);
        }
        row = [];
    };

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"'; // escaped quote
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                if (c === '\n') line++;
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            endField();
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            line++;
            endRow();
            rowLine = line;
        } else {
            field += c;
        }
    }
    if (inQuotes) {
        // Keep the partial row so the user can still see the data; just flag it.
        errors.push({ line: rowLine, message: 'Unterminated quoted field' });
    }
    if (field !== '' || row.length > 0) endRow();

    return { rows, errors };
}

// Header-name stems, checked per cell IN THIS ORDER — 'Debit Amount' must map
// to debit (not amount), and 'Value Date' / 'Transaction Date' to date.
const HEADER_ROLES = [
    ['date', /date/],
    ['description', /descr|narrat|detail|memo|payee|particular/],
    ['debit', /debit|withdraw/],
    ['credit', /credit|deposit/],
    ['amount', /amount/],
];

/**
 * Guesses which column holds what.
 * Header path: matches common AU bank header names (NAB/ANZ/Westpac export
 * headers; CBA exports have none). Headerless path: sniffs the first ~20 rows
 * per column — mostly-dates → date, mostly-signed-money → amount (preferring
 * the column that actually contains negatives, so a running Balance column
 * loses), longest average text → description.
 * @param {string[][]} rows - Parsed CSV rows.
 * @returns {{headerRow: boolean, mapping: {date: ?number, description: ?number, amount: ?number, debit: ?number, credit: ?number}}}
 */
export function detectColumns(rows) {
    const mapping = { date: null, description: null, amount: null, debit: null, credit: null };
    if (!rows || rows.length === 0) return { headerRow: false, mapping };

    const first = rows[0];
    const headerMapping = { ...mapping };
    let matches = 0;
    for (let i = 0; i < first.length; i++) {
        const cell = String(first[i] || '').trim().toLowerCase();
        if (cell === '' || !/[a-z]/.test(cell)) continue;
        for (const [role, re] of HEADER_ROLES) {
            if (headerMapping[role] === null && re.test(cell)) {
                headerMapping[role] = i;
                matches++;
                break; // one role per cell, first occurrence wins
            }
        }
    }
    // A real header names at least two roles AND contains no cell that parses
    // as data — guards against a data row like "Deposit ... details" matching
    // keywords by accident (its date/amount cells give it away).
    const looksLikeData = first.some(
        (c) => parseDateToIso(c) !== null || parseAmountToCents(c) !== null
    );
    if (matches >= 2 && !looksLikeData) {
        // Banks give a signed amount XOR debit/credit split, never both.
        if (headerMapping.amount !== null) {
            headerMapping.debit = null;
            headerMapping.credit = null;
        }
        return { headerRow: true, mapping: headerMapping };
    }

    // Headerless: sniff column content. Split debit/credit columns can't be
    // told apart without names, so this path only ever yields `amount`.
    const sample = rows.slice(0, 20);
    const width = sample.reduce((w, r) => Math.max(w, r.length), 0);
    const stats = [];
    for (let col = 0; col < width; col++) {
        const values = sample
            .map((r) => String(r[col] == null ? '' : r[col]).trim())
            .filter((v) => v !== '');
        let dates = 0;
        let money = 0;
        let negatives = 0;
        let alpha = 0;
        let len = 0;
        for (const v of values) {
            if (parseDateToIso(v) !== null) dates++;
            const cents = parseAmountToCents(v);
            if (cents !== null) {
                money++;
                if (cents < 0) negatives++;
            }
            if (/[a-zA-Z]/.test(v)) alpha++;
            len += v.length;
        }
        const n = values.length;
        stats.push({
            col,
            n,
            dateFrac: n ? dates / n : 0,
            moneyFrac: n ? money / n : 0,
            negatives,
            alpha,
            avgLen: n ? len / n : 0,
        });
    }

    const dateCol = stats
        .filter((s) => s.n > 0 && s.dateFrac >= 0.6)
        .sort((a, b) => b.dateFrac - a.dateFrac)[0];
    if (dateCol) mapping.date = dateCol.col;

    const moneyCols = stats.filter(
        (s) => s.col !== mapping.date && s.n > 0 && s.moneyFrac >= 0.6
    );
    if (moneyCols.length > 0) {
        // A transaction amount column has spends (negatives); a balance column
        // usually doesn't. Prefer signed, tie-break leftmost.
        const signed = moneyCols.filter((s) => s.negatives > 0);
        mapping.amount = (signed[0] || moneyCols[0]).col;
    }

    const textCols = stats.filter(
        (s) => s.col !== mapping.date && s.col !== mapping.amount && s.alpha > 0
    );
    if (textCols.length > 0) {
        textCols.sort((a, b) => b.avgLen - a.avgLen);
        mapping.description = textCols[0].col;
    }

    return { headerRow: false, mapping };
}

/**
 * Parses a money string into integer cents, or null if unparseable.
 * Accepts: "$1,234.56", "-1234.56", "(1234.56)" (parens = negative), "1234",
 * surrounding whitespace, "CR"/"DR" suffixes (CR positive, DR negative),
 * sign on either side of the currency symbol. Empty/garbage → null.
 * String maths (no float) so "1234.56" is exactly 123456.
 * @param {string} str - Raw amount cell.
 * @returns {?number} Integer cents (negative = money out) or null.
 */
export function parseAmountToCents(str) {
    if (str == null) return null;
    let s = String(str).trim();
    if (s === '') return null;

    let sign = 1;
    const crdr = s.match(/^(.*?)\s*(CR|DR)\.?$/i);
    if (crdr) {
        s = crdr[1].trim();
        if (/^dr$/i.test(crdr[2])) sign = -1;
        if (s === '') return null;
    }
    if (/^\(.*\)$/.test(s)) {
        sign = -1;
        s = s.slice(1, -1).trim();
    }

    // Sign may sit before or after the currency symbol ("-$12" / "$-12"),
    // but not in both spots. Thousands separators must group in threes.
    const m = s.match(/^([-+]?)\s*\$?\s*([-+]?)\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/);
    if (!m) return null;
    if (m[1] !== '' && m[2] !== '') return null;
    if (m[3] === undefined && m[4] === undefined) return null;
    if (m[1] === '-' || m[2] === '-') sign = -1;

    const intDigits = (m[3] || '0').replace(/,/g, '');
    const frac = m[4] || '';
    let cents;
    if (frac.length <= 2) {
        cents = Number((frac + '00').slice(0, 2));
    } else {
        cents = Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
    }
    const total = Number(intDigits) * 100 + cents;
    return total === 0 ? 0 : sign * total; // normalise -0 to 0
}

const MONTH_NAMES = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
];

function monthFromName(name) {
    const n = name.toLowerCase().replace(/\.$/, '');
    if (n.length < 3) return 0; // "ju" is ambiguous; banks never abbreviate below 3
    const idx = MONTH_NAMES.findIndex((m) => m.startsWith(n));
    return idx + 1; // 0 = not found
}

function daysInMonth(year, month) {
    if (month === 2) {
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        return leap ? 29 : 28;
    }
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function toIsoIfValid(year, month, day) {
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInMonth(year, month)) return null;
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

// Two-digit year pivot: <50 → 20xx, else 19xx.
function expandYear(str) {
    const y = Number(str);
    if (str.length === 4) return y;
    return y < 50 ? 2000 + y : 1900 + y;
}

/**
 * Parses an AU-formatted date string into 'YYYY-MM-DD', or null.
 * Accepts dd/mm/yyyy, dd/mm/yy, dd-mm-yyyy, yyyy-mm-dd, and "dd Mon yyyy"
 * (month names/abbreviations, case-insensitive). Numeric slash/dash forms are
 * DAY-FIRST (Australian convention); the only exception is first-component
 * ≤ 12 with second > 12, which can only be a US-style mm/dd export.
 * Impossible calendar dates (31/02/2026) return null.
 * @param {string} str - Raw date cell.
 * @returns {?string} ISO date or null.
 */
export function parseDateToIso(str) {
    if (str == null) return null;
    const s = String(str).trim();
    if (s === '') return null;

    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) return toIsoIfValid(Number(m[1]), Number(m[2]), Number(m[3]));

    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
    if (m) {
        let day = Number(m[1]);
        let month = Number(m[2]);
        if (day <= 12 && month > 12) [day, month] = [month, day]; // mm/dd fallback
        return toIsoIfValid(expandYear(m[3]), month, day);
    }

    m = s.match(/^(\d{1,2})\s+([A-Za-z.]+)\s+(\d{2}|\d{4})$/);
    if (m) {
        const month = monthFromName(m[2]);
        if (month === 0) return null;
        return toIsoIfValid(expandYear(m[3]), month, Number(m[1]));
    }

    return null;
}

/**
 * Converts parsed CSV rows into normalised transactions using a column
 * mapping from detectColumns. Never aborts the file: each bad row yields one
 * precise error and is excluded; good rows always survive.
 * Split debit/credit columns combine as credit − debit; magnitudes are taken
 * as absolute values because some banks already sign the debit column.
 * Rows with a 0/empty amount AND an empty description are skipped silently
 * (separator/footer junk, not user data).
 * @param {string[][]} rows - Rows from parseCsv (line numbers ride along).
 * @param {{date: ?number, description: ?number, amount: ?number, debit: ?number, credit: ?number}} mapping
 * @param {{skipHeader?: boolean, invert?: boolean}} [options] - invert flips
 *     all signs (for banks that export spends as positive).
 * @returns {{transactions: {date: string, description: string, amountCents: number}[], errors: {line: number, message: string, raw: string}[]}}
 */
export function normaliseRows(rows, mapping, options = {}) {
    const { skipHeader = false, invert = false } = options;
    const transactions = [];
    const errors = [];

    for (let i = skipHeader ? 1 : 0; i < rows.length; i++) {
        const row = rows[i];
        const line = typeof row.line === 'number' ? row.line : i + 1;
        const raw = row.join(',');
        const cell = (idx) =>
            idx == null || row[idx] == null ? '' : String(row[idx]).trim();
        const fail = (message) => errors.push({ line, message, raw });

        const description = cell(mapping.description).replace(/\s+/g, ' ');

        let amountCents = null;
        let amountEmpty;
        let badAmountRaw = null; // non-empty cell that refused to parse
        if (mapping.amount != null) {
            const amountRaw = cell(mapping.amount);
            amountEmpty = amountRaw === '';
            if (!amountEmpty) {
                amountCents = parseAmountToCents(amountRaw);
                if (amountCents === null) badAmountRaw = amountRaw;
            }
        } else {
            const debitRaw = cell(mapping.debit);
            const creditRaw = cell(mapping.credit);
            amountEmpty = debitRaw === '' && creditRaw === '';
            if (!amountEmpty) {
                const debit = debitRaw === '' ? 0 : parseAmountToCents(debitRaw);
                const credit = creditRaw === '' ? 0 : parseAmountToCents(creditRaw);
                if (debit === null) {
                    badAmountRaw = debitRaw;
                } else if (credit === null) {
                    badAmountRaw = creditRaw;
                } else {
                    amountCents = Math.abs(credit) - Math.abs(debit);
                }
            }
        }

        // Junk row: nothing to record and nothing to warn the user about.
        if (description === '' && badAmountRaw === null
            && (amountEmpty || amountCents === 0)) {
            continue;
        }

        const dateRaw = cell(mapping.date);
        const date = parseDateToIso(dateRaw);
        if (date === null) {
            fail(`Couldn't read a date from "${dateRaw}"`);
            continue;
        }
        if (badAmountRaw !== null || amountEmpty) {
            fail(`Couldn't read an amount from "${badAmountRaw === null ? '' : badAmountRaw}"`);
            continue;
        }

        if (invert && amountCents !== 0) amountCents = -amountCents;
        transactions.push({ date, description, amountCents });
    }

    return { transactions, errors };
}
