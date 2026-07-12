// Bank PDF import flow + payslip autofill — a sibling of import-ui.js with the
// same shape: module-local draft state, one exported setup function, nothing
// written until the user explicitly commits. Reuses the CSV pipeline's pure
// helpers and the exact same commit path (makeTransaction → addTransactions →
// logEvent → refreshSpendCache → updateAllUI), so PDF rows behave identically
// to CSV rows everywhere downstream.

import { store } from '../state/store.js';
import { getElement, getValue, setHTML, escapeHtml, formatCurrency, getPayCyclesPerYear } from '../utils.js';
import { categoriseDescription } from '../state/categories.js';
import { makeTransaction, addTransactions, deleteImportBatch } from '../state/transactions.js';
import { logEvent, deleteEvent } from '../state/eventlog.js';
import { setupModal } from '../ui/modals.js';
import { renderHomeFeed } from '../ui/feed.js';
import { renderIncomeSourcesSettings } from '../ui/settings-forms.js';
import { refreshSpendCache } from '../state/spend-cache.js';
import { updateAllUI, updateDataAndUI } from '../ui/render.js';
import { loadPdfJs, openPdfDocument, extractPagesLines } from './pdfjs-loader.js';
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
            const catId = txn.categoryId || categoriseDescription(txn.description, store.financeData.categories);
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
    } catch (_) {
        onError(t('pdf.corrupt'));
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

async function commitImport() {
    if (!draft || !draft.transactions.length) return;
    const sourceName = (getValue('pdf-import-source-name') || '').trim();
    const batchId = crypto.randomUUID();

    const txns = draft.transactions.map(txn => makeTransaction({
        date: txn.date,
        description: txn.description,
        amountCents: txn.amountCents,
        categoryId: txn.categoryId || categoriseDescription(txn.description, store.financeData.categories),
        source: 'pdf',
        importBatchId: batchId,
    }));

    const commitBtn = getElement('pdf-import-commit');
    commitBtn.disabled = true;
    let result;
    try {
        result = await addTransactions(txns);
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
        } catch (_) {}
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
            <div class="settings-actions" style="border-top: none; padding-top: 8px; margin-top: 4px;">
                <button class="btn btn-secondary" id="pdf-import-another">${t('import.another')}</button>
                ${result.added > 0 ? `<button class="btn btn-secondary" id="pdf-import-undo">${t('import.undo')}</button>` : ''}
            </div>
        </div>`);

    await refreshSpendCache();
    updateAllUI();
    if (store.activeTab === 'home') renderHomeFeed();
}

async function undoLastImport() {
    if (!lastCommit) return;
    try {
        await deleteImportBatch(lastCommit.batchId);
        if (lastCommit.eventId) await deleteEvent(lastCommit.eventId);
    } catch (_) {}
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
    if (store.activeTab === 'home') renderHomeFeed();
}

// ---- payslip autofill (income settings modal) ----

let payslipSourceIndex = null;

function payslipStatus(index, html) {
    const el = getElement(`payslip-status-${index}`);
    if (el) el.innerHTML = html;
}

async function handlePayslipFile(file) {
    const index = payslipSourceIndex;
    payslipSourceIndex = null;
    if (!file || index == null) return;
    const source = store.financeData.incomeSources[index];
    if (!source) return;

    const onStatus = (html) => payslipStatus(index, html);
    const onError = (message) => payslipStatus(index, `<span style="color: var(--color-negative);">${message}</span>`);
    onStatus(`<span class="spinner" aria-hidden="true"></span>${t('payslip.parsing')}`);
    const pages = await readPdfPages(file, onStatus, onError);
    if (!pages) return;

    const lines = pages.flat().map(l => l.text);
    const parsed = parsePayslipLines(lines);
    if (parsed.net == null && parsed.tax == null && parsed.gross == null) {
        onError(t('payslip.nothingFound'));
        return;
    }

    // Apply: per-cycle figures land directly; gross annualises via the pay
    // schedule (payslip's own frequency wins when it names one).
    if (parsed.schedule) source.paySchedule = parsed.schedule;
    const cycles = getPayCyclesPerYear(source.paySchedule);
    if (parsed.net != null) source.invoicedPayPostTax = +parsed.net.toFixed(2);
    if (parsed.tax != null) source.taxRemoved = +parsed.tax.toFixed(2);
    let grossPart = '';
    if (parsed.gross != null && source.incomeType !== 'selfEmployed') {
        source.grossAnnual = +(parsed.gross * cycles).toFixed(2);
        grossPart = t('payslip.grossPart', { gross: formatCurrency(source.grossAnnual) });
    }
    const superPart = parsed.super != null
        ? t('payslip.superPart', { superAmt: formatCurrency(parsed.super) })
        : '';

    renderIncomeSourcesSettings();
    updateDataAndUI();
    // Re-render rebuilt the row tools — write the status after it.
    payslipStatus(index, `<span style="color: var(--color-positive);">${t('payslip.applied', {
        net: formatCurrency(parsed.net || 0),
        tax: formatCurrency(parsed.tax || 0),
        grossPart,
        superPart,
    })}</span>`);
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

    // Payslip autofill: the per-source buttons are re-rendered with the list,
    // so delegate at the document level (same pattern as settings-events).
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.payslip-upload-btn');
        if (!btn) return;
        payslipSourceIndex = parseInt(btn.dataset.parentIndex, 10);
        const payslipInput = getElement('payslip-file');
        if (payslipInput) { payslipInput.value = ''; payslipInput.click(); }
    });
    const payslipInput = getElement('payslip-file');
    if (payslipInput) {
        payslipInput.addEventListener('change', () => handlePayslipFile(payslipInput.files && payslipInput.files[0]));
    }
}
