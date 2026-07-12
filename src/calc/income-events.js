// Variable-income event maths — the calc engine behind the "variable" income
// type (gig workers, freelancers, shift/hospo workers, dancers).
//
// Pure functions (no store/DOM) — tests.html imports this module directly.
//
// Event shape (incomeSources[].incomeEvents[], all money in PLAIN DOLLARS —
// never cents; the cents convention belongs to the IndexedDB transaction store):
//   {
//     id:           string (crypto.randomUUID)
//     date:         'YYYY-MM-DD'
//     label:        string — client/venue/gig name ("client" in the statement export)
//     netAmount:    dollars banked for the event (GST-inclusive when gstInclusive)
//     taxWithheld:  dollars | null — tax already withheld/put aside for this event
//     hours:        number | null — hours worked (enables hourly-rate views)
//     gstInclusive: boolean — netAmount includes 10% GST collected for the ATO
//     penaltyRates: boolean — pay included penalty loadings (display only; the
//                   app never computes award entitlements)
//     cashReceived: dollars | null — cash tips / cash-in-hand on top of netAmount
//   }
//
// Aggregation semantics:
//   bank  = ex-GST share of netAmount (netAmount / 1.1 when gstInclusive)
//   gst   = netAmount − bank (0 unless gstInclusive)
//   net   = bank + cashReceived      ← what flows into "net annual income"
//   tax   = taxWithheld              ← what flows into "annual tax"
//   gross = net + tax                ← mirrors the self-employed back-calc
// Cash-only events (netAmount 0, cashReceived > 0) therefore count in full.

import { calculateTaxFromBrackets } from './calculations.js';
import { getTaxYear, calculateMedicareLevy, calculateHelpRepayment } from './tax-au.js';

export const GST_RATE = 0.10;

const num = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
};

// ---------- Australian financial year (fixed 1 July – 30 June) ----------

/** FY key ('2026-27') for a Date or ISO date string. */
export function fyKeyForDate(date) {
    const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
    const startYear = d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Inclusive ISO date range for an FY key ('2026-27' → 2026-07-01 … 2027-06-30). */
export function fyRange(fyKey) {
    const startYear = parseInt(String(fyKey).slice(0, 4), 10);
    if (isNaN(startYear)) return fyRange(fyKeyForDate(new Date()));
    return { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` };
}

/** The FY to aggregate against: the user's active key, else today's FY. */
export function activeFyKey(taxSettings, now = new Date()) {
    const key = taxSettings && taxSettings.financialYear;
    return (key && /^\d{4}-\d{2}$/.test(key)) ? key : fyKeyForDate(now);
}

/** The four AU FY quarters (BAS quarters) for an FY key. */
export function fyQuarters(fyKey) {
    const y = parseInt(String(fyKey).slice(0, 4), 10);
    return [
        { key: 'Q1', label: 'Jul–Sep', from: `${y}-07-01`, to: `${y}-09-30` },
        { key: 'Q2', label: 'Oct–Dec', from: `${y}-10-01`, to: `${y}-12-31` },
        { key: 'Q3', label: 'Jan–Mar', from: `${y + 1}-01-01`, to: `${y + 1}-03-31` },
        { key: 'Q4', label: 'Apr–Jun', from: `${y + 1}-04-01`, to: `${y + 1}-06-30` },
    ];
}

// ---------- per-event / event-list aggregation ----------

/** Derived money figures for one event (see semantics at the top of the file). */
export function eventFigures(event) {
    const banked = num(event.netAmount);
    const bank = event.gstInclusive ? banked / (1 + GST_RATE) : banked;
    const gst = banked - bank;
    const cash = num(event.cashReceived);
    const tax = num(event.taxWithheld);
    const net = bank + cash;
    return {
        bank, gst, cash, tax, net,
        gross: net + tax,
        hours: num(event.hours),
    };
}

/**
 * Sum a list of events, optionally within an inclusive ISO date range.
 * @returns {{net, gross, tax, gst, bank, cash, hours, count}}
 */
export function sumEvents(events, from, to) {
    const totals = { net: 0, gross: 0, tax: 0, gst: 0, bank: 0, cash: 0, hours: 0, count: 0 };
    for (const e of events || []) {
        if (!e || !e.date) continue;
        if (from && e.date < from) continue;
        if (to && e.date > to) continue;
        const f = eventFigures(e);
        totals.net += f.net;
        totals.gross += f.gross;
        totals.tax += f.tax;
        totals.gst += f.gst;
        totals.bank += f.bank;
        totals.cash += f.cash;
        totals.hours += f.hours;
        totals.count++;
    }
    return totals;
}

/**
 * Annual figures for one variable source: the sum of its events in the FY.
 * This is what calculateTotals feeds into the shared gross/net/tax totals, so
 * downstream tabs (Dashboard, Savings, What If) see a variable source exactly
 * like any other.
 */
export function variableSourceAnnualFigures(source, fyKey) {
    const { from, to } = fyRange(fyKey);
    const t = sumEvents(source && source.incomeEvents, from, to);
    return { grossAnnual: t.gross, netAnnual: t.net, annualTax: t.tax, gst: t.gst, count: t.count };
}

export function isVariableSource(source) {
    return !!source && source.incomeType === 'variable';
}

export function hasVariableSources(data) {
    return !!data && Array.isArray(data.incomeSources) && data.incomeSources.some(isVariableSource);
}

// ---------- monthly series (volatility chart) ----------

export function monthKey(isoDate) {
    return String(isoDate).slice(0, 7); // 'YYYY-MM'
}

export function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

/** The last `count` month keys ending at `now`'s month, oldest first. */
export function lastMonthKeys(count, now = new Date()) {
    const keys = [];
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
}

/**
 * Blended monthly net-income series for the volatility chart.
 * Variable sources contribute their events' net per month; regular sources
 * contribute a pro-rata 1/12 of their calculated (or estimated) net annual.
 * Call AFTER calculateTotals so _calculatedNetAnnual is fresh.
 * @returns {Array<{key, label, variable, regular, total}>} oldest first.
 */
export function monthlyNetSeries(data, count = 12, now = new Date()) {
    const keys = lastMonthKeys(count, now);
    const byMonth = new Map(keys.map(k => [k, { variable: 0, regular: 0 }]));

    let regularMonthly = 0;
    for (const source of (data.incomeSources || [])) {
        if (isVariableSource(source)) {
            for (const e of (source.incomeEvents || [])) {
                if (!e || !e.date) continue;
                const slot = byMonth.get(monthKey(e.date));
                if (slot) slot.variable += eventFigures(e).net;
            }
        } else {
            const netAnnual = source._calculatedNetAnnual != null
                ? source._calculatedNetAnnual : num(source.grossAnnual);
            regularMonthly += netAnnual / 12;
        }
    }
    return keys.map(key => {
        const slot = byMonth.get(key);
        return {
            key,
            label: monthLabel(key),
            variable: slot.variable,
            regular: regularMonthly,
            total: slot.variable + regularMonthly,
        };
    });
}

/** Quarterly (BAS-aligned) summary of all variable sources' events in an FY. */
export function quarterlySummary(data, fyKey) {
    const events = [];
    for (const source of (data.incomeSources || [])) {
        if (isVariableSource(source)) events.push(...(source.incomeEvents || []));
    }
    return fyQuarters(fyKey).map(q => ({ ...q, ...sumEvents(events, q.from, q.to) }));
}

// ---------- annualised projection + tax provisioning ----------

/** Fraction of the FY elapsed as of `now` (floored at one day, capped at 1). */
export function fyElapsedFraction(fyKey, now = new Date()) {
    const { from, to } = fyRange(fyKey);
    const start = new Date(from + 'T00:00:00').getTime();
    const end = new Date(to + 'T23:59:59').getTime();
    const t = Math.min(now.getTime(), end);
    const dayMs = 24 * 3600 * 1000;
    return Math.min(1, Math.max(dayMs, t - start) / (end - start));
}

/**
 * Estimated annual tax on a gross figure using the app's bracket table plus the
 * optional Medicare/HELP components from taxSettings — the same recipe as
 * calculateTotals' salaried estimate path.
 */
export function estimateAnnualTax(gross, brackets, taxSettings, { includeHelp = false } = {}) {
    let tax = calculateTaxFromBrackets(gross, brackets);
    if (taxSettings) {
        const fy = getTaxYear(taxSettings.financialYear);
        if (taxSettings.includeMedicareLevy) tax += calculateMedicareLevy(gross, fy.medicare);
        if (includeHelp && taxSettings.includeHelpInEstimate !== false
            && (num(taxSettings.helpBalance) > 0)) {
            tax += calculateHelpRepayment(gross, fy.help);
        }
    }
    return tax;
}

/**
 * Running tax-provision estimate for the variable income in `data`, on an
 * annualised-projection basis:
 *   1. FY-to-date variable gross is extrapolated to a full-year pace.
 *   2. Full-year tax is the MARGINAL tax the variable income adds on top of the
 *      regular sources' annual gross (progressive brackets stack income, so
 *      taxing the variable slice at its own bracket would understate it).
 *   3. "Should have set aside by today" = full-year tax × FY fraction elapsed,
 *      less what's already been withheld on the events.
 * Returns null when there are no variable events this FY.
 */
export function estimateVariableTaxProvision(data, now = new Date()) {
    const taxSettings = data.taxSettings || null;
    const fyKey = activeFyKey(taxSettings, now);
    const { from, to } = fyRange(fyKey);

    let regularAnnualGross = 0;
    let variableIsPrimary = false;
    const events = [];
    (data.incomeSources || []).forEach((source, i) => {
        if (isVariableSource(source)) {
            events.push(...(source.incomeEvents || []));
            if (i === (data.primaryIncomeIndex || 0)) variableIsPrimary = true;
        } else {
            regularAnnualGross += source._calculatedGrossAnnual != null
                ? source._calculatedGrossAnnual : num(source.grossAnnual);
        }
    });

    const ytd = sumEvents(events, from, to);
    if (ytd.count === 0) return null;

    const elapsed = fyElapsedFraction(fyKey, now);
    const projectedAnnualGross = ytd.gross / elapsed;
    // HELP repayments attach to the person, and the app models that as the
    // primary source — include them only when a variable source is primary.
    const opts = { includeHelp: variableIsPrimary };
    const taxOnAll = estimateAnnualTax(regularAnnualGross + projectedAnnualGross, data.taxBrackets, taxSettings, opts);
    const taxOnRegular = estimateAnnualTax(regularAnnualGross, data.taxBrackets, taxSettings, opts);
    const projectedAnnualTax = Math.max(0, taxOnAll - taxOnRegular);
    const provisionToDate = projectedAnnualTax * elapsed;

    return {
        fyKey,
        elapsed,
        ytdGross: ytd.gross,
        ytdNet: ytd.net,
        ytdWithheld: ytd.tax,
        ytdGst: ytd.gst,
        projectedAnnualGross,
        projectedAnnualTax,
        provisionToDate,
        stillToSetAside: Math.max(0, provisionToDate - ytd.tax),
    };
}

// ---------- per-label (client/venue) summary ----------

/**
 * Per-label rollup for the Income tab card and the statement export.
 * `baseHourlyRate` (optional, from the source) enables the base-vs-penalty
 * split: for penalty-flagged hours the base share is rate × hours and the
 * remainder is attributed to penalty loadings. Display only — no award maths.
 * @returns Array sorted by net desc: {label, net, bank, cash, tax, gst, hours,
 *          count, effectiveRate, penaltyCount, penaltyHours, penaltyNet,
 *          basePortion, penaltyPortion}
 */
export function labelSummary(events, baseHourlyRate = null) {
    const map = new Map();
    for (const e of events || []) {
        if (!e || !e.date) continue;
        const label = (e.label || '').trim() || 'Unlabelled';
        if (!map.has(label)) {
            map.set(label, {
                label, net: 0, bank: 0, cash: 0, tax: 0, gst: 0, hours: 0, count: 0,
                penaltyCount: 0, penaltyHours: 0, penaltyNet: 0,
            });
        }
        const row = map.get(label);
        const f = eventFigures(e);
        row.net += f.net; row.bank += f.bank; row.cash += f.cash;
        row.tax += f.tax; row.gst += f.gst; row.hours += f.hours; row.count++;
        if (e.penaltyRates) {
            row.penaltyCount++;
            row.penaltyHours += f.hours;
            row.penaltyNet += f.net;
        }
    }
    const base = num(baseHourlyRate);
    const rows = [...map.values()];
    for (const row of rows) {
        row.effectiveRate = row.hours > 0 ? row.net / row.hours : null;
        if (base > 0 && row.penaltyHours > 0) {
            row.basePortion = Math.min(row.penaltyNet, base * row.penaltyHours);
            row.penaltyPortion = Math.max(0, row.penaltyNet - row.basePortion);
        } else {
            row.basePortion = null;
            row.penaltyPortion = null;
        }
    }
    return rows.sort((a, b) => b.net - a.net);
}

// ---------- coaster calculator + slow-season detection ----------

/**
 * Average monthly outgoing spend (dollars) over the last `months` full-or-part
 * calendar months, from transaction rows ({date, amountCents}, negative = out).
 * Returns 0 when there's no outgoing spend in the window.
 */
export function averageMonthlyExpenses(transactions, now = new Date(), months = 3) {
    const startWindow = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const from = `${startWindow.getFullYear()}-${String(startWindow.getMonth() + 1).padStart(2, '0')}-01`;
    let outCents = 0;
    for (const r of transactions || []) {
        if (!r || !r.date || r.date < from) continue;
        if (r.amountCents < 0) outCents += -r.amountCents;
    }
    return (outCents / 100) / months;
}

/** Months the assets could cover at that spend rate; null when spend is 0. */
export function coasterMonths(totalAssets, avgMonthlyExpenses) {
    if (!(avgMonthlyExpenses > 0)) return null;
    return Math.max(0, totalAssets) / avgMonthlyExpenses;
}

/**
 * Seasonal-dip scan over variable income events. Needs data spanning more than
 * 12 months (first event to last event); otherwise returns {enoughData: false}.
 * A calendar month is "slow" when its average net across the years on record
 * is under 70% of the overall monthly average.
 * @returns {{enoughData: boolean, slowMonths: Array<{month, name, average}>, overallAverage: number}}
 */
export function detectSlowSeasons(data, now = new Date()) {
    const events = [];
    for (const source of (data.incomeSources || [])) {
        if (isVariableSource(source)) events.push(...(source.incomeEvents || []));
    }
    const dated = events.filter(e => e && e.date).sort((a, b) => a.date.localeCompare(b.date));
    if (dated.length === 0) return { enoughData: false, slowMonths: [], overallAverage: 0 };

    const first = new Date(dated[0].date + 'T00:00:00');
    const last = new Date(dated[dated.length - 1].date + 'T00:00:00');
    const spanMonths = (last.getFullYear() - first.getFullYear()) * 12 + (last.getMonth() - first.getMonth());
    if (spanMonths < 12) return { enoughData: false, slowMonths: [], overallAverage: 0 };

    // Net per calendar-month occurrence ('YYYY-MM'), then average per month-of-year.
    const perOccurrence = new Map();
    for (const e of dated) {
        const key = monthKey(e.date);
        perOccurrence.set(key, (perOccurrence.get(key) || 0) + eventFigures(e).net);
    }
    const byMonthOfYear = new Map(); // 1–12 → {sum, n}
    let overallSum = 0;
    for (const [key, net] of perOccurrence) {
        const m = parseInt(key.slice(5, 7), 10);
        const slot = byMonthOfYear.get(m) || { sum: 0, n: 0 };
        slot.sum += net; slot.n++;
        byMonthOfYear.set(m, slot);
        overallSum += net;
    }
    const overallAverage = overallSum / perOccurrence.size;
    const slowMonths = [];
    for (const [m, slot] of [...byMonthOfYear.entries()].sort((a, b) => a[0] - b[0])) {
        const avg = slot.sum / slot.n;
        if (avg < overallAverage * 0.7) {
            slowMonths.push({
                month: m,
                name: new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: 'long' }),
                average: avg,
            });
        }
    }
    return { enoughData: true, slowMonths, overallAverage };
}

// ---------- event factory ----------

export function makeIncomeEvent(overrides = {}) {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        date: iso,
        label: '',
        netAmount: 0,
        taxWithheld: null,
        hours: null,
        gstInclusive: false,
        penaltyRates: false,
        cashReceived: null,
        ...overrides,
    };
}
