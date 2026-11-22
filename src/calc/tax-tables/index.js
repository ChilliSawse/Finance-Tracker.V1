// Registry of the shipped AU tax tables, picked by DATE (FT-R-66, FT-R-86): there is
// no stored year and no manual year setting. Pure data and functions, no DOM.
//
// To ship a new year: add au-YYYY-YY.js and list it here (the yearly checklist row
// "add next year's tables in June").

import { AU_2026_27 } from './au-2026-27.js';
import { AU_2025_26 } from './au-2025-26.js';

// Newest first, so iteration order matches the old AU_TAX_YEARS.
export const TAX_TABLES = {
    [AU_2026_27.fy]: AU_2026_27,
    [AU_2025_26.fy]: AU_2025_26,
};

// FT-R-124: figures from the shared reference database. Empty until src/state/reference-tax.js has validated a
// table (legislated figures only, see reference-tables.js); with nothing set every lookup is the built-in table.
let refTables = {};
export function setReferenceTaxTables(map) { refTables = map && typeof map === 'object' ? { ...map } : {}; }
/** The table for an income-year key: the reference table when one was accepted, else the built-in one. */
export function tablesForFy(fy) {
    if (typeof fy !== 'string') return undefined;
    return Object.hasOwn(refTables, fy) ? refTables[fy] : (Object.hasOwn(TAX_TABLES, fy) ? TAX_TABLES[fy] : undefined);
}
const allFyKeys = () => Object.keys({ ...TAX_TABLES, ...refTables }).sort();

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

function ymdOf(date) {
    if (date instanceof Date) {
        if (isNaN(date.getTime())) return null;
        return { y: date.getFullYear(), m: date.getMonth() + 1 };
    }
    const m = ISO.exec(String(date || ''));
    if (!m) return null;
    return { y: +m[1], m: +m[2] };
}

/** Income-year key ('2026-27') for a Date or ISO 'YYYY-MM-DD' string. 1 July starts the new year. */
export function taxYearKeyForDate(date) {
    const p = ymdOf(date);
    if (!p) return null;
    const startYear = p.m >= 7 ? p.y : p.y - 1;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The table that covers the date, or undefined when none is shipped for it. */
export function getTablesForDate(date) {
    const key = taxYearKeyForDate(date);
    return key ? tablesForFy(key) : undefined;
}

/** Key of the newest shipped table. */
export function latestTaxYearKey() {
    return allFyKeys().pop();
}

/**
 * Tables to use for a date, never undefined: the covering table, or the latest
 * (stale: true) for a date past it, or the earliest for a date before them.
 * @returns {{tables:object, fy:string, stale:boolean}}
 */
export function resolveTablesForDate(date) {
    const exact = getTablesForDate(date);
    if (exact) return { tables: exact, fy: exact.fy, stale: false };
    const keys = allFyKeys();
    const key = taxYearKeyForDate(date);
    if (key && key < keys[0]) return { tables: tablesForFy(keys[0]), fy: keys[0], stale: false };
    // Past the shipped years, or in a gap between them: the newest year at or before the date, never a future one.
    const pick = key ? keys.filter((k) => k <= key).pop() : keys[keys.length - 1];
    return { tables: tablesForFy(pick), fy: pick, stale: true };
}

/**
 * Status for the Settings row and the July card.
 * @param {Date|string} now
 * @param {{taxCheck?:{fy:string, done:boolean}, incomeSources?:object[]}} [data] - taxCheck is written by C8 once a
 *   payslip confirms take-home for that year. With no record, the check is due for a payslip-job source in any month (U2), until a payslip is checked or the card is dismissed for the year.
 * @returns {{activeFy:string, stale:boolean, checkDue:boolean}}
 */
export function taxTablesStatus(now, data) {
    const { fy, stale } = resolveTablesForDate(now);
    const tc = data && data.taxCheck;
    const confirmed = !!(tc && tc.fy === fy && tc.done);
    // No record yet (a payslip was never checked): a payslip-job source still gets the card, in any month of the year (U2).
    const firstYear = !tc && hasPayslipJob(data);
    return { activeFy: fy, stale, checkDue: !stale && (!!tc || firstYear) && !confirmed };
}

/** True from October on: the card's heading changes from "New tax year" to a plain ask (U2). */
export function pastFirstQuarter(now) {
    const p = ymdOf(now);
    return !!p && !(p.m >= 7 && p.m <= 9);
}

/** True when an income source is paid from a payslip: an employee source with pay set (not Variable, not Self-employed). */
export function hasPayslipJob(data) {
    const sources = (data && Array.isArray(data.incomeSources)) ? data.incomeSources : [];
    return sources.some((s) => s && typeof s === 'object' && s.incomeType !== 'variable' && s.incomeType !== 'selfEmployed'
        && (Number(s.grossAnnual) > 0 || Number(s.hourlyRate) > 0));
}

