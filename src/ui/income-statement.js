// Printable income statement for variable-income earners — a clean HTML page
// opened in a new tab via window.open(). Month-by-month breakdown, per-client
// totals, hourly rates where hours are tracked. No scripts on the page (the
// opener's CSP is inherited); printing is the browser's Ctrl/Cmd+P.

import { store } from '../state/store.js';
import { getElement, setText, escapeHtml, formatCurrency } from '../utils.js';
import {
    isVariableSource, sumEvents, eventFigures, labelSummary,
    fyRange, activeFyKey, monthLabel,
} from '../calc/income-events.js';
import { t } from '../i18n/strings.js';

function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Resolve the period select value ('3' | '6' | '12' | 'fy') to an ISO range. */
function periodRange(choice) {
    const now = new Date();
    if (choice === 'fy') {
        const { from } = fyRange(activeFyKey(store.financeData.taxSettings, now));
        return { from, to: isoToday(), label: `Financial year to date (from ${from})` };
    }
    const months = parseInt(choice, 10) || 6;
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
    return { from, to: isoToday(), label: `Last ${months} months (from ${from})` };
}

function fmtDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function openIncomeStatement(periodChoice = '6') {
    const { from, to, label } = periodRange(periodChoice);

    // Gather events (with their source name) from every Variable source.
    const events = [];
    for (const source of (store.financeData.incomeSources || [])) {
        if (!isVariableSource(source)) continue;
        for (const e of (source.incomeEvents || [])) {
            if (e && e.date && e.date >= from && e.date <= to) events.push(e);
        }
    }
    const note = getElement('income-statement-note');
    if (!events.length) {
        if (note) setText('income-statement-note', t('stmt.none'));
        return;
    }
    if (note) setText('income-statement-note', '');

    // Month-by-month rollup, oldest first.
    const byMonth = new Map();
    for (const e of events) {
        const key = e.date.slice(0, 7);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(e);
    }
    const monthKeys = [...byMonth.keys()].sort();
    const monthRows = monthKeys.map(key => {
        const totals = sumEvents(byMonth.get(key));
        const year = key.slice(0, 4);
        return `<tr>
            <td>${escapeHtml(monthLabel(key))} ${escapeHtml(year)}</td>
            <td>${totals.count}</td>
            <td>${totals.hours > 0 ? totals.hours : '—'}</td>
            <td>${formatCurrency(totals.gross)}</td>
            <td>${formatCurrency(totals.tax)}</td>
            <td>${totals.gst > 0 ? formatCurrency(totals.gst) : '—'}</td>
            <td>${formatCurrency(totals.net)}</td>
        </tr>`;
    }).join('');

    // Per-client rollup (all labels, net desc). Hourly rate only where tracked.
    const clients = labelSummary(events);
    const clientRows = clients.map(row => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${row.count}</td>
        <td>${row.hours > 0 ? row.hours : '—'}</td>
        <td>${row.effectiveRate != null ? formatCurrency(row.effectiveRate) + '/hr' : '—'}</td>
        <td>${row.cash > 0 ? `${formatCurrency(row.bank)} + ${formatCurrency(row.cash)} cash` : formatCurrency(row.bank)}</td>
        <td>${formatCurrency(row.net)}</td>
    </tr>`).join('');

    const grand = sumEvents(events);
    const gstFooter = grand.gst > 0
        ? `<p class="fineprint">GST collected in this period: ${formatCurrency(grand.gst)} (excluded from the income figures above — it is remitted to the ATO).</p>`
        : '';

    const win = window.open('', '_blank');
    if (!win) {
        if (note) setText('income-statement-note', t('stmt.popupBlocked'));
        return;
    }
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Income statement — ${escapeHtml(label)}</title>
<style>
    :root { color-scheme: light; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; margin: 0; padding: 40px; background: #fff; color: #1e232b; max-width: 860px; margin-inline: auto; }
    h1 { font-size: 1.5rem; margin: 0 0 2px; }
    h2 { font-size: 1.05rem; margin: 32px 0 10px; border-bottom: 2px solid #1e232b; padding-bottom: 4px; }
    .meta { color: #555; font-size: 0.9rem; margin: 0 0 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th { text-align: right; padding: 8px 10px; border-bottom: 2px solid #1e232b; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
    th:first-child, td:first-child { text-align: left; }
    td { text-align: right; padding: 7px 10px; border-bottom: 1px solid #ddd; font-variant-numeric: tabular-nums; }
    tfoot td { border-top: 2px solid #1e232b; border-bottom: none; font-weight: 700; }
    .fineprint { color: #666; font-size: 0.78rem; margin-top: 24px; line-height: 1.5; }
    .print-hint { background: #f2f4f7; border: 1px solid #d7dce3; border-radius: 8px; padding: 10px 14px; font-size: 0.85rem; margin: 18px 0 0; }
    @media print { .print-hint { display: none; } body { padding: 0; } }
</style>
</head>
<body>
    <h1>Income statement</h1>
    <p class="meta">Period: ${escapeHtml(label)} · Prepared ${escapeHtml(fmtDate(isoToday()))}</p>
    <p class="meta">Self-reported income record generated from Ledger. Figures are net of GST; cash amounts are included.</p>
    <p class="print-hint">Use your browser's Print (Ctrl/Cmd+P) to save this as a PDF.</p>

    <h2>Month by month</h2>
    <table>
        <thead><tr><th>Month</th><th>Events</th><th>Hours</th><th>Gross</th><th>Tax withheld</th><th>GST collected</th><th>Net income</th></tr></thead>
        <tbody>${monthRows}</tbody>
        <tfoot><tr>
            <td>Total</td><td>${grand.count}</td><td>${grand.hours > 0 ? grand.hours : '—'}</td>
            <td>${formatCurrency(grand.gross)}</td><td>${formatCurrency(grand.tax)}</td>
            <td>${grand.gst > 0 ? formatCurrency(grand.gst) : '—'}</td><td>${formatCurrency(grand.net)}</td>
        </tr></tfoot>
    </table>

    <h2>By client / venue</h2>
    <table>
        <thead><tr><th>Client</th><th>Events</th><th>Hours</th><th>Avg hourly</th><th>Banked / cash</th><th>Net income</th></tr></thead>
        <tbody>${clientRows}</tbody>
    </table>

    ${gstFooter}
    <p class="fineprint">Generated locally by Ledger — no data left the device. This is a personal record, not a formal tax document.</p>
</body>
</html>`);
    win.document.close();
}

/** Wire the button in the income settings modal. Called once at startup. */
export function setupIncomeStatement() {
    const btn = getElement('open-income-statement');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const period = getElement('income-statement-period');
        openIncomeStatement(period ? period.value : '6');
    });
}
