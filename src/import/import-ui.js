// Bank CSV import flow — modelled on the What If sandbox pattern: everything
// happens on a module-local draft (parsed rows, mapping, preview) and NOTHING
// is written until the user explicitly clicks Import. Committing writes to the
// IndexedDB transaction store, logs an 'import' feed event, and offers undo.
//
// Column mappings are remembered per file shape (header signature or column
// count) in localStorage — "map columns once".

import { store } from '../state/store.js';
import { getElement, getValue, setHTML, escapeHtml, formatCurrency } from '../utils.js';
import { parseCsv, detectColumns, normaliseRows } from './csv.js';
import { categoriseDescription } from '../state/categories.js';
import { makeTransaction, addTransactions, deleteImportBatch } from '../state/transactions.js';
import { logEvent, deleteEvent } from '../state/eventlog.js';
import { setupModal } from '../ui/modals.js';
import { renderHomeFeed } from '../ui/feed.js';

const MAPPINGS_KEY = 'ft-csv-mappings';
const PREVIEW_ROWS = 15;

// ---- draft state (the sandbox) ----
let draft = null; // { rows, errors(parse), fileName, mapping-ui state lives in the DOM }
let lastCommit = null; // { batchId, eventId, added } — for undo

function resetDraft() {
    draft = null;
    lastCommit = null;
    const drop = getElement('import-drop');
    if (drop) drop.hidden = false;
    getElement('import-config').hidden = true;
    getElement('import-actions').hidden = true;
    setHTML('import-preview', '');
    setHTML('import-errors', '');
    setHTML('import-result', '');
    const fileInput = getElement('import-file');
    if (fileInput) fileInput.value = '';
}

// ---- remembered mappings ----
function mappingSignature(rows, hasHeader) {
    if (!rows.length) return null;
    return hasHeader
        ? 'h:' + rows[0].map(c => String(c).toLowerCase().trim()).join('|')
        : 'c:' + rows[0].length;
}
function readSavedMappings() {
    try { return JSON.parse(localStorage.getItem(MAPPINGS_KEY)) || {}; }
    catch (_) { return {}; }
}
function saveMapping(signature, config) {
    if (!signature) return;
    const all = readSavedMappings();
    all[signature] = config;
    try { localStorage.setItem(MAPPINGS_KEY, JSON.stringify(all)); } catch (_) {}
}

// ---- UI state readers ----
function currentConfig() {
    const split = getElement('import-split-cols').checked;
    const idx = (id) => {
        const v = getValue(id);
        return v === '' ? null : parseInt(v, 10);
    };
    return {
        hasHeader: getElement('import-has-header').checked,
        invert: getElement('import-invert').checked,
        split,
        date: idx('import-col-date'),
        description: idx('import-col-desc'),
        amount: split ? null : idx('import-col-amount'),
        debit: split ? idx('import-col-debit') : null,
        credit: split ? idx('import-col-credit') : null,
    };
}

function columnOptions(rows, hasHeader, selectedIndex) {
    const width = Math.max(...rows.slice(0, 5).map(r => r.length));
    const sample = hasHeader && rows.length > 1 ? rows[1] : rows[0];
    let html = '<option value="">—</option>';
    for (let i = 0; i < width; i++) {
        const name = hasHeader ? (rows[0][i] || `Column ${i + 1}`) : `Column ${i + 1}`;
        const preview = sample && sample[i] ? ` — "${String(sample[i]).slice(0, 18)}"` : '';
        html += `<option value="${i}" ${i === selectedIndex ? 'selected' : ''}>${escapeHtml(String(name).slice(0, 24) + preview)}</option>`;
    }
    return html;
}

function populateConfigForm(detected, saved) {
    const rows = draft.rows;
    const cfg = saved || {
        hasHeader: detected.headerRow,
        invert: false,
        split: detected.mapping.amount == null && (detected.mapping.debit != null || detected.mapping.credit != null),
        date: detected.mapping.date,
        description: detected.mapping.description,
        amount: detected.mapping.amount,
        debit: detected.mapping.debit,
        credit: detected.mapping.credit,
    };
    getElement('import-has-header').checked = !!cfg.hasHeader;
    getElement('import-invert').checked = !!cfg.invert;
    getElement('import-split-cols').checked = !!cfg.split;
    getElement('import-col-date').innerHTML = columnOptions(rows, cfg.hasHeader, cfg.date);
    getElement('import-col-desc').innerHTML = columnOptions(rows, cfg.hasHeader, cfg.description);
    getElement('import-col-amount').innerHTML = columnOptions(rows, cfg.hasHeader, cfg.amount);
    getElement('import-col-debit').innerHTML = columnOptions(rows, cfg.hasHeader, cfg.debit);
    getElement('import-col-credit').innerHTML = columnOptions(rows, cfg.hasHeader, cfg.credit);
    syncSplitVisibility();

    const note = getElement('import-detect-note');
    if (note) {
        note.textContent = saved
            ? "We've used the column matching you saved for this file shape — adjust it if anything looks off."
            : "We had a go at matching the columns automatically — check the preview below and adjust if anything looks off.";
    }
}

function syncSplitVisibility() {
    const split = getElement('import-split-cols').checked;
    getElement('import-amount-group').hidden = split;
    getElement('import-debit-group').hidden = !split;
    getElement('import-credit-group').hidden = !split;
}

// ---- preview ----
function buildNormalised() {
    const cfg = currentConfig();
    const mapping = {
        date: cfg.date, description: cfg.description,
        amount: cfg.amount, debit: cfg.debit, credit: cfg.credit,
    };
    const { transactions, errors } = normaliseRows(draft.rows, mapping, {
        skipHeader: cfg.hasHeader, invert: cfg.invert,
    });
    return { cfg, transactions, errors };
}

function categoryOptions(selectedId) {
    return (store.financeData.categories || [])
        .map(c => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
        .join('');
}

function renderPreview() {
    if (!draft) return;
    const { transactions, errors } = buildNormalised();
    draft.normalised = transactions;

    const previewEl = getElement('import-preview');
    if (!transactions.length) {
        previewEl.innerHTML = `<p class="import-empty-note">No readable transactions with this column matching yet — try different columns above.</p>`;
    } else {
        const shown = transactions.slice(0, PREVIEW_ROWS);
        const rowsHtml = shown.map((t, i) => {
            const catId = t.categoryId || categoriseDescription(t.description, store.financeData.categories);
            t.categoryId = catId;
            return `<tr>
                <td class="import-cell-date">${escapeHtml(t.date)}</td>
                <td class="import-cell-desc">${escapeHtml(t.description)}</td>
                <td class="import-cell-amount ${t.amountCents < 0 ? 'is-out' : 'is-in'}">${formatCurrency(t.amountCents / 100)}</td>
                <td><select class="import-cat-select" data-preview-index="${i}">${categoryOptions(catId)}</select></td>
            </tr>`;
        }).join('');
        const more = transactions.length > PREVIEW_ROWS
            ? `<p class="import-more-note">…and ${transactions.length - PREVIEW_ROWS} more. Rows beyond the preview are auto-categorised the same way.</p>`
            : '';
        previewEl.innerHTML = `
            <div class="settings-title" style="margin-top: 8px;">Preview — ${transactions.length} transaction${transactions.length === 1 ? '' : 's'} ready</div>
            <div class="import-table-wrap">
                <table class="import-table">
                    <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>${more}`;
    }

    const errorsEl = getElement('import-errors');
    const allErrors = [...draft.parseErrors, ...errors];
    if (allErrors.length) {
        const items = allErrors.slice(0, 8).map(e =>
            `<li>Line ${e.line}: ${escapeHtml(e.message)}</li>`).join('');
        const more = allErrors.length > 8 ? `<li>…and ${allErrors.length - 8} more.</li>` : '';
        errorsEl.innerHTML = `
            <div class="import-errors-box">
                <p class="import-errors-title">${allErrors.length} row${allErrors.length === 1 ? " couldn't" : "s couldn't"} be read (they'll be skipped):</p>
                <ul>${items}${more}</ul>
            </div>`;
    } else {
        errorsEl.innerHTML = '';
    }

    const actions = getElement('import-actions');
    actions.hidden = false;
    const commitBtn = getElement('import-commit');
    commitBtn.disabled = transactions.length === 0;
    commitBtn.textContent = transactions.length
        ? `Import ${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`
        : 'Import';
}

// ---- file intake ----
function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const { rows, errors } = parseCsv(String(e.target.result || ''));
        if (!rows.length) {
            setHTML('import-result', `<div class="import-errors-box"><p class="import-errors-title">That file looks empty — is it the right CSV export?</p></div>`);
            return;
        }
        draft = { rows, parseErrors: errors, fileName: file.name, normalised: [] };
        setHTML('import-result', '');
        getElement('import-drop').hidden = true;
        getElement('import-config').hidden = false;

        const detected = detectColumns(rows);
        const signature = mappingSignature(rows, detected.headerRow);
        draft.signature = signature;
        const saved = signature ? readSavedMappings()[signature] : null;
        populateConfigForm(detected, saved);

        const nameInput = getElement('import-source-name');
        if (nameInput && !nameInput.value) {
            nameInput.value = (saved && saved.sourceName) || file.name.replace(/\.csv$/i, '').slice(0, 40);
        }
        renderPreview();
    };
    reader.onerror = () => {
        setHTML('import-result', `<div class="import-errors-box"><p class="import-errors-title">Couldn't read that file. Try exporting it from your bank again.</p></div>`);
    };
    reader.readAsText(file);
}

// ---- commit ----
async function commitImport() {
    if (!draft || !draft.normalised.length) return;
    const cfg = currentConfig();
    const sourceName = (getValue('import-source-name') || '').trim();
    const batchId = crypto.randomUUID();

    const txns = draft.normalised.map(t => makeTransaction({
        date: t.date,
        description: t.description,
        amountCents: t.amountCents,
        categoryId: t.categoryId || categoriseDescription(t.description, store.financeData.categories),
        source: 'csv',
        importBatchId: batchId,
    }));

    const commitBtn = getElement('import-commit');
    commitBtn.disabled = true;
    let result;
    try {
        result = await addTransactions(txns);
    } catch (err) {
        setHTML('import-result', `<div class="import-errors-box"><p class="import-errors-title">Saving failed: ${escapeHtml(String(err && err.message || err))}. Nothing was imported.</p></div>`);
        commitBtn.disabled = false;
        return;
    }

    saveMapping(draft.signature, { ...cfg, sourceName });

    let eventId = null;
    if (result.added > 0) {
        try {
            const ev = await logEvent('import', { batchId, count: result.added, sourceName });
            eventId = ev.id;
        } catch (_) {}
    }
    lastCommit = { batchId, eventId, added: result.added };

    getElement('import-config').hidden = true;
    setHTML('import-preview', '');
    setHTML('import-errors', '');
    getElement('import-actions').hidden = true;
    const dupNote = result.duplicates > 0
        ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? ' was' : 's were'} already here and got skipped.`
        : '';
    setHTML('import-result', `
        <div class="import-success">
            <p class="import-success-title">Done — ${result.added} transaction${result.added === 1 ? '' : 's'} imported.${dupNote}</p>
            <p class="import-success-sub">They're in your activity feed and spending breakdowns now.</p>
            <div class="settings-actions" style="border-top: none; padding-top: 8px; margin-top: 4px;">
                <button class="btn btn-secondary" id="import-another">Import another file</button>
                ${result.added > 0 ? '<button class="btn btn-secondary" id="import-undo">Undo this import</button>' : ''}
            </div>
        </div>`);

    if (store.activeTab === 'home') renderHomeFeed();
}

async function undoLastImport() {
    if (!lastCommit) return;
    try {
        await deleteImportBatch(lastCommit.batchId);
        if (lastCommit.eventId) await deleteEvent(lastCommit.eventId);
    } catch (_) {}
    setHTML('import-result', `
        <div class="import-success">
            <p class="import-success-title">Undone — those ${lastCommit.added} transactions are gone.</p>
            <div class="settings-actions" style="border-top: none; padding-top: 8px; margin-top: 4px;">
                <button class="btn btn-secondary" id="import-another">Import another file</button>
            </div>
        </div>`);
    lastCommit = null;
    if (store.activeTab === 'home') renderHomeFeed();
}

// ---- wiring ----
export function setupImport() {
    setupModal('import-modal', 'open-import', resetDraft);

    const drop = getElement('import-drop');
    const fileInput = getElement('import-file');
    const browse = getElement('import-browse');
    if (!drop || !fileInput) return;

    browse.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFile(fileInput.files && fileInput.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-dragover');
        handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    // Any mapping change re-runs the preview against the draft.
    ['import-has-header', 'import-invert', 'import-split-cols',
     'import-col-date', 'import-col-desc', 'import-col-amount',
     'import-col-debit', 'import-col-credit'].forEach(id => {
        const el = getElement(id);
        if (el) el.addEventListener('change', () => {
            if (id === 'import-split-cols') syncSplitVisibility();
            if (id === 'import-has-header' && draft) {
                // Re-run detection-time labelling: rebuild selects, keeping choices.
                const cfg = currentConfig();
                populateConfigForm({ headerRow: cfg.hasHeader, mapping: cfg }, { ...cfg });
            }
            if (draft) renderPreview();
        });
    });

    // Preview category corrections write back onto the draft rows.
    getElement('import-preview').addEventListener('change', (e) => {
        const sel = e.target.closest('.import-cat-select');
        if (!sel || !draft) return;
        const i = parseInt(sel.dataset.previewIndex, 10);
        if (draft.normalised[i]) draft.normalised[i].categoryId = sel.value;
    });

    // Commit / start over / post-commit actions (delegated — result HTML is dynamic).
    document.getElementById('import-modal').addEventListener('click', (e) => {
        if (e.target.id === 'import-commit') commitImport();
        else if (e.target.id === 'import-start-over') resetDraft();
        else if (e.target.id === 'import-another') resetDraft();
        else if (e.target.id === 'import-undo') undoLastImport();
    });
}
