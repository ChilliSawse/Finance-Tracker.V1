// FT-R-124 (FT-0032 DB14): turns the shared reference database's tax figures into the same table shape the built-in
// files (au-YYYY-YY.js) use. Pure data and functions, no DOM, no storage. Lazy: imported only by
// src/state/reference-tax.js, never by the core chunk.
//
// The rule (FT-R-117, "suggested stays suggested"): a year's table is built only when EVERY figure it needs is
// `legislated` (the HELP projection default is the one exception, see below). A year with an announced, estimate,
// derived or guidance figure, or with a missing one, is HELD: it is reported in `held` and never reaches the
// calculations, so a built-in legislated table is never silently replaced by something less certain.

const REQUIRED = [
    ['incomeTax', 'resident'], ['incomeTax', 'lito'],
    ['medicare', 'levyRate'], ['medicare', 'singleLowerThreshold'], ['medicare', 'singleUpperThreshold'], ['medicare', 'phaseInRate'],
    ['help', 'bands'],
    ['payg', 'instrument'], ['payg', 'scale1_noTFT'], ['payg', 'scale2_TFT'], ['payg', 'stsl_TFT'], ['payg', 'stsl_noTFT'],
];
const FY = /^(\d{4})-(\d{2})$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const lim = (v) => (v === null ? Infinity : v);

function rowsOf(value, width, check) {
    if (!Array.isArray(value) || !value.length) return null;
    const out = [];
    for (const r of value) {
        if (!Array.isArray(r) || r.length !== width) return null;
        const m = check(r);
        if (!m) return null;
        out.push(m);
    }
    return out;
}
const ascending = (rows, key) => rows.every((r, i) => i === 0 || r[key] > rows[i - 1][key]);

// [x less than, a, b] rows: ascending, last open (null becomes Infinity).
function scale(value) {
    const rows = rowsOf(value, 3, (r) => ((r[0] === null || num(r[0])) && num(r[1]) && num(r[2]) ? { lt: lim(r[0]), a: r[1], b: r[2] } : null));
    return rows && ascending(rows, 'lt') && rows[rows.length - 1].lt === Infinity ? rows : null;
}

// [from, to, rate] rows: start at 0, contiguous, last open.
function brackets(value) {
    const rows = rowsOf(value, 3, (r) => (num(r[0]) && (r[1] === null || num(r[1])) && num(r[2]) ? { min: r[0], max: lim(r[1]), rate: r[2] } : null));
    if (!rows || rows[0].min !== 0 || rows[rows.length - 1].max !== Infinity) return null;
    return rows.every((b, i) => b.max > b.min && (i === 0 || b.min === rows[i - 1].max)) ? rows : null;
}

const malformed = () => ({ held: { reason: 'malformed', figures: [], statuses: [] } });

/**
 * Build one year's table from a year's figure groups.
 * @param {string} fy '2026-27'
 * @param {object} year the year's { group: { name: figure } } object from tax.json
 * @returns {{table:object}|{held:{reason:'incomplete'|'not-legislated'|'malformed', figures:string[], statuses:string[]}}}
 */
export function buildYearTable(fy, year) {
    const m = FY.exec(fy);
    if (!m || !year || typeof year !== 'object') return malformed();
    const fig = (g, n) => (year[g] && year[g][n] && typeof year[g][n] === 'object' ? year[g][n] : null);
    const missing = REQUIRED.filter(([g, n]) => { const f = fig(g, n); return !f || f.value === null || f.value === undefined; }).map(([g, n]) => `${g}.${n}`);
    // HELP indexation: the app keeps a projection default (a person-adjustable guess, not a published rate). A year
    // carries it as help.indexationProjection, or its own legislated help.indexation is used.
    const proj = fig('help', 'indexationProjection');
    const idx = fig('help', 'indexation');
    const idxFig = proj && num(proj.value) ? proj : (idx && num(idx.value) && idx.status === 'legislated' ? idx : null);
    if (!idxFig) missing.push('help.indexation');
    if (missing.length) return { held: { reason: 'incomplete', figures: missing, statuses: [] } };
    const notLaw = REQUIRED.filter(([g, n]) => fig(g, n).status !== 'legislated');
    if (notLaw.length) return { held: { reason: 'not-legislated', figures: notLaw.map(([g, n]) => `${g}.${n}`), statuses: [...new Set(notLaw.map(([g, n]) => fig(g, n).status))] } };

    const v = (g, n) => fig(g, n).value;
    const br = brackets(v('incomeTax', 'resident'));
    const scale1 = scale(v('payg', 'scale1_noTFT'));
    const scale2 = scale(v('payg', 'scale2_TFT'));
    const tft = scale(v('payg', 'stsl_TFT'));
    const not = scale(v('payg', 'stsl_noTFT'));
    const rate = v('medicare', 'levyRate'); const lo = v('medicare', 'singleLowerThreshold');
    const up = v('medicare', 'singleUpperThreshold'); const taper = v('medicare', 'phaseInRate');
    const l = v('incomeTax', 'lito');
    const hb = v('help', 'bands');
    const from = fig('incomeTax', 'resident').appliesFrom;
    const sched = fig('payg', 'instrument').appliesFrom;
    if (!br || !scale1 || !scale2 || !tft || !not || ![rate, lo, up, taper].every(num) || lo >= up) return malformed();
    if (!l || typeof l !== 'object' || !['max', 'fullUntil', 'rate1', 'step1Until', 'base2', 'rate2', 'endsAt'].every((k) => num(l[k]))) return malformed();
    if (!Array.isArray(hb) || hb.length !== 4 || !hb.every((r) => Array.isArray(r) && r.length === 3) || !num(hb[1][0]) || !num(hb[1][1]) || !num(hb[1][2])
        || !num(hb[2][0]) || !num(hb[2][2]) || !num(hb[3][2]) || hb[2][0] <= hb[1][0]) return malformed();
    if (typeof from !== 'string' || !ISO.test(from) || typeof sched !== 'string' || !ISO.test(sched)) return malformed();

    const start = +m[1];
    const used = REQUIRED.map(([g, n]) => fig(g, n)).concat([idxFig]);
    const table = {
        fy,
        label: `${start}–${m[2]}`,
        effective: { from, to: `${start + 1}-06-30` },
        withholdingScheduleFrom: sched,
        sources: [...new Set(used.map((f) => f.source))],
        updated: used.map((f) => f.retrieved).filter((d) => typeof d === 'string').sort().pop(),
        scale2, scale1,
        stsl: { tftClaimed: tft, notClaimed: not },
        brackets: br,
        medicare: { rate, singleLowerThreshold: lo, singleUpperThreshold: up, taperRate: taper },
        help: {
            minThreshold: hb[1][0],
            bands: [{ min: hb[1][0], max: hb[1][1], rate: hb[1][2] }, { min: hb[2][0], max: Infinity, rate: hb[2][2] }],
            capRate: hb[3][2],
            indexationPercentDefault: Number((idxFig.value * 100).toFixed(6)),
        },
        lito: { maxOffset: l.max, fullUntil: l.fullUntil, rate1: l.rate1, step1Until: l.step1Until, base2: l.base2, rate2: l.rate2, endsAt: l.endsAt },
        origin: 'reference',
    };
    return { table };
}

/**
 * Every year in a tax file's `years`: the tables that may be used, and the years held back (and why).
 * @returns {{tables:Object<string,object>, held:Object<string,{reason:string, figures:string[], statuses:string[]}>}}
 */
export function tablesFromReference(years) {
    const tables = {}; const held = {};
    if (!years || typeof years !== 'object') return { tables, held };
    for (const fy of Object.keys(years)) {
        const r = buildYearTable(fy, years[fy]);
        if (r.table) tables[fy] = r.table; else held[fy] = r.held;
    }
    return { tables, held };
}
