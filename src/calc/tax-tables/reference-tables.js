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


// ---------- range checks (DB14 review) ----------
// Run for every year on every figure present, by the app (a failing year is held) and by `npm run ref:check`
// (a failing file cannot ship). Returns [{ figure: 'group.name' or 'year', problem }].
const rate01 = (x) => num(x) && x >= 0 && x <= 1;
const inYear = (fy, d) => { const m = FY.exec(fy); return typeof d === 'string' && ISO.test(d) && d >= `${m[1]}-07-01` && d <= `${+m[1] + 1}-06-30`; };
const sixCol = (r) => Array.isArray(r) && r.length === 3;

export function taxRangeProblems(fy, year) {
    const out = [];
    const add = (figure, problem) => out.push({ figure, problem });
    const ym = FY.exec(typeof fy === 'string' ? fy : '');
    if (!ym || !year || typeof year !== 'object') { add('year', 'not a year of figures'); return out; }
    const start = +ym[1];
    if (+ym[2] !== (start + 1) % 100) add('year', 'the key is not two consecutive years');
    const g = (x, n) => (Object.hasOwn(year, x) && year[x] && typeof year[x] === 'object' && Object.hasOwn(year[x], n) && year[x][n] && typeof year[x][n] === 'object' ? year[x][n] : null);
    for (const [gn, figs] of Object.entries(year)) {
        for (const [n, f] of Object.entries(figs && typeof figs === 'object' ? figs : {})) {
            if (f && typeof f === 'object') {
                if (f.fy !== undefined && f.fy !== fy) add(`${gn}.${n}`, `fy ${f.fy} is not ${fy}`);
                if (f.appliesFrom !== undefined && !inYear(fy, f.appliesFrom)) add(`${gn}.${n}`, `appliesFrom ${f.appliesFrom} is outside ${fy}`);
            }
        }
    }
    const val = (x, n) => { const f = g(x, n); return f ? f.value : null; };
    const asc = (rows, i) => rows.every((r, k) => k === 0 || r[i] > rows[k - 1][i]);
    // [from, to, rate] tables (income tax)
    for (const n of ['resident', 'foreignResident', 'workingHolidayMaker']) {
        const v = val('incomeTax', n);
        if (v === null) continue;
        const at = `incomeTax.${n}`;
        if (!Array.isArray(v) || !v.length || !v.every((r) => sixCol(r) && num(r[0]) && (r[1] === null || num(r[1])) && num(r[2]))) { add(at, 'rows are not [from, to, rate]'); continue; }
        if (!v.every((r) => rate01(r[2]))) add(at, 'a rate is outside 0 to 1');
        if (!v.every((r) => r[0] >= 0 && (r[1] === null || r[1] > r[0]))) add(at, 'a band is empty or negative');
        if (!v.every((r, i) => i === 0 || v[i - 1][1] === r[0])) add(at, 'bands do not meet end to end');
        if (v[0][0] !== 0 || v[v.length - 1][1] !== null) add(at, 'must start at 0 and end open');
    }
    for (const n of ['singleTiers', 'familyTiers']) {
        const v = val('mls', n);
        if (v === null) continue;
        if (!Array.isArray(v) || !v.every((r) => sixCol(r) && num(r[0]) && (r[1] === null || num(r[1])) && rate01(r[2]))) add(`mls.${n}`, 'rows are not [from, to, rate] with a rate 0 to 1');
        else if (!asc(v, 0)) add(`mls.${n}`, 'tiers are not in order');
    }
    for (const n of ['sgRate', 'div293Rate']) { const v = val('super', n); if (v !== null && !rate01(v)) add(`super.${n}`, 'a rate is outside 0 to 1'); }
    // Medicare
    for (const n of ['levyRate', 'phaseInRate']) { const v = val('medicare', n); if (v !== null && !rate01(v)) add(`medicare.${n}`, 'a rate is outside 0 to 1'); }
    const mv = {};
    for (const n of ['singleLowerThreshold', 'singleUpperThreshold', 'singleSeniorLowerThreshold', 'singleSeniorUpperThreshold', 'familyLowerThreshold', 'familyLowerThresholdSenior', 'familyUpperThreshold', 'familyUpperThresholdSenior', 'perChildLower', 'perChildUpper']) {
        const v = val('medicare', n);
        if (v === null) continue;
        if (!num(v) || v < 0) add(`medicare.${n}`, 'a threshold must be 0 or more'); else mv[n] = v;
    }
    for (const [a, b] of [['singleLowerThreshold', 'singleUpperThreshold'], ['singleSeniorLowerThreshold', 'singleSeniorUpperThreshold'], ['familyLowerThreshold', 'familyUpperThreshold'], ['familyLowerThresholdSenior', 'familyUpperThresholdSenior'], ['perChildLower', 'perChildUpper']]) {
        if (a in mv && b in mv && mv[a] >= mv[b]) add(`medicare.${a}`, `must be below ${b}`);
    }
    // HELP: four rows, the bands meet end to end, and the separate threshold figures agree with them
    const hb = val('help', 'bands');
    if (hb !== null) {
        const okRows = Array.isArray(hb) && hb.length === 4 && hb.every((r) => sixCol(r) && num(r[0]) && (r[1] === null || num(r[1])) && (num(r[2]) || typeof r[2] === 'string'));
        if (!okRows) add('help.bands', 'expected four [from, to, rate] rows');
        else {
            if (![hb[0][2], hb[1][2], hb[2][2], hb[3][2]].every(rate01)) add('help.bands', 'a rate is outside 0 to 1');
            if (hb[0][0] !== 0 || hb[0][1] !== hb[1][0] || hb[1][1] !== hb[2][0]) add('help.bands', 'bands do not meet end to end');
            if (hb[2][1] === null || ![0, 1].includes(hb[3][0] - hb[2][1])) add('help.bands', 'the top band does not meet the capped band');
            if (!(hb[1][0] < hb[1][1] && hb[1][1] < hb[3][0])) add('help.bands', 'thresholds are not in order');
            if (hb[3][1] !== null) add('help.bands', 'the last band must be open');
            for (const [n, want] of [['minimumRepaymentIncome', hb[1][0]], ['secondThreshold', hb[2][0]], ['capStart', hb[3][0]]]) {
                const v = val('help', n);
                if (v !== null && v !== want) add(`help.${n}`, `${v} does not match the bands (${want})`);
            }
        }
    }
    for (const n of ['indexation', 'indexationProjection']) { const v = val('help', n); if (v !== null && !(num(v) && v >= 0 && v <= 0.2)) add(`help.${n}`, 'indexation must be 0 to 0.2'); }
    // PAYG scales: [x less than, a, b]
    for (const n of ['scale1_noTFT', 'scale2_TFT', 'scale3_foreign', 'stsl_TFT', 'stsl_noTFT']) {
        const v = val('payg', n);
        if (v === null) continue;
        const at = `payg.${n}`;
        if (!Array.isArray(v) || !v.length || !v.every((r) => sixCol(r) && (r[0] === null || num(r[0])) && num(r[1]) && num(r[2]))) { add(at, 'rows are not [x, a, b]'); continue; }
        if (!v.every((r) => rate01(r[1]))) add(at, 'a coefficient a is outside 0 to 1');
        if (!v.every((r) => Math.abs(r[2]) <= 1000)) add(at, 'a coefficient b is not a sane amount');
        if (!v.every((r, i) => (r[0] === null) === (i === v.length - 1))) add(at, 'only the last row may be open');
        else if (!v.slice(0, -1).every((r, i, a) => r[0] >= 0 && (i === 0 || r[0] > a[i - 1][0]))) add(at, 'rows are not in order');
    }
    const l = val('incomeTax', 'lito');
    if (l !== null) {
        const keys = ['max', 'fullUntil', 'rate1', 'step1Until', 'base2', 'rate2', 'endsAt'];
        if (!l || typeof l !== 'object' || !keys.every((k) => num(l[k]) && l[k] >= 0)) add('incomeTax.lito', 'every value must be a number, 0 or more');
        else {
            if (!rate01(l.rate1) || !rate01(l.rate2)) add('incomeTax.lito', 'a rate is outside 0 to 1');
            if (!(l.fullUntil <= l.step1Until && l.step1Until <= l.endsAt)) add('incomeTax.lito', 'thresholds are not in order');
            if (l.base2 > l.max) add('incomeTax.lito', 'base2 is above the maximum offset');
        }
    }
    return out;
}

/** Range problems across a whole tax file's years, one line each, for the build. */
export function taxFileProblems(taxDoc) {
    const out = [];
    const years = taxDoc && taxDoc.years && typeof taxDoc.years === 'object' ? taxDoc.years : {};
    for (const [fy, year] of Object.entries(years)) for (const p of taxRangeProblems(fy, year)) out.push(`tax.json: ${fy} ${p.figure}: ${p.problem}`);
    return out;
}

const malformed = () => ({ held: { reason: 'malformed', figures: [], statuses: [] } });

/**
 * Build one year's table from a year's figure groups.
 * @param {string} fy '2026-27'
 * @param {object} year the year's { group: { name: figure } } object from tax.json
 * @returns {{table:object}|{held:{reason:'incomplete'|'not-legislated'|'out-of-range'|'malformed', figures:string[], statuses:string[]}}}
 */
export function buildYearTable(fy, year) {
    const m = FY.exec(fy);
    if (!m || !year || typeof year !== 'object') return malformed();
    const fig = (g, n) => (Object.hasOwn(year, g) && year[g] && Object.hasOwn(year[g], n) && year[g][n] && typeof year[g][n] === 'object' ? year[g][n] : null);
    const missing = REQUIRED.filter(([g, n]) => { const f = fig(g, n); return !f || f.value === null || f.value === undefined; }).map(([g, n]) => `${g}.${n}`);
    // HELP indexation: the app keeps a projection default (a person-adjustable guess, not a published rate). A year
    // A legislated help.indexation is preferred; otherwise help.indexationProjection is used.
    const proj = fig('help', 'indexationProjection');
    const idx = fig('help', 'indexation');
    const idxFig = idx && num(idx.value) && idx.status === 'legislated' ? idx : (proj && num(proj.value) ? proj : null);
    if (!idxFig) missing.push('help.indexation');
    if (missing.length) return { held: { reason: 'incomplete', figures: missing, statuses: [] } };
    const notLaw = REQUIRED.filter(([g, n]) => fig(g, n).status !== 'legislated');
    if (notLaw.length) return { held: { reason: 'not-legislated', figures: notLaw.map(([g, n]) => `${g}.${n}`), statuses: [...new Set(notLaw.map(([g, n]) => fig(g, n).status))] } };

    const rp = taxRangeProblems(fy, year);
    if (rp.length) return { held: { reason: 'out-of-range', figures: rp.map((p) => `${p.figure}: ${p.problem}`), statuses: [] } };
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
