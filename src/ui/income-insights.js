// Variable-income UI surfaces: the Income tab's variable-source card + tax
// provision card, the Home tab's volatility section, the Dashboard coaster
// card, and the Savings tab's tax-pot comparison. All maths comes from
// src/calc/income-events.js; this module only renders.
//
// Every surface hides itself when no Variable source exists, so salaried-only
// users see exactly the app they had before.

import { store } from '../state/store.js';
import { getElement, setHTML, escapeHtml, formatCurrency } from '../utils.js';
import { AU_TAX_YEARS } from '../calc/tax-au.js';
import {
    sumEvents, fyRange, activeFyKey, eventFigures, hasVariableSources,
    isVariableSource, monthlyNetSeries, quarterlySummary,
    estimateVariableTaxProvision, labelSummary, averageMonthlyExpenses,
    coasterMonths, detectSlowSeasons,
} from '../calc/income-events.js';
import { t } from '../i18n/strings.js';

function fyLabel(fyKey) {
    return AU_TAX_YEARS[fyKey] ? AU_TAX_YEARS[fyKey].label : fyKey;
}

// Accessible emoji badge — the emoji is decorative-with-meaning, so it gets a
// role and label; the text sits beside it for sighted users.
function badge(cls, emoji, labelKey) {
    const label = t(labelKey);
    return `<span class="event-badge ${cls}"><span role="img" aria-label="${escapeHtml(label)}">${emoji}</span> ${escapeHtml(label)}</span>`;
}

// ---------- Income tab: variable source card ----------

/** Inner HTML for a Variable source's card on the Income tab. */
export function buildVariableSourceCardHtml(source, isPrimary) {
    const fyKey = activeFyKey(store.financeData.taxSettings);
    const { from, to } = fyRange(fyKey);
    const events = Array.isArray(source.incomeEvents) ? source.incomeEvents : [];
    const fy = sumEvents(events, from, to);

    let recentHtml;
    const dated = events.filter(e => e && e.date).sort((a, b) => b.date.localeCompare(a.date));
    if (!dated.length) {
        recentHtml = `<p style="text-align:center; font-size:0.9em; color: var(--text-color-secondary); margin: 14px 0;">${t('varInc.card.noEvents')}</p>`;
    } else {
        const rows = dated.slice(0, 5).map(e => {
            const f = eventFigures(e);
            const badges = [
                e.penaltyRates ? badge('is-penalty', '⚡', 'varInc.card.penaltyBadge') : '',
                e.gstInclusive ? badge('', '🧾', 'varInc.card.gstBadge') : '',
                f.cash > 0 ? badge('is-cash', '💵', 'varInc.card.cashBadge') : '',
            ].filter(Boolean).join(' ');
            const when = new Date(e.date + 'T00:00:00')
                .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            return `
                <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; padding:6px 0; border-bottom:1px solid var(--border-color); flex-wrap:wrap;">
                    <span style="min-width:0;">
                        <span style="color: var(--text-color-secondary); font-variant-numeric: tabular-nums;">${escapeHtml(when)}</span>
                        <span style="margin-left:8px;">${escapeHtml(e.label || 'Unlabelled')}</span>
                        ${badges ? `<span style="margin-left:6px;">${badges}</span>` : ''}
                    </span>
                    <span style="font-weight:600; font-variant-numeric: tabular-nums; color: var(--color-positive);">${formatCurrency(f.net)}</span>
                </div>`;
        }).join('');
        recentHtml = `
            <div style="margin-top: 14px;">
                <div class="card-subtitle">${t('varInc.card.recent')}</div>
                ${rows}
            </div>`;
    }

    // Per-label rollup for the FY (top 5 by net).
    const fyEvents = events.filter(e => e && e.date && e.date >= from && e.date <= to);
    const labels = labelSummary(fyEvents, source.baseHourlyRate).slice(0, 5);
    let labelsHtml = '';
    if (labels.length) {
        const rows = labels.map(row => {
            const details = [];
            if (row.cash > 0) details.push(t('varInc.card.cashSplit', { bank: formatCurrency(row.bank), cash: formatCurrency(row.cash) }));
            if (row.hours > 0 && row.effectiveRate != null) {
                details.push(t('varInc.card.hours', { hours: row.hours, rate: formatCurrency(row.effectiveRate) }));
            }
            if (row.basePortion != null && row.penaltyPortion != null) {
                details.push(t('varInc.card.penaltySplit', { base: formatCurrency(row.basePortion), loading: formatCurrency(row.penaltyPortion) }));
            }
            return `
                <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; padding:6px 0; border-bottom:1px solid var(--border-color); flex-wrap:wrap;">
                    <span style="min-width:0;">
                        ${escapeHtml(row.label)}
                        ${row.penaltyCount > 0 ? badge('is-penalty', '⚡', 'varInc.card.penaltyBadge') : ''}
                        ${details.length ? `<div style="font-size:0.82em; color: var(--text-color-secondary);">${details.map(escapeHtml).join(' · ')}</div>` : ''}
                    </span>
                    <span style="font-weight:600; font-variant-numeric: tabular-nums;">${formatCurrency(row.net)}</span>
                </div>`;
        }).join('');
        labelsHtml = `
            <div style="margin-top: 14px;">
                <div class="card-subtitle">${t('varInc.card.byLabel', { fy: escapeHtml(fyLabel(fyKey)) })}</div>
                ${rows}
            </div>`;
    }

    const grossAnnual = source._calculatedGrossAnnual || 0;
    const taxAnnual = source._calculatedAnnualTax || 0;
    const netAnnual = source._calculatedNetAnnual || 0;

    return `
        <div class="card-title">${escapeHtml(source.name)} ${isPrimary ? '(Primary)' : ''}</div>
        <div class="card-subtitle">${t('varInc.card.subtitle', { fy: escapeHtml(fyLabel(fyKey)), gross: formatCurrency(grossAnnual) })}</div>
        <div class="time-periods">
            <div class="time-item">
                <div class="time-label">Net (${escapeHtml(fyLabel(fyKey))})</div>
                <div class="time-amount">${formatCurrency(netAnnual)}</div>
            </div>
            <div class="time-item">
                <div class="time-label">Tax withheld</div>
                <div class="time-amount">${formatCurrency(taxAnnual)}</div>
            </div>
            <div class="time-item">
                <div class="time-label">Hours tracked</div>
                <div class="time-amount">${fy.hours > 0 ? fy.hours : '—'}</div>
            </div>
        </div>
        ${recentHtml}
        ${labelsHtml}
        <div class="source-annual-breakdown" style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color); font-size:0.9em; font-variant-numeric: tabular-nums;">
            <span>Gross: <strong>${formatCurrency(grossAnnual)}</strong></span>
            <span style="color: var(--color-negative);">Tax withheld: <strong>${formatCurrency(taxAnnual)}</strong></span>
            <span style="color: var(--color-positive);">Net: <strong>${formatCurrency(netAnnual)}</strong></span>
        </div>`;
}

/** Standalone tax-provision card appended to the Income tab's stream list. */
export function buildTaxProvisionCardHtml() {
    if (!hasVariableSources(store.financeData)) return '';
    const prov = estimateVariableTaxProvision(store.financeData);
    if (!prov) return '';
    const bodyKey = prov.ytdWithheld >= prov.provisionToDate ? 'varInc.provision.bodyCovered' : 'varInc.provision.body';
    const gstNote = prov.ytdGst > 0
        ? `<p style="margin-top:10px; font-size:0.85em; color: var(--text-color-secondary);">${t('varInc.provision.gstNote', { gst: formatCurrency(prov.ytdGst) })}</p>`
        : '';
    return `
        <div class="card-title">${t('varInc.provision.title', { fy: escapeHtml(fyLabel(prov.fyKey)) })}</div>
        <div class="card-subtitle">Annualised from your pace so far — an estimate, not tax advice</div>
        <p style="margin: 14px 0 0; line-height: 1.5;">${t(bodyKey, {
            projGross: formatCurrency(prov.projectedAnnualGross),
            projTax: formatCurrency(prov.projectedAnnualTax),
            toDate: formatCurrency(prov.provisionToDate),
            withheld: formatCurrency(prov.ytdWithheld),
            still: `<strong>${formatCurrency(prov.stillToSetAside)}</strong>`,
        })}</p>
        ${gstNote}`;
}

// ---------- Home tab: income volatility section ----------

export function renderIncomeVolatility(totals) {
    const el = getElement('home-income-volatility');
    if (!el) return;
    if (!hasVariableSources(store.financeData)) { el.innerHTML = ''; return; }

    const data = store.financeData;
    const fyKey = activeFyKey(data.taxSettings);
    const series = monthlyNetSeries(data, 12);
    const totalsByMonth = series.map(m => m.total);
    const max = Math.max(...totalsByMonth, 1);
    const avg = totalsByMonth.reduce((s, v) => s + v, 0) / (series.length || 1);

    // Bars: regular income as a muted base segment, variable stacked on top.
    const bars = series.map(m => {
        const regPct = Math.max(0, (m.regular / max) * 100);
        const varPct = Math.max(0, (m.variable / max) * 100);
        return `
        <div class="vol-col" title="${escapeHtml(`${m.label}: ${formatCurrency(m.total)}`)}" aria-label="${escapeHtml(t('vol.monthAria', { month: m.label, amount: formatCurrency(m.total) }))}" role="img">
            <div class="vol-bar" style="height:${varPct.toFixed(1)}%;"></div>
            ${m.regular > 0 ? `<div class="vol-bar is-regular" style="height:${regPct.toFixed(1)}%;"></div>` : ''}
            <span class="vol-col-label" aria-hidden="true">${escapeHtml(m.label)}</span>
        </div>`;
    }).join('');
    // Average line: distance from the bottom of the plot area (bars sit above an
    // 18px label strip, so the line offsets against the full chart height).
    const avgFromBottom = 18 + ((120 - 18) * Math.min(1, avg / max));

    // Stat cards.
    let best = series[0], worst = series[0];
    for (const m of series) {
        if (m.total > best.total) best = m;
        if (m.total < worst.total) worst = m;
    }
    const { from, to } = fyRange(fyKey);
    const fyEvents = [];
    for (const s of data.incomeSources) {
        if (isVariableSource(s)) fyEvents.push(...(s.incomeEvents || []));
    }
    const ytd = sumEvents(fyEvents, from, to);

    // Quarterly (BAS) table.
    const quarters = quarterlySummary(data, fyKey);
    const qRows = quarters.map(q => `
        <tr>
            <td>${escapeHtml(`${q.key} · ${q.label}`)}</td>
            <td>${q.count || '—'}</td>
            <td>${formatCurrency(q.net)}</td>
            <td>${formatCurrency(q.tax)}</td>
            <td>${formatCurrency(q.gst)}</td>
        </tr>`).join('');

    // Slow-season awareness.
    const seasons = detectSlowSeasons(data);
    let seasonHtml = '';
    if (seasons.enoughData && seasons.slowMonths.length) {
        const names = seasons.slowMonths.map(s => s.name);
        const listed = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
        seasonHtml = `<p class="vol-season-note">${t('vol.slowSeason', {
            months: escapeHtml(listed),
            runWord: t(names.length === 1 ? 'vol.slowSeasonOne' : 'vol.slowSeasonMany'),
        })}</p>`;
    } else if (!seasons.enoughData) {
        seasonHtml = `<p class="vol-avg-caption" style="margin-top:12px;">${t('vol.notEnoughHistory')}</p>`;
    }

    el.innerHTML = `
        <div class="volatility-card">
            <div class="volatility-head">
                <span class="volatility-title">${t('vol.title')}</span>
                <span class="volatility-sub">${t('vol.subtitle')}</span>
            </div>
            <div class="vol-chart">
                ${bars}
                <div class="vol-avg-line" style="bottom:${avgFromBottom.toFixed(1)}px;"></div>
            </div>
            <p class="vol-avg-caption">${t('vol.avgLine', { avg: formatCurrency(avg) })}</p>
            <div class="vol-stats">
                <div class="vol-stat"><div class="vol-stat-label">${t('vol.bestMonth')}</div><div class="vol-stat-value">${escapeHtml(best.label)} · ${formatCurrency(best.total)}</div></div>
                <div class="vol-stat"><div class="vol-stat-label">${t('vol.worstMonth')}</div><div class="vol-stat-value">${escapeHtml(worst.label)} · ${formatCurrency(worst.total)}</div></div>
                <div class="vol-stat"><div class="vol-stat-label">${t('vol.monthlyAvg')}</div><div class="vol-stat-value">${formatCurrency(avg)}</div></div>
                <div class="vol-stat"><div class="vol-stat-label">${t('vol.ytd')}</div><div class="vol-stat-value">${formatCurrency(ytd.net)}</div></div>
            </div>
            <div class="vol-quarter-table-wrap">
                <table class="vol-quarter-table">
                    <caption class="visually-hidden">${t('vol.quarterTitle', { fy: escapeHtml(fyLabel(fyKey)) })}</caption>
                    <thead><tr>
                        <th scope="col">${t('vol.q.quarter')}</th>
                        <th scope="col">${t('vol.q.events')}</th>
                        <th scope="col">${t('vol.q.net')}</th>
                        <th scope="col">${t('vol.q.tax')}</th>
                        <th scope="col">${t('vol.q.gst')}</th>
                    </tr></thead>
                    <tbody>${qRows}</tbody>
                </table>
            </div>
            <p class="vol-avg-caption" style="margin-top:6px;">${t('vol.quarterHint')}</p>
            ${seasonHtml}
        </div>`;
}

// ---------- Dashboard: coaster card ----------

// Async (transactions live in IndexedDB) — fire-and-forget from the sync
// dashboard renderer, same pattern as the Home feed.
export async function renderCoasterCard(totals) {
    const card = getElement('dashboard-coaster-card');
    if (!card) return;
    if (!hasVariableSources(store.financeData)) { card.hidden = true; return; }
    card.hidden = false;

    let avgSpend = 0;
    try {
        const { listTransactions } = await import('../state/transactions.js');
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
        const rows = await listTransactions({ from });
        avgSpend = averageMonthlyExpenses(rows, now, 3);
    } catch (_) {
        avgSpend = 0; // IndexedDB unavailable — fall through to the empty state
    }

    const months = coasterMonths(totals.currentAssets, avgSpend);
    let html;
    if (months == null) {
        html = `<p style="margin:0; color: var(--text-color-secondary);">${t('coast.noExpenses')}</p>`;
    } else {
        const rounded = months >= 10 ? Math.round(months) : Math.round(months * 10) / 10;
        const monthsLabel = `${rounded} ${t(rounded === 1 ? 'coast.monthOne' : 'coast.monthMany')}`;
        html = `
            <div class="amount" style="color: var(--color-neutral);">${escapeHtml(monthsLabel)}</div>
            <p style="margin: 8px 0 0; font-size: 0.9em;">${t('coast.months', { months: `<strong>${escapeHtml(monthsLabel)}</strong>` })}</p>
            <p style="margin: 6px 0 0; font-size: 0.82em; color: var(--text-color-secondary);">${t('coast.detail', {
                assets: formatCurrency(totals.currentAssets),
                spend: formatCurrency(avgSpend),
            })}</p>`;
    }

    // Slow-season awareness rides along on the coaster card.
    const seasons = detectSlowSeasons(store.financeData);
    if (seasons.enoughData && seasons.slowMonths.length) {
        const names = seasons.slowMonths.map(s => s.name);
        const listed = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
        html += `<p class="vol-season-note">${t('vol.slowSeason', {
            months: escapeHtml(listed),
            runWord: t(names.length === 1 ? 'vol.slowSeasonOne' : 'vol.slowSeasonMany'),
        })}</p>`;
    } else if (!seasons.enoughData) {
        html += `<p style="margin: 10px 0 0; font-size: 0.82em; color: var(--text-color-secondary);">${t('vol.notEnoughHistory')}</p>`;
    }

    setHTML('dashboard-coaster-body', html);
}

// ---------- Savings tab: tax pot vs estimated liability ----------

export function renderTaxProvisionCard(totals) {
    const card = getElement('tax-provision-card');
    if (!card) return;
    if (!hasVariableSources(store.financeData)) { card.hidden = true; return; }
    card.hidden = false;

    const prov = estimateVariableTaxProvision(store.financeData);
    const pot = (store.financeData.allocation || []).find(a => a.isTaxProvision);

    let html;
    if (!prov) {
        html = `<p style="margin:0; color: var(--text-color-secondary);">${t('taxpot.noEstimate')}</p>`;
    } else if (!pot) {
        html = `<p style="margin:0; color: var(--text-color-secondary);">${t('taxpot.none')}</p>`;
    } else {
        const balance = pot.currentBalance || 0;
        const target = prov.provisionToDate;
        const onTrack = balance >= target;
        const pct = target > 0 ? Math.min(100, (balance / target) * 100) : 100;
        html = `
            <p style="margin: 0 0 10px;">${t(onTrack ? 'taxpot.onTrack' : 'taxpot.behind', {
                name: `<strong>${escapeHtml(pot.name)}</strong>`,
                balance: formatCurrency(balance),
                target: formatCurrency(target),
                gap: `<strong>${formatCurrency(Math.max(0, target - balance))}</strong>`,
            })}</p>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%; background: var(${onTrack ? '--color-positive' : '--color-warning'});"></div></div>
            <p style="margin: 10px 0 0; font-size: 0.82em; color: var(--text-color-secondary);">
                Full-year estimate ${formatCurrency(prov.projectedAnnualTax)} on a projected ${formatCurrency(prov.projectedAnnualGross)} gross · ${formatCurrency(prov.ytdWithheld)} already withheld on events.
            </p>`;
    }
    setHTML('tax-provision-body', html);
}
