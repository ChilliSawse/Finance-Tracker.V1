// Backup and load hardening (security fix S1). Pure: no DOM; storage is injected.
//
// - sanitizeFinanceData / sanitizeGuiSettings: run on JSON import AND on load, before the
//   migration chain. They strip prototype keys at every depth, coerce every known numeric field
//   to a finite, bounded number, cap string length, and normalise `currency`. Stored strings are
//   NOT html-escaped: escaping happens at render time.
// - prepareImport / commitImport: a failed import never touches the store or storage.
// - quarantineCorruptSave: a save that will not parse is copied aside once.
// - csvSafeCell / buildTransactionsCsv: spreadsheet formula neutralisation.

import { runMigrationChain } from './migration-chain.js';
import { migrateGuiAppearance } from '../theme/theme.js';

export const SAVE_KEY = 'financeTrackerData_v2';
export const PRE_RESTORE_KEY = 'ft-pre-restore-backup';
export const CORRUPT_PREFIX = 'ft-corrupt-save-';
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_ABS_NUMBER = 1e12;
export const MAX_STRING_LENGTH = 5000;
const MAX_DEPTH = 40;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Field names that are numbers anywhere in the data (defaults.js, the Phase 1 shapes, the migrations).
const NUMERIC_KEYS = new Set([
    'primaryIncomeIndex', 'grossAnnual', 'hoursPerCycle', 'taxRemoved', 'invoicedPayPostTax', 'hourlyRate',
    'hoursPerWeek', 'superPct', 'extraPerPay', 'min', 'max', 'rate', 'helpBalance', 'balance', 'interestRate',
    'percentage', 'currentBalance', 'savingsGoal', 'saved', 'cost', 'order', 'multiple', 'expectedReturn',
    'amount', 'slot', 'version', 'dataVersion', 'months', 'starter',
]);
const NUMERIC_SUFFIX = /(Cents|Pct|Percent)$/;
const NUMERIC_MAP_KEYS = new Set(['bankSetTo']); // an object whose values are cents

const CURRENCY_RE = /^[A-Z]{3}$/;
let currencySet; // undefined = not looked up yet; null = no Intl.supportedValuesOf
function knownCurrencies() {
    if (currencySet === undefined) {
        try {
            currencySet = typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function'
                ? new Set(Intl.supportedValuesOf('currency')) : null;
        } catch (e) { currencySet = null; }
    }
    return currencySet;
}

/** A safe three-letter currency code, or 'AUD'. */
export function normaliseCurrency(code) {
    if (typeof code !== 'string' || !CURRENCY_RE.test(code)) return 'AUD';
    const known = knownCurrencies();
    if (known && !known.has(code)) return 'AUD';
    return code;
}

/** A finite number within +/- MAX_ABS_NUMBER; strings that look like numbers are parsed; anything else is 0. */
export function safeNumber(v) {
    let n = v;
    if (typeof n === 'string') n = n.trim() === '' ? 0 : Number(n);
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
    if (n > MAX_ABS_NUMBER) return MAX_ABS_NUMBER;
    if (n < -MAX_ABS_NUMBER) return -MAX_ABS_NUMBER;
    return n;
}

function isNumericKey(key) {
    return NUMERIC_KEYS.has(key) || NUMERIC_SUFFIX.test(key);
}

function walk(value, key, depth, inNumericMap) {
    if (value === null || value === undefined) return value;
    const type = typeof value;
    if (type === 'number') {
        if (key === 'max' && value === Infinity) return value; // open top tax band
        return isNumericKey(key) || inNumericMap || !Number.isFinite(value) ? safeNumber(value) : value;
    }
    if (type === 'string') {
        if (isNumericKey(key) || inNumericMap) return safeNumber(value);
        return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
    }
    if (type === 'boolean') return (isNumericKey(key) || inNumericMap) ? 0 : value;
    if (type !== 'object') return undefined; // functions, symbols, bigint
    if (depth > MAX_DEPTH) return null;
    if (isNumericKey(key) && !Array.isArray(value)) return 0; // an object where a number belongs
    if (Array.isArray(value)) {
        if (isNumericKey(key)) return 0;
        return value.map((v) => walk(v, key, depth + 1, false)); // array items inherit the key (e.g. amounts)
    }
    const out = {};
    const mapChildren = NUMERIC_MAP_KEYS.has(key);
    for (const k of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(k)) continue;
        const child = value[k];
        if (mapChildren && (typeof child === 'number' || typeof child === 'string')) {
            out[k] = safeNumber(child);
        } else {
            const cleaned = walk(child, k, depth + 1, false);
            if (cleaned !== undefined) out[k] = cleaned;
        }
    }
    return out;
}

/** A cleaned deep copy of financeData. Does not mutate the input. */
export function sanitizeFinanceData(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
    const out = walk(data, '', 0, false);
    out.currency = normaliseCurrency(out.currency);
    return out;
}

/** A cleaned deep copy of guiSettings (prototype keys stripped, strings capped; palette checks live in the theme). */
export function sanitizeGuiSettings(gui) {
    if (gui === null || typeof gui !== 'object' || Array.isArray(gui)) return {};
    return walk(gui, '', 0, false);
}

// ---------- import (M3, M6, L5, L6) ----------

/** Shape check (the original validateImportBundle rules). Returns an error string or null. */
export function validateBundleShape(bundle) {
    if (!bundle || typeof bundle !== 'object') return 'File does not contain valid JSON.';
    if (!bundle.financeData || typeof bundle.financeData !== 'object') return 'Missing financeData in backup file.';
    if (!bundle.guiSettings || typeof bundle.guiSettings !== 'object') return 'Missing guiSettings in backup file.';
    const fd = bundle.financeData;
    for (const k of ['incomeSources', 'essentialExpenses', 'nonEssentialExpenses', 'assets', 'liabilities']) {
        if (!Array.isArray(fd[k])) return `financeData.${k} must be an array.`;
    }
    if (!fd.fiSettings || typeof fd.fiSettings.multiple !== 'number') return 'financeData.fiSettings is invalid.';
    return null;
}

/**
 * Parse, validate, sanitize and migrate a backup on a clone. Touches no store and no storage
 * (the chain gets raw:null and no forceSave, so it writes nothing).
 * @returns {{ok:true, financeData:object, guiSettings:object}|{ok:false, error:string}}
 */
export function prepareImport(text) {
    if (typeof text !== 'string') return { ok: false, error: 'File could not be read.' };
    if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to be a Ledger backup (over 20 MB).' };
    let bundle;
    try { bundle = JSON.parse(text); } catch (e) { return { ok: false, error: 'File does not contain valid JSON.' }; }
    const shapeError = validateBundleShape(bundle);
    if (shapeError) return { ok: false, error: shapeError };
    try {
        const financeData = sanitizeFinanceData(bundle.financeData);
        const guiSettings = sanitizeGuiSettings(bundle.guiSettings);
        migrateGuiAppearance(guiSettings);
        const result = runMigrationChain(financeData, { raw: null, source: 'import', forceSave: null });
        if (result.aborted) return { ok: false, error: 'The backup could not be upgraded to this version of Ledger. Nothing was changed.' };
        return { ok: true, financeData, guiSettings };
    } catch (err) {
        return { ok: false, error: 'The backup could not be read. Nothing was changed.', detail: err };
    }
}

/** Write the current data to PRE_RESTORE_KEY (one copy, overwritten). Returns true on success. */
export function snapshotBeforeRestore(store, storage) {
    try {
        const raw = storage.getItem(SAVE_KEY);
        const body = raw != null ? raw : JSON.stringify({
            financeData: store.financeData, guiSettings: store.guiSettingsData, timestamp: new Date().toISOString(),
        });
        storage.setItem(PRE_RESTORE_KEY, body);
        return true;
    } catch (e) { return false; }
}

/**
 * Replace the store with a prepared import. `render` runs against the new data; if it throws, the
 * old store objects are put back and nothing is saved. `save` runs only after render succeeded.
 * @returns {{ok:boolean, error?:string}}
 */
export function commitImport(store, prepared, { storage, render, save }) {
    if (!snapshotBeforeRestore(store, storage)) {
        return { ok: false, error: 'Could not keep a safety copy of your current data first (storage may be full). Nothing was changed. Export a backup, then try again.' };
    }
    const prevFinance = store.financeData;
    const prevGui = store.guiSettingsData;
    store.financeData = prepared.financeData;
    store.guiSettingsData = prepared.guiSettings;
    try {
        if (render) render();
        if (save) save();
    } catch (err) {
        store.financeData = prevFinance;
        store.guiSettingsData = prevGui;
        try { if (render) render(); } catch (e2) { /* the old data rendered before */ }
        return { ok: false, error: 'The backup could not be shown. Nothing was changed.', detail: err };
    }
    return { ok: true };
}

// ---------- corrupt save (M4) ----------

/**
 * Copy a raw save that will not load to ft-corrupt-save-<timestamp>, unless an identical copy
 * already exists. Never throws.
 * @returns {{key:string|null, created:boolean}}
 */
export function quarantineCorruptSave(raw, storage, now = Date.now()) {
    try {
        if (typeof raw !== 'string' || !raw) return { key: null, created: false };
        const n = typeof storage.length === 'number' ? storage.length : 0;
        for (let i = 0; i < n; i++) {
            const k = storage.key(i);
            if (k && k.startsWith(CORRUPT_PREFIX) && storage.getItem(k) === raw) return { key: k, created: false };
        }
        const key = CORRUPT_PREFIX + now;
        storage.setItem(key, raw);
        return { key, created: true };
    } catch (e) {
        return { key: null, created: false };
    }
}

// ---------- CSV (M5) ----------

/** Prefix a text cell that a spreadsheet could read as a formula with a single quote. */
export function csvSafeText(v) {
    const s = String(v == null ? '' : v);
    return /^[\t\r\n ]*[=+\-@]|^[\t\r]/.test(s) ? "'" + s : s;
}

const csvQuote = (s) => '"' + String(s).replace(/"/g, '""') + '"';

/**
 * Transactions CSV text. Text cells (description, category, and a date that is not plain
 * YYYY-MM-DD) are neutralised. Amounts are written as plain numbers from the stored cents, so a
 * negative amount stays a real number ("-12.34") and is not quoted or prefixed.
 */
export function buildTransactionsCsv(rows, catName) {
    const lines = ['Date,Description,Amount,Category'];
    [...rows].reverse().forEach((r) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? String(r.date) : csvQuote(csvSafeText(r.date));
        const cents = Number.isFinite(r.amountCents) ? r.amountCents : 0;
        lines.push([date, csvQuote(csvSafeText(r.description)), (cents / 100).toFixed(2), csvQuote(csvSafeText(catName(r.categoryId)))].join(','));
    });
    return lines.join('\r\n');
}
