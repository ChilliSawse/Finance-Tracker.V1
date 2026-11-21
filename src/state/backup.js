// The backup bundle, version 2 (D2, M-6, FT-R-74 D9). One file holds the saved settings
// (financeData, guiSettings) plus the rows that live in IndexedDB: transactions and events.
//
//   { version: 2, app: 'ledger', timestamp, financeData, guiSettings, transactions: [...], events: [...] }
//
// EXTENSION POINT (F1 adds `scenarios` here): a bundle part is
//   { key, read(): Promise<rows>, sanitize(rows): {rows, skipped}, replace(rows): Promise<void> }
// and `registerBackupPart(part)` adds it. Export reads every registered part, restore sanitizes and
// replaces every part the file carries, and erase-all clears every part. Nothing else changes.
//
// Old bundles (no `version`, no part keys) still restore: only the settings are replaced and the
// rows already on the device are left alone. A restore goes through S1's prepareImport (parse,
// validate, sanitize, migration chain on a clone) and commitImport (safety copy, swap, render, save).
// Pure apart from the default parts, which use IndexedDB only when called.

import { prepareImport, commitImport, safeNumber, MAX_STRING_LENGTH } from './sanitize.js';
import { exportAllTransactions, importTransactions, isValidIsoDate } from './transactions.js';
import { withStore } from './db.js';

export const BACKUP_VERSION = 2;
export const MAX_PART_ROWS = 500000;
// Keys the retired "Save as My Defaults" (ft-user-defaults) and the retired info-guide panels (ft-info-collapsed, A11) used.
// Never read or written now; Erase all removes them. Names are never changed.
export const RETIRED_KEYS = ['ft-user-defaults', 'ft-info-collapsed'];

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 8;

// Deep clean of one value from a file: prototype keys stripped, numbers finite and bounded,
// strings capped, functions and symbols dropped. Strings are not escaped (render time does that).
function cleanValue(v, depth) {
    if (v === null) return null;
    switch (typeof v) {
        case 'string': return v.length > MAX_STRING_LENGTH ? v.slice(0, MAX_STRING_LENGTH) : v;
        case 'number': return safeNumber(v);
        case 'boolean': return v;
        case 'object': {
            if (depth >= MAX_DEPTH) return Array.isArray(v) ? [] : {};
            if (Array.isArray(v)) return v.map((x) => { const c = cleanValue(x, depth + 1); return c === undefined ? null : c; });
            const out = {};
            for (const k of Object.keys(v)) {
                if (BAD_KEYS.has(k)) continue;
                const c = cleanValue(v[k], depth + 1);
                if (c !== undefined) out[k] = c;
            }
            return out;
        }
        default: return undefined;
    }
}

const isPlainRow = (r) => r !== null && typeof r === 'object' && !Array.isArray(r);
const nonEmptyId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 200;

/** Transactions from a file: a row without a real id, date or whole-cents amount is left out. */
export function sanitizeTransactionRows(rows) {
    const out = [];
    let skipped = 0;
    const list = Array.isArray(rows) ? rows.slice(0, MAX_PART_ROWS) : [];
    skipped += Array.isArray(rows) ? Math.max(0, rows.length - list.length) : 0;
    for (const r of list) {
        if (!isPlainRow(r) || !nonEmptyId(r.id) || !isValidIsoDate(r.date)
            || typeof r.amountCents !== 'number' || !Number.isFinite(r.amountCents)) { skipped++; continue; }
        const c = cleanValue(r, 0);
        c.amountCents = Math.round(c.amountCents);
        if (typeof c.description !== 'string') c.description = '';
        if (typeof c.hash !== 'string' || !c.hash) c.hash = 'restored|' + c.id;
        out.push(c);
    }
    return { rows: out, skipped };
}

/** Events from a file: id, type and a finite seq are required. */
export function sanitizeEventRows(rows) {
    const out = [];
    let skipped = 0;
    const list = Array.isArray(rows) ? rows.slice(0, MAX_PART_ROWS) : [];
    skipped += Array.isArray(rows) ? Math.max(0, rows.length - list.length) : 0;
    for (const r of list) {
        if (!isPlainRow(r) || !nonEmptyId(r.id) || typeof r.type !== 'string' || !r.type
            || typeof r.seq !== 'number' || !Number.isFinite(r.seq)) { skipped++; continue; }
        const c = cleanValue(r, 0);
        if (!isPlainRow(c.data)) c.data = {};
        if (typeof c.ts !== 'string') c.ts = '';
        out.push(c);
    }
    return { rows: out, skipped };
}

// ---------- the registered parts (IndexedDB) ----------

async function replaceStoreRows(storeName, rows) {
    await withStore(storeName, 'readwrite', (s) => { s.clear(); });
    if (rows.length) {
        await withStore(storeName, 'readwrite', (s) => { rows.forEach((r) => s.put(r)); });
    }
}

export const TRANSACTIONS_PART = {
    key: 'transactions',
    read: () => exportAllTransactions(),
    sanitize: sanitizeTransactionRows,
    async replace(rows) {
        await withStore('transactions', 'readwrite', (s) => { s.clear(); });
        if (rows.length) await importTransactions(rows);
    },
};

export const EVENTS_PART = {
    key: 'events',
    read: () => withStore('events', 'readonly', (s) => s.getAll()),
    sanitize: sanitizeEventRows,
    replace: (rows) => replaceStoreRows('events', rows),
};

export const BACKUP_PARTS = [TRANSACTIONS_PART, EVENTS_PART];

/** F1 (and later steps) add a part here, for example scenarios. Replaces a part with the same key. */
export function registerBackupPart(part) {
    if (!part || typeof part.key !== 'string' || typeof part.read !== 'function'
        || typeof part.sanitize !== 'function' || typeof part.replace !== 'function') {
        throw new Error('A backup part needs key, read, sanitize and replace.');
    }
    const i = BACKUP_PARTS.findIndex((p) => p.key === part.key);
    if (i >= 0) BACKUP_PARTS[i] = part; else BACKUP_PARTS.push(part);
    return BACKUP_PARTS;
}

// ---------- export ----------

/**
 * Read every part. A part that cannot be read is listed in `failed` and left out of the file.
 * @returns {Promise<{rows:Object<string,Array>, failed:string[]}>}
 */
export async function collectParts(parts = BACKUP_PARTS) {
    const rows = {};
    const failed = [];
    for (const p of parts) {
        try {
            const list = await p.read();
            rows[p.key] = Array.isArray(list) ? list : [];
        } catch (err) {
            console.error(`Backup: could not read ${p.key}`, err);
            failed.push(p.key);
        }
    }
    return { rows, failed };
}

/** The v2 bundle object. `partRows` is `collectParts(...).rows`. */
export function buildBackupBundle({ financeData, guiSettings, partRows = {}, now = new Date() }) {
    const bundle = {
        version: BACKUP_VERSION,
        app: 'ledger',
        timestamp: now.toISOString(),
        financeData,
        guiSettings,
    };
    for (const key of Object.keys(partRows)) {
        if (!(key in bundle)) bundle[key] = partRows[key];
    }
    return bundle;
}

// ---------- restore ----------

/**
 * Parse, validate, sanitize and migrate a backup on a clone (S1 prepareImport), then clean the
 * part rows the file carries. Touches no store, no storage, no IndexedDB.
 * @returns {{ok:true, financeData, guiSettings, version:number, parts:Object<string,Array>,
 *            counts:Object<string,number>, skipped:number}|{ok:false, error:string}}
 */
export function prepareBackup(text, parts = BACKUP_PARTS) {
    const prepared = prepareImport(text);
    if (!prepared.ok) return prepared;
    let bundle;
    try { bundle = JSON.parse(text); } catch (e) { return { ok: false, error: 'File does not contain valid JSON.' }; }
    const out = { ...prepared, version: Number(bundle.version) || 1, parts: {}, counts: {}, skipped: 0 };
    for (const p of parts) {
        if (!Array.isArray(bundle[p.key])) continue; // an old bundle, or one without this part: leave the device's rows alone
        const { rows, skipped } = p.sanitize(bundle[p.key]);
        out.parts[p.key] = rows;
        out.counts[p.key] = rows.length;
        out.skipped += skipped;
    }
    return out;
}

/** True when the prepared file carries rows (a v2 file), so a restore replaces them. */
export const carriesParts = (prepared) => !!prepared && Object.keys(prepared.parts || {}).length > 0;

async function rollbackParts(list, before) {
    for (const p of list) {
        try { await p.replace(before[p.key] || []); } catch (err) { console.error(`Backup: could not put back ${p.key}`, err); }
    }
}

/**
 * Replace the device's data with a prepared backup. The rows are swapped first (the old rows are
 * kept in memory and put back on any failure), then S1's commitImport takes the settings safety
 * copy, swaps the store, renders and saves. A render failure puts everything back.
 * @returns {Promise<{ok:boolean, error?:string, detail?:*, counts?:object}>}
 */
export async function commitBackup(store, prepared, { storage, render, save, parts = BACKUP_PARTS } = {}) {
    const active = parts.filter((p) => prepared.parts && Array.isArray(prepared.parts[p.key]));
    const before = {};
    try {
        for (const p of active) before[p.key] = await p.read();
    } catch (err) {
        return { ok: false, error: 'cantReadCurrent', detail: err };
    }
    const touched = [];
    try {
        for (const p of active) {
            touched.push(p);
            await p.replace(prepared.parts[p.key]);
        }
    } catch (err) {
        await rollbackParts(touched, before);
        return { ok: false, error: 'cantWrite', detail: err };
    }
    const result = commitImport(store, prepared, { storage, render, save });
    if (!result.ok) { await rollbackParts(touched, before); return result; }
    return { ok: true, counts: prepared.counts || {} };
}

/** Erase-all: a fresh store and every registered part emptied, through the same commit (so the same safety copy and rollback). */
export function commitErase(store, { financeData, guiSettings }, { storage, render, save, parts = BACKUP_PARTS } = {}) {
    const empty = {};
    for (const p of parts) empty[p.key] = [];
    return commitBackup(store, { financeData, guiSettings, parts: empty, counts: {} }, { storage, render, save, parts });
}
