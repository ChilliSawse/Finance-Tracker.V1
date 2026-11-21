// Variable-income UI: the income volatility section (Future and Home). A12a removed the Income tab's
// variable-source card, the Dashboard coaster card and the Savings tax-pot card with their panels; the tax
// provision card now lives in future/. All maths comes from src/calc/income-events.js; this module only renders.
//
// Every surface hides itself when no Variable source exists, so salaried-only
// users see exactly the app they had before.

import { store } from '../state/store.js';
import { getElement, escapeHtml, formatCurrency } from '../utils.js';
import { AU_TAX_YEARS } from '../calc/tax-au.js';
import {
    sumEvents, fyRange, activeFyKey, hasVariableSources,
    isVariableSource, monthlyNetSeries, quarterlySummary,
    detectSlowSeasons,
} from '../calc/income-events.js';
import { t } from '../i18n/strings.js';
import { escNum } from './html.js';

function fyLabel(fyKey) {
    return AU_TAX_YEARS[fyKey] ? AU_TAX_YEARS[fyKey].label : fyKey;
}

// ---------- Home tab: income volatility section ----------

export function renderIncomeVolatility(totals, target, title) {
    const el = target || getElement('home-income-volatility');
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
            <td>${escNum(q.count) || '—'}</td>
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
                <span class="volatility-title">${title ? escapeHtml(title) : t('vol.title')}</span>
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
