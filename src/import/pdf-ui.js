// Bank PDF import flow (+ the payslip reader) — a sibling of import-ui.js with the
// same shape: module-local draft state, one exported setup function, nothing
// written until the user explicitly commits. Reuses the CSV pipeline's pure
// helpers and the exact same commit path (makeTransaction → commitImportRows →
// logEvent → refreshSpendCache → updateAllUI), so PDF rows behave identically
// to CSV rows everywhere downstream.

import { store } from '../state/store.js';
import { getElement, getValue, setHTML, escapeHtml, formatCurrency } from '../utils.js';
import { categoriseDescription } from '../state/categories.js';
import { resolveCategory, commitImportRows, rematchBills } from '../state/rules.js';
import { makeTransaction, deleteImportBatch } from '../state/transactions.js';
import { logEvent, deleteEvent } from '../state/eventlog.js';
import { setupModal } from '../ui/modals.js';
import { renderHomeFeed } from '../ui/feed.js';
import { refreshSpendCache } from '../state/spend-cache.js';
import { openActivityToReview } from '../ui/activity.js';
import { updateAllUI } from '../ui/render.js';
import { loadPdfJs, openPdfDocument, extractPagesLines, PDF_LIMITS, PdfLimitError } from './pdfjs-loader.js';
import { parseStatementPages } from './pdf-statement.js';
import { parsePayslipLines } from './payslip.js';
import { t } from '../i18n/strings.js';

const txnWord = (n) => t(n === 1 ? 'feed.import.txnOne' : 'feed.import.txnMany');
const PREVIEW_ROWS = 15;

// ---- draft state (the sandbox) ----
let draft = null; // { pages, fileName, bank, transactions }
let lastCommit = null; // { batchId, eventId, added } — for undo

function statusLine(html) {
    setHTML('pdf-import-status', html ? `<p class="pdf-status-line">${html}</p>` : '');
}

function errorBox(message) {
    statusLine('');
    setHTML('pdf-import-result',
        `<div class="import-errors-box"><p class="import-errors-title">${message}</p></div>`);
}

function resetDraft() {
    draft = null;
    lastCommit = null;
    const drop = getElement('pdf-import-drop');
    if (drop) drop.hidden = false;
    getElement('pdf-import-config').hidden = true;
    getElement('pdf-import-actions').hidden = true;
    statusLine('');
    setHTML('pdf-import-preview', '');
    setHTML('pdf-import-errors', '');
    setHTML('pdf-import-result', '');
    const fileInput = getElement('pdf-import-file');
    if (fileInput) fileInput.value = '';
}

// ---- parse + preview ----

function rebuildTransactions() {
    const invert = getElement('pdf-import-invert').checked;
    const { transactions, bank, skipped } = parseStatementPages(draft.pages, { invert });
    draft.transactions = transactions;
    draft.bank = bank;
    draft.skipped = skipped;
}

function categoryOptions(selectedId) {
    return (store.financeData.categories || [])
        .map(c => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
        .join('');
}

function renderPreview() {
    if (!draft) return;
    const txns = draft.transactions;

    const skippedEl = getElement('pdf-import-errors');
    if (skippedEl) {
        skippedEl.innerHTML = draft.skipped
            ? `<div class="import-errors-box"><p class="import-errors-title">${escapeHtml(t('d.import.skippedLines', { count: draft.skipped }))}</p></div>`
            : '';
    }

    const note = getElement('pdf-import-detect-note');
    if (note) {
        note.textContent = draft.bank
            ? t('pdf.detected', { bank: draft.bank.name, count: txns.length })
            : t('pdf.detectedGeneric', { count: txns.length });
    }

    const previewEl = getElement('pdf-import-preview');
    if (!txns.length) {
        previewEl.innerHTML = `<p class="import-empty-note">${t('pdf.noRows')}</p>`;
    } else {
        const shown = txns.slice(0, PREVIEW_ROWS);
        const rowsHtml = shown.map((txn, i) => {
            const catId = txn.categoryId || categoriseDescription(txn.description, store.financeData.categories, store.financeData.rules);
            txn.categoryId = catId;
            return `<tr>
                <td class="import-cell-date">${escapeHtml(txn.date)}</td>
                <td class="import-cell-desc">${escapeHtml(txn.description)}</td>
                <td class="import-cell-amount ${txn.amountCents < 0 ? 'is-out' : 'is-in'}">${formatCurrency(txn.amountCents / 100)}</td>
                <td><select class="import-cat-select" data-preview-index="${i}">${categoryOptions(catId)}</select></td>
            </tr>`;
        }).join('');
        const more = txns.length > PREVIEW_ROWS
            ? `<p class="import-more-note">${t('import.preview.more', { count: txns.length - PREVIEW_ROWS })}</p>`
            : '';
        previewEl.innerHTML = `
            <div class="settings-title" style="margin-top: 8px;">${t('import.preview.title', { count: txns.length, txnWord: txnWord(txns.length) })}</div>
            <div class="import-table-wrap">
                <table class="import-table">
                    <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>${more}`;
    }

    const actions = getElement('pdf-import-actions');
    actions.hidden = false;
    const commitBtn = getElement('pdf-import-commit');
    commitBtn.disabled = txns.length === 0;
    commitBtn.textContent = txns.length
        ? t('import.commit', { count: txns.length, txnWord: txnWord(txns.length) })
        : t('import.commit.empty');
}

// ---- file intake ----

// Shared PDF-open helper (bank import + payslips): loads the library on
// demand, translates pdf.js's failure modes into friendly copy via onError,
// returns positioned page lines or null.
async function readPdfPages(file, onStatus, onError) {
    if (file.size > PDF_LIMITS.maxFileBytes) {
        onError(escapeHtml(t('d.import.fileTooLarge', { limit: Math.round(PDF_LIMITS.maxFileBytes / 1048576) + ' MB' })));
        return null;
    }
    onStatus(`<span class="spinner" aria-hidden="true"></span>${t('pdf.loading')}`);
    let pdfjs;
    try {
        pdfjs = await loadPdfJs();
    } catch (_) {
        onError(t('pdf.loadFailed'));
        return null;
    }
    let pdf;
    try {
        const data = await file.arrayBuffer();
        pdf = await openPdfDocument(pdfjs, data);
    } catch (err) {
        const name = err && err.name;
        onError(name === 'PasswordException' ? t('pdf.password') : t('pdf.corrupt'));
        return null;
    }
    let pages;
    try {
        pages = await extractPagesLines(pdf, (page, total) => {
            onStatus(`<span class="spinner" aria-hidden="true"></span>${t('pdf.parsingPage', { page, total })}`);
        });
    } catch (err) {
        onError(err instanceof PdfLimitError ? escapeHtml(t('d.import.pdfTooManyPages')) : t('pdf.corrupt'));
        return null;
    } finally {
        pdf.destroy().catch(() => {});
    }
    // Scanned/image PDFs extract no text at all.
    const totalText = pages.map(lines => lines.map(l => l.text).join('')).join('');
    if (!totalText.trim()) {
        onError(t('pdf.scanned'));
        return null;
    }
    onStatus('');
    return pages;
}

async function handleStatementFile(file) {
    if (!file) return;
    setHTML('pdf-import-result', '');
    const pages = await readPdfPages(file, statusLine, errorBox);
    if (!pages) return;

    draft = { pages, fileName: file.name, transactions: [], bank: null };
    rebuildTransactions();

    getElement('pdf-import-drop').hidden = true;
    getElement('pdf-import-config').hidden = false;
    const nameInput = getElement('pdf-import-source-name');
    if (nameInput && !nameInput.value) {
        nameInput.value = draft.bank
            ? `${draft.bank.name} statement`
            : file.name.replace(/\.pdf$/i, '').slice(0, 40);
    }
    renderPreview();
}

// ---- commit / undo (identical flow to the CSV importer) ----

// FT-R-57: one line per manual entry merged with its bank row.
function mergeLines(merges) {
    return merges.map(m => `<p class="import-success-sub">${t('b.merge.line', { desc: escapeHtml(m.description || m.bankDescription), amount: formatCurrency(Math.abs(m.amountCents) / 100), date: escapeHtml(m.date) })}</p>`).join('');
}

async function commitImport() {
    if (!draft || !draft.transactions.length) return;
    const sourceName = (getValue('pdf-import-source-name') || '').trim();
    const batchId = crypto.randomUUID();

    const txns = draft.transactions.map(txn => {
        const c = resolveCategory(txn.description, txn.categoryId, store.financeData.categories, store.financeData.rules);
        return makeTransaction({
            date: txn.date,
            description: txn.description,
            amountCents: txn.amountCents,
            categoryId: c.categoryId,
            status: c.status,
            source: 'pdf',
            importBatchId: batchId,
        });
    });

    const commitBtn = getElement('pdf-import-commit');
    commitBtn.disabled = true;
    let result, merges = [];
    try {
        const done = await commitImportRows(txns);
        merges = done.merges;
        result = done.result;
        await rematchBills(store.financeData);
    } catch (err) {
        setHTML('pdf-import-result', `<div class="import-errors-box"><p class="import-errors-title">${t('import.saveFailed', { message: escapeHtml(String(err && err.message || err)) })}</p></div>`);
        commitBtn.disabled = false;
        return;
    }

    let eventId = null;
    if (result.added > 0) {
        try {
            const ev = await logEvent('import', { batchId, count: result.added, sourceName });
            eventId = ev.id;
        } catch (err) { console.warn('Ledger: import step failed', err); }
    }
    lastCommit = { batchId, eventId, added: result.added };

    getElement('pdf-import-config').hidden = true;
    setHTML('pdf-import-preview', '');
    setHTML('pdf-import-errors', '');
    getElement('pdf-import-actions').hidden = true;
    const dupNote = result.duplicates > 0
        ? t(result.duplicates === 1 ? 'import.success.dupOne' : 'import.success.dupMany', { count: result.duplicates })
        : '';
    setHTML('pdf-import-result', `
        <div class="import-success">
            <p class="import-success-title">${t('import.success.title', { count: result.added, txnWord: txnWord(result.added), dupNote })}</p>
            <p class="import-success-sub">${t('import.success.sub')}</p>
            ${mergeLines(merges)}
            <div class="settings-actions" style="border-top: none; padding-top: 8px; margin-top: 4px;">
                <button class="btn btn-secondary" id="pdf-import-another">${t('import.another')}</button>
                ${result.added > 0 ? `<button class="btn btn-secondary" id="pdf-import-undo">${t('import.undo')}</button>` : ''}
            </div>
        </div>`);

    await refreshSpendCache();
    updateAllUI();
    if (result.added > 0) openActivityToReview(); // A7: land on Activity with To review on
    else if (store.activeTab === 'today') renderHomeFeed();
}

async function undoLastImport() {
    if (!lastCommit) return;
    try {
        await deleteImportBatch(lastCommit.batchId);
        if (lastCommit.eventId) await deleteEvent(lastCommit.eventId);
    } catch (err) { console.warn('Ledger: import step failed', err); }
    setHTML('pdf-import-result', `
        <div class="import-success">
            <p class="import-success-title">${t('import.undo.done', { count: lastCommit.added })}</p>
            <div class="settings-actions" style="border-top: none; padding-top: 8px; margin-top: 4px;">
                <button class="btn btn-secondary" id="pdf-import-another">${t('import.another')}</button>
            </div>
        </div>`);
    lastCommit = null;
    await refreshSpendCache();
    updateAllUI();
    if (store.activeTab === 'today') renderHomeFeed();
}

// ---- payslip reading (the income sheet's check panel uses it) ----

/**
 * Reads a payslip PDF and returns the parsed figures (net, tax, gross, help ...), or null with the
 * reason sent to onError. Writes nothing: the income sheet's check panel (C6) and the settings
 * autofill both use it.
 */
export async function readPayslip(file, onStatus, onError) {
    const pages = await readPdfPages(file, onStatus, onError);
    if (!pages) return null;
    const parsed = parsePayslipLines(pages.flat().map(l => l.text));
    if (parsed.net == null && parsed.tax == null && parsed.gross == null) {
        onError(t('payslip.nothingFound'));
        return null;
    }
    return parsed;
}

// ---- wiring ----

export function setupPdfImport() {
    setupModal('pdf-import-modal', 'open-pdf-import', resetDraft);

    const drop = getElement('pdf-import-drop');
    const fileInput = getElement('pdf-import-file');
    const browse = getElement('pdf-import-browse');
    if (!drop || !fileInput) return;

    browse.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleStatementFile(fileInput.files && fileInput.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-dragover');
        handleStatementFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    // Sign flip re-parses the draft (some banks print spending unsigned).
    getElement('pdf-import-invert').addEventListener('change', () => {
        if (!draft) return;
        rebuildTransactions();
        renderPreview();
    });

    // Preview category corrections write back onto the draft rows.
    getElement('pdf-import-preview').addEventListener('change', (e) => {
        const sel = e.target.closest('.import-cat-select');
        if (!sel || !draft) return;
        const i = parseInt(sel.dataset.previewIndex, 10);
        if (draft.transactions[i]) draft.transactions[i].categoryId = sel.value;
    });

    // Commit / start over / post-commit actions (delegated — result HTML is dynamic).
    getElement('pdf-import-modal').addEventListener('click', (e) => {
        if (e.target.id === 'pdf-import-commit') commitImport();
        else if (e.target.id === 'pdf-import-start-over') resetDraft();
        else if (e.target.id === 'pdf-import-another') resetDraft();
        else if (e.target.id === 'pdf-import-undo') undoLastImport();
    });
}
