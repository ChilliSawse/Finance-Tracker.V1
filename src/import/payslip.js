// Payslip PDF → pay figures. Pure text analysis over extracted lines — no
// DOM, no store — so it's testable with plain strings.
//
// AU payslips (Xero, MYOB, ADP, KeyPay, Employment Hero, generic ATO-compliant)
// differ in layout but agree on vocabulary: a NET line, a TAX/PAYG line, a
// GROSS line and a SUPER line. Most print two figures per row — "this pay"
// then "year to date" — so the FIRST amount after a label wins.
// All returned figures are PLAIN DOLLARS (income-source convention).

import { parseAmountToCents } from './csv.js';
import { checkPayslip } from '../calc/payslip-check.js';

// Provider fingerprints — informational only (shown in the status line);
// extraction is vocabulary-based and provider-agnostic.
const PROVIDERS = [
    { id: 'xero', name: 'Xero', detect: /xero/i },
    { id: 'myob', name: 'MYOB', detect: /myob/i },
    { id: 'adp', name: 'ADP', detect: /\badp\b/i },
    { id: 'keypay', name: 'KeyPay', detect: /keypay|employment hero payroll/i },
    { id: 'eh', name: 'Employment Hero', detect: /employment hero/i },
];

// Label vocabularies, most specific first. A row must match the label and
// contain at least one money amount.
const FIELD_LABELS = {
    net: [/take[- ]home pay/i, /net pay(ment)?s?\b/i, /net income/i, /net earnings/i, /amount paid to bank/i, /\bnet\b(?!.*ytd)/i],
    tax: [/payg\s*(w\/?h|withholding|tax)?/i, /tax withheld/i, /income tax/i, /less tax/i, /taxation/i, /\btax\b/i],
    gross: [/total gross/i, /gross (pay|earnings|income|salary)/i, /\bgross\b/i],
    // HELP / study-loan repayment printed on its own row (C5, X-13).
    help: [/\bhelp\b(?!\s*desk)/i, /study (and training support )?loan/i, /\bstsl\b|\bhecs\b|student loan/i],
    super: [/super(annuation)? guarantee/i, /employer super(annuation)? contribution/i, /\bsgc\b/i, /super(annuation)?\b/i],
};

// Pay-period vocabulary → the app's paySchedule values.
const PERIOD_HINTS = [
    { re: /week(ly)? ending|paid weekly|frequency:?\s*weekly/i, schedule: 'weekly' },
    { re: /fortnight(ly)?/i, schedule: 'fortnightly' },
    { re: /month(ly)?\s*(pay|period|frequency)|paid monthly|frequency:?\s*monthly/i, schedule: 'monthly' },
];

/**
 * L7: may the payslip's gross go straight into the income source?
 * Never when it is an estimate (net + tax), and never over a different stored
 * gross: those need the user's OK (C5's grossProposal / needsConfirm rule).
 * @param {{gross:?number, tax:?number, grossDerived:boolean}} parsed
 * @param {{grossAnnual?:number}} source
 * @param {string} schedule pay schedule the gross is annualised by
 * @param {number} cycles pay cycles per year for that schedule
 * @returns {{proposedAnnual:?number, stored:boolean, needsConfirm:boolean}}
 */
export function grossDecision(parsed, source, schedule, cycles) {
    const g = parsed && parsed.gross;
    if (!(Number.isFinite(g) && g > 0) || !(cycles > 0)) return { proposedAnnual: null, stored: false, needsConfirm: false };
    const proposedAnnual = +(g * cycles).toFixed(2);
    const stored = Number(source && source.grossAnnual) > 0;
    const proposal = checkPayslip({ ...parsed, gross: g }, { ...source, paySchedule: schedule }).grossProposal;
    const differs = stored && ((proposal && proposal.needsConfirm) || Math.abs(Number(source.grossAnnual) - proposedAnnual) > 1);
    return { proposedAnnual, stored, needsConfirm: !!(parsed.grossDerived || differs) };
}

/** Every money amount on a line, in DOLLARS, left to right. */
function amountsOnLine(text) {
    const out = [];
    // Money-looking tokens: optional $/sign, digits with optional thousands
    // separators and a mandatory decimal part (payslips print cents).
    for (const m of text.matchAll(/-?\$?\s?-?\d{1,3}(?:,\d{3})*\.\d{2}\b/g)) {
        const cents = parseAmountToCents(m[0]);
        if (cents !== null) out.push(cents / 100);
    }
    return out;
}

/**
 * Extract pay figures from payslip text lines.
 * @param {string[]} lines - one string per visual line (top to bottom).
 * @returns {{net: ?number, tax: ?number, gross: ?number, super: ?number, help: ?number, grossDerived: boolean,
 *            schedule: ?string, provider: ?string}}
 */
export function parsePayslipLines(lines) {
    const joined = lines.join('\n');
    const provider = PROVIDERS.find(p => p.detect.test(joined)) || null;

    let schedule = null;
    for (const hint of PERIOD_HINTS) {
        if (hint.re.test(joined)) { schedule = hint.schedule; break; }
    }

    const result = { net: null, tax: null, gross: null, super: null, help: null, grossDerived: false, schedule, provider: provider ? provider.name : null };

    // Pass per field: first label-regex (most specific) that lands on a line
    // with an amount wins; within the line, the first amount is "this pay".
    for (const [field, patterns] of Object.entries(FIELD_LABELS)) {
        outer:
        for (const re of patterns) {
            for (const line of lines) {
                if (!re.test(line)) continue;
                // YTD-only summary rows mislead — skip lines that are explicitly YTD.
                if (/^\s*(ytd|year to date)/i.test(line)) continue;
                const amounts = amountsOnLine(line);
                if (!amounts.length) continue;
                const value = Math.abs(amounts[0]);
                if (value === 0 || !Number.isFinite(value)) continue;
                result[field] = value;
                break outer;
            }
        }
    }

    // Sanity: net can't exceed gross; a swapped match means the vocabulary hit
    // a YTD column — drop gross rather than report nonsense.
    if (result.net != null && result.gross != null && result.net > result.gross) {
        result.gross = null;
    }
    // Derive what's missing when two of the trio are present.
    if (result.gross == null && result.net != null && result.tax != null) {
        result.gross = result.net + result.tax;
        // Estimated, not read from the slip: callers must show it before it replaces a stored gross.
        result.grossDerived = true;
    } else if (result.tax == null && result.net != null && result.gross != null) {
        result.tax = Math.max(0, result.gross - result.net);
    }
    return result;
}
