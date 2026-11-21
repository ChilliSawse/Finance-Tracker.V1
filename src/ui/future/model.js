// Future screen model (F6). Pure: every figure comes from F1 (scenarios), F3 (the FI engine), F4 (the goal
// planner) or the existing HELP and tax-provision engines. Nothing is typed in. The view (view.js) turns this
// into HTML and index.js wires the DOM, the sheets and the saved-scenario store.

import { fiSummary, projectNetWorth } from '../../calc/fi.js';
import { scenarioHeadline } from '../../calc/scenario.js';
import { planGoalsFromData } from '../../calc/goal-planner.js';
import { calculateTotals } from '../../calc/calculations.js';
import { calculateHelpRepayment, projectHelpPayoff, getTaxYear, AU_TAX_YEARS } from '../../calc/tax-au.js';
import { estimateVariableTaxProvision, hasVariableSources } from '../../calc/income-events.js';
import { DEBT_LABELS, rateBand } from '../plan-assets-debts.js';

export const HORIZONS = [10, 20, 30];
export const DEFAULT_HORIZON = 30;
export const MAX_ON_CHART = 3;
export const MAX_PEOPLE = 4;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- the chart ----------

/** A round step (1, 2 or 5 times a power of ten) so that `span` takes at most `lines` gridlines. */
export function niceStep(span, lines = 5) {
    if (!(span > 0)) return 1;
    const raw = span / lines;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/**
 * The geometry of the net worth chart. Lines live in a 300 x 100 stretched viewBox; labels and dots are
 * placed in percent so the text never scales. `series`: [{id, kind:'now'|'scen', values:number[]}] (a value a year).
 * @returns {{grid:Array<{pct:number,value:number}>, lines:Array<{id,kind,d}>, fiPct:number, fiDot:?{left:number,top:number}, ticks:Array<{pct:number,year:number}>, yMin:number, yMax:number}}
 */
export function chartGeometry({ series, fiNumber, yearsToFI, years }) {
    const all = series.flatMap((s) => s.values).concat(Number.isFinite(fiNumber) ? [fiNumber] : [], [0]);
    const rawMax = Math.max(...all);
    const rawMin = Math.min(...all);
    const step = niceStep((rawMax - rawMin) * 1.04 || 1);
    const yMax = Math.ceil(rawMax / step) * step || step;
    const yMin = Math.floor(rawMin / step) * step;
    const span = yMax - yMin || 1;
    const pctY = (v) => ((yMax - v) / span) * 100;
    const grid = [];
    for (let v = yMin; v <= yMax + step / 2; v += step) grid.push({ pct: Math.round(pctY(v) * 100) / 100, value: Math.round(v) });
    const lines = series.map((s) => ({
        id: s.id, kind: s.kind,
        d: s.values.map((v, i) => `${i ? 'L' : 'M'}${((i / years) * 300).toFixed(2)} ${pctY(v).toFixed(2)}`).join(' '),
    }));
    const fiDot = Number.isFinite(yearsToFI) && yearsToFI > 0 && yearsToFI <= years
        ? { left: Math.round((yearsToFI / years) * 10000) / 100, top: Math.round(pctY(fiNumber) * 100) / 100 } : null;
    const tickStep = years <= 10 ? 2 : 5;
    const ticks = [];
    for (let y = 0; y <= years; y += tickStep) ticks.push({ pct: Math.round((y / years) * 10000) / 100, year: y });
    return { grid, lines, nowTop: Math.round(pctY(series[0].values[0]) * 100) / 100, fiPct: Math.round(pctY(fiNumber) * 100) / 100, fiDot, ticks, yMin, yMax };
}

// ---------- birth years (F3's fiAge reads people[].birthYear) ----------

const firstWord = (s) => String(s || '').split(/\s[—–-]\s|\s+/)[0].trim();

/** The people the Assumptions sheet asks about: one slot per income source (1 to 4). `name` is '' when it is only a placeholder. */
export function peopleSlots(data) {
    const src = Array.isArray(data && data.incomeSources) ? data.incomeSources : [];
    const n = Math.max(1, Math.min(MAX_PEOPLE, src.length));
    const out = [];
    for (let i = 0; i < n; i += 1) {
        const w = src[i] && typeof src[i].name === 'string' ? firstWord(src[i].name) : '';
        out.push({ index: i, name: w && w.length <= 24 ? w : '', birthYear: birthYearAt(data, i) });
    }
    return out;
}

/** `fiSettings.birthYears[i]` as a whole year, or null. */
export function birthYearAt(data, i) {
    const list = data && isObj(data.fiSettings) && Array.isArray(data.fiSettings.birthYears) ? data.fiSettings.birthYears : [];
    const y = list[i];
    return Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : null;
}

/** A read-only view of the data with `people` filled from `fiSettings.birthYears`, which is what F3's `fiAge` reads. */
export function withPeople(data) {
    const people = peopleSlots(data).filter((p) => p.birthYear != null).map((p) => ({ name: p.name, birthYear: p.birthYear }));
    return { ...data, people };
}

// ---------- the Assumptions sheet ----------

export const ASSUMPTION_DEFAULTS = { multiple: 25, expectedReturn: 7, inflation: 2.5 };

/** Field values for the sheet from the data (defaults where unset). */
export function assumptionValues(data) {
    const fs = isObj(data && data.fiSettings) ? data.fiSettings : {};
    const v = {
        multiple: Number.isFinite(fs.multiple) && fs.multiple > 0 ? fs.multiple : ASSUMPTION_DEFAULTS.multiple,
        expectedReturn: Number.isFinite(fs.expectedReturn) ? fs.expectedReturn : ASSUMPTION_DEFAULTS.expectedReturn,
        inflation: Number.isFinite(fs.inflation) ? fs.inflation : ASSUMPTION_DEFAULTS.inflation,
    };
    for (const p of peopleSlots(data)) v[`birthYear${p.index}`] = p.birthYear;
    return v;
}

/** Validation for the sheet values: {field: message key}. `nowYear` is the current year. */
export function validateAssumptions(v, nowYear) {
    const e = {};
    if (!(Number(v.multiple) > 0 && Number(v.multiple) <= 100)) e.multiple = 'f.future.err.multiple';
    if (!(v.expectedReturn != null && Number(v.expectedReturn) >= 0 && Number(v.expectedReturn) <= 30)) e.expectedReturn = 'f.future.err.return';
    if (!(v.inflation != null && Number(v.inflation) >= 0 && Number(v.inflation) <= 20)) e.inflation = 'f.future.err.inflation';
    for (const k of Object.keys(v)) {
        if (!/^birthYear\d+$/.test(k) || v[k] == null || v[k] === '') continue;
        const y = Number(v[k]);
        if (!(Number.isInteger(y) && y >= 1900 && y <= nowYear)) e[k] = 'f.future.err.birth';
    }
    return e;
}

/**
 * Write the sheet values to `data.fiSettings`. Returns {before} (a clone to restore with `restoreAssumptions`).
 * `birthYears` is only written when at least one year is given, or was there already (so an untouched save adds no key).
 */
export function applyAssumptions(data, v) {
    if (!isObj(data.fiSettings)) data.fiSettings = {};
    const fs = data.fiSettings;
    const before = structuredClone(fs);
    fs.multiple = Number(v.multiple);
    fs.expectedReturn = Number(v.expectedReturn);
    fs.inflation = Number(v.inflation);
    const slots = peopleSlots(data);
    const years = slots.map((p) => {
        const raw = v[`birthYear${p.index}`];
        return raw == null || raw === '' ? null : Number(raw);
    });
    if (years.some((y) => y != null) || Array.isArray(fs.birthYears)) fs.birthYears = years;
    return { before };
}

/** Put `fiSettings` back as it was (Undo). */
export function restoreAssumptions(data, before) {
    data.fiSettings = structuredClone(before);
}

// ---------- the scenarios list ----------

/** Pinned first, archived out (kept in `archived`), then as the store ordered them. */
export function scenarioList(rows, onChartIds = []) {
    const list = Array.isArray(rows) ? rows : [];
    const on = new Set(onChartIds);
    const live = list.filter((s) => !s.archived).sort((a, b) => (b.pinned === true) - (a.pinned === true));
    const archived = list.filter((s) => s.archived);
    return {
        live: live.map((s) => ({ id: s.id, name: s.name, pinned: s.pinned === true, changes: (s.changes || []).length, updatedAt: s.updatedAt, onChart: on.has(s.id) })),
        archived: archived.map((s) => ({ id: s.id, name: s.name, pinned: false, changes: (s.changes || []).length, updatedAt: s.updatedAt, onChart: false })),
    };
}

/** The ids that may be drawn: still saved, not archived, at most three, in the order given. */
export function chartIds(rows, wanted) {
    const ok = new Set((Array.isArray(rows) ? rows : []).filter((s) => !s.archived).map((s) => s.id));
    return [...new Set(Array.isArray(wanted) ? wanted : [])].filter((id) => ok.has(id)).slice(0, MAX_ON_CHART);
}

// ---------- cards ----------

/** One card a debt: name, balance, rate, yearly interest, good or bad chip (F2's `label`), the rate band. */
export function debtsModel(data, totals) {
    const libs = Array.isArray(data.liabilities) ? data.liabilities : [];
    const rows = libs.map((l, index) => {
        const balance = num(l.balance);
        const rate = num(l.interestRate);
        return {
            index, name: l.name || '', balance, rate, yearlyInterest: balance * (rate / 100), monthlyInterest: (balance * (rate / 100)) / 12,
            label: DEBT_LABELS.includes(l.label) ? l.label : null, labelSuggested: !!l.labelSuggested, band: rateBand(rate),
        };
    });
    const totalLiabilities = totals ? totals.currentLiabilities : rows.reduce((s, r) => s + r.balance, 0);
    const annualInterest = rows.reduce((s, r) => s + r.yearlyInterest, 0);
    return {
        rows, totalLiabilities, annualInterest,
        averageRate: totalLiabilities > 0 ? (annualInterest / totalLiabilities) * 100 : 0,
        netWorthDebtFree: totals ? totals.currentAssets : num(data.assets && data.assets.reduce((s, a) => s + num(a.balance), 0)),
    };
}

/** The HELP payoff card: null when no balance is set. Same logic as the old Savings-tab card, over `projectHelpPayoff`. */
export function helpPayoffModel(data, now = new Date()) {
    const ts = data.taxSettings;
    const balance = ts ? num(ts.helpBalance) : 0;
    if (!(balance > 0)) return null;
    const fy = getTaxYear(ts.financialYear);
    const primary = (data.incomeSources || [])[data.primaryIncomeIndex || 0];
    const income = primary ? (primary._calculatedGrossAnnual != null ? primary._calculatedGrossAnnual : num(primary.grossAnnual)) : 0;
    const annualRepayment = calculateHelpRepayment(income, fy.help);
    const base = { balance, income, annualRepayment, indexationPct: fy.help.indexationPercentDefault, threshold: fy.help.minThreshold };
    if (annualRepayment <= 0) return { ...base, kind: 'none' };
    const proj = projectHelpPayoff(balance, income, { help: fy.help });
    if (!Number.isFinite(proj.years)) return { ...base, kind: 'never' };
    return { ...base, kind: 'years', years: proj.years, debtFreeYear: now.getFullYear() + proj.years, totalIndexation: proj.totalIndexation, perFortnight: annualRepayment / 26 };
}

/** The tax-provision card: null with no variable income. `pot` is the allocation row flagged as the tax pot. */
export function taxProvisionModel(data, now = new Date()) {
    if (!hasVariableSources(data)) return null;
    const prov = estimateVariableTaxProvision(data, now);
    const pot = (data.allocation || []).find((a) => a && a.isTaxProvision) || null;
    if (!prov) return { kind: 'noEstimate' };
    const fy = AU_TAX_YEARS[prov.fyKey] ? AU_TAX_YEARS[prov.fyKey].label : prov.fyKey;
    return {
        kind: pot ? 'pot' : 'noPot', fy, prov, pot: pot ? { name: pot.name || '', balance: num(pot.currentBalance) } : null,
        covered: prov.ytdWithheld >= prov.provisionToDate,
    };
}

/** Assets that lose value, with their balances, and the HELP balance counted as a debt (FT-R-90, FT-R-91). */
export function loseValueModel(data, summary) {
    const assets = (Array.isArray(data.assets) ? data.assets : []).filter((a) => a && a.kind === 'depreciating' && num(a.balance) > 0)
        .map((a) => ({ name: a.name || '', balance: num(a.balance) }));
    const total = assets.reduce((s, a) => s + a.balance, 0);
    const help = summary.now.help;
    return assets.length || help > 0 ? { assets, total, help } : null;
}

/** The goal timeline from F4: dated Smile goals in due-date order, each with its own cost, state and dot position. */
export function goalsModel(data, today) {
    let plan;
    try { plan = planGoalsFromData(data, { today }); } catch (err) { console.warn('goal plan failed', err); return null; }
    const names = new Map((data.bucketGoals || []).map((g) => [String(g.id), g]));
    let prev = 0;
    const rows = plan.perGoal.map((g) => {
        const cost = g.cumulativeCostCents - prev;
        prev = g.cumulativeCostCents;
        const lands = !g.impossible && g.needCents > 0 ? plan.smilePerPayCents * g.pays >= g.needCents : null;
        const state = g.impossible ? 'impossible' : g.needCents === 0 ? 'covered' : lands ? 'onTime' : 'short';
        return { id: g.id, name: g.name || (names.get(String(g.id)) || {}).name || '', due: g.due, costCents: cost, state, perPayCents: g.perPayCents };
    });
    if (!rows.length) return { rows: [], undated: plan.undated.length, totalCents: 0, smileFundsCents: plan.fundsCountedCents, smilePerPayCents: plan.smilePerPayCents, positions: [] };
    const toMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    const start = toMs(today);
    const end = Math.max(...rows.map((r) => toMs(r.due)), start + 86400000);
    const positions = rows.map((r) => Math.max(0, Math.min(100, Math.round(((toMs(r.due) - start) / (end - start)) * 1000) / 10)));
    return {
        rows, positions, undated: plan.undated.length, totalCents: rows.reduce((s, r) => s + r.costCents, 0),
        smileFundsCents: plan.fundsCountedCents, smilePerPayCents: plan.smilePerPayCents, start: today, end: rows.reduce((m, r) => (r.due > m ? r.due : m), today),
    };
}

// ---------- the whole screen ----------

/**
 * @param {object} data financeData
 * @param {{today:string, horizon?:number, scenarios?:Array, onChart?:string[], totals?:object, now?:Date}} opts
 *   `scenarios` are the saved rows (F1's store); only the ones whose id is in `onChart` (three at most) are computed.
 */
export function futureModel(data, opts = {}) {
    const today = opts.today;
    const horizon = HORIZONS.includes(opts.horizon) ? opts.horizon : DEFAULT_HORIZON;
    const view = withPeople(data);
    const summary = fiSummary(view, { today });
    const totals = opts.totals || calculateTotals(data);
    const path = summary.path;
    const at = (y) => (path[Math.min(y, path.length - 1)] || path[path.length - 1]).fiNetWorth;
    const scenarios = Array.isArray(opts.scenarios) ? opts.scenarios : [];
    const ids = chartIds(scenarios, opts.onChart);
    const drawn = ids.map((id) => {
        const sc = scenarios.find((s) => s.id === id);
        const p = projectNetWorth(view, { today, years: 30, changes: sc.changes || [] });
        return { id, name: sc.name, values: p.path.slice(0, horizon + 1).map((r) => r.fiNetWorth), yearsToFI: p.yearsToFI, headline: scenarioHeadline({ fiYears: { now: summary.yearsToFI, scenario: p.yearsToFI } }) };
    });
    const nowValues = path.slice(0, horizon + 1).map((r) => r.fiNetWorth);
    const geometry = chartGeometry({
        series: [{ id: 'now', kind: 'now', values: nowValues }, ...drawn.map((d) => ({ id: d.id, kind: 'scen', values: d.values }))],
        fiNumber: summary.fiNumber, yearsToFI: summary.yearsToFI, years: horizon,
    });
    return {
        today, horizon, summary, geometry, drawn,
        figures: { now: at(0), in10: at(10), in20: at(20), in30: at(30), fiNumber: summary.fiNumber },
        list: scenarioList(scenarios, ids),
        debts: debtsModel(data, totals),
        help: helpPayoffModel(data, opts.now),
        tax: taxProvisionModel(data, opts.now),
        lose: loseValueModel(data, summary),
        goals: goalsModel(data, today),
        slots: peopleSlots(data),
    };
}
