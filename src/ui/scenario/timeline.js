// Goal landing timeline for the What If Answer (F8a, plan section 2.4 step 1, FT-R-89).
// Pure parts (no DOM): `placeLabels`, `landingDates`, `timelineModel`. DOM part: `renderTimeline`.
// Every text is set as text, never markup.
//
// `placeLabels` is the phone fix of the v2 build notes: two labels a few days apart on a narrow axis go in
// different rows, so they cannot sit on top of each other.

import { t } from '../../i18n/strings.js';
import { addDays } from '../../calc/pay-cycle.js';

export const DEFAULT_LABEL_PX = 52;
export const ROW_PX = 18;
export const DOT_PX = 24;
export const DOT_ROW_PX = 28;
const AXIS_PAD_PX = 14;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** '13 Dec' */
export function dayShort(iso) {
    return isIso(iso) ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}` : '';
}

/** 'Fri 29 May', with the year when it is not `today`'s year ('Fri 27 Nov 2027'). */
export function dayLong(iso, today) {
    if (!isIso(iso)) return '';
    const wd = DAYS[new Date(utc(iso)).getUTCDay()];
    const year = isIso(today) && iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : '';
    return `${wd} ${dayShort(iso)}${year}`;
}

/** Whole days from a to b (b later gives a positive number). */
export function daysApart(a, b) {
    return Math.round((utc(b) - utc(a)) / 86400000);
}

// ---------- label placement ----------

/**
 * Put labels on a horizontal axis without any two overlapping in one row.
 * points: [{id, at (0 to 1 along the axis), widthPx (optional, default DEFAULT_LABEL_PX)}].
 * Each label is centred on its point and kept inside the axis. A label goes in the first row where it clears the
 * previous one by `minGapPx`; otherwise it starts a new row. Returns the points in their original order with
 * `px` (centre), `left`, `right` and `row` added.
 * @returns {Array<object>}
 */
export function placeLabels(points, axisPx, minGapPx = 6) {
    const list = Array.isArray(points) ? points : [];
    const axis = Number.isFinite(axisPx) && axisPx > 0 ? axisPx : 330;
    const gap = Number.isFinite(minGapPx) && minGapPx >= 0 ? minGapPx : 0;
    const placed = list.map((p, i) => {
        const w = Number.isFinite(p && p.widthPx) && p.widthPx > 0 ? p.widthPx : DEFAULT_LABEL_PX;
        const at = Number.isFinite(p && p.at) ? Math.max(0, Math.min(1, p.at)) : 0;
        const half = w / 2;
        const centre = axis <= w ? axis / 2 : Math.max(half, Math.min(axis - half, at * axis));
        return { ...p, i, px: centre, left: centre - half, right: centre + half, row: 0 };
    });
    const order = placed.slice().sort((a, b) => a.px - b.px || a.i - b.i);
    const rowRight = [];
    for (const p of order) {
        let r = 0;
        while (r < rowRight.length && p.left < rowRight[r] + gap) r++;
        rowRight[r] = p.right;
        p.row = r;
    }
    return placed.map(({ i, ...rest }) => rest);
}

/** How many rows a placed set uses (0 when empty). */
export function rowCount(placed) {
    return placed.reduce((m, p) => Math.max(m, p.row + 1), 0);
}

// ---------- landing dates ----------

/**
 * When each goal lands if `perPayCents` goes into Smile every pay and `fundsCents` is already counted.
 * Goals are funded one after another in due-date order (cumulative cost), which is how the planner works.
 * state: 'covered' (already there), 'lands' (date set), 'beyond' (later than the last pay date given),
 * 'never' (nothing going in). `late` is true when it lands after the wanted-by date.
 * goals: [{id, name, costCents, due}]; payDates: sorted 'YYYY-MM-DD' pay dates after today.
 */
export function landingDates({ goals = [], fundsCents = 0, perPayCents = 0, payDates = [] } = {}) {
    const dated = (Array.isArray(goals) ? goals : []).filter((g) => g && isIso(g.due))
        .slice().sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const dates = Array.isArray(payDates) ? payDates : [];
    const funds = Math.max(0, Math.round(fundsCents) || 0);
    const per = Math.max(0, Math.round(perPayCents) || 0);
    let cum = 0;
    return dated.map((g) => {
        cum += Math.max(0, Math.round(g.costCents) || 0);
        const need = cum - funds;
        const row = { id: g.id, name: g.name || '', due: g.due, costCents: g.costCents, cumulativeCents: cum, state: 'covered', date: null, late: false };
        if (need <= 0) return row;
        if (per <= 0) return { ...row, state: 'never' };
        const k = Math.ceil(need / per);
        if (k > dates.length) return { ...row, state: 'beyond' };
        const date = dates[k - 1];
        return { ...row, state: 'lands', date, late: date > g.due };
    });
}

// ---------- the drawing model ----------

/**
 * Positions for the lanes. `now` and `plan` are landingDates() results for the same goals in the same order.
 * The axis runs from today to the last date shown (never less than 30 days).
 * @returns {{start:string,end:string,span:number,wanted:Array,lanes:{now:Array,plan:Array},frac:Function}}
 */
export function timelineModel({ today, now = [], plan = [] } = {}) {
    const dates = [];
    for (const r of [...now, ...plan]) {
        if (isIso(r.due)) dates.push(r.due);
        if (r.state === 'lands' && isIso(r.date)) dates.push(r.date);
    }
    const last = dates.reduce((m, d) => (d > m ? d : m), today);
    const end = daysApart(today, last) < 30 ? addDays(today, 30) : last;
    const span = Math.max(1, daysApart(today, end));
    const frac = (iso) => Math.max(0, Math.min(1, daysApart(today, iso) / span));
    const dot = (r, n) => {
        const at = r.state === 'covered' ? 0 : r.state === 'lands' ? frac(r.date) : 1;
        return { id: r.id, name: r.name, n: n + 1, state: r.state, date: r.date, due: r.due, late: r.late, at };
    };
    return {
        start: today, end, span, frac,
        wanted: now.map((r, n) => ({ id: r.id, n: n + 1, name: r.name, due: r.due, at: frac(r.due) })),
        lanes: { now: now.map(dot), plan: plan.map(dot) },
    };
}

/** The sentence a screen reader gets for the whole picture. */
export function timelineSummary(model, today) {
    const say = (r) => {
        if (r.state === 'covered') return t('f.wa.tl.covered', { name: r.name });
        if (r.state === 'lands') return t('f.wa.tl.lands', { name: r.name, date: dayLong(r.date, today) });
        if (r.state === 'beyond') return t('f.wa.tl.beyond', { name: r.name });
        return t('f.wa.tl.never', { name: r.name });
    };
    return [
        `${t('f.wa.tl.now')}: ${model.lanes.now.map(say).join(', ')}.`,
        `${t('f.wa.tl.plan')}: ${model.lanes.plan.map(say).join(', ')}.`,
        `${t('f.wa.tl.wanted')}: ${model.wanted.map((w) => `${w.name} ${dayLong(w.due, today)}`).join(', ')}.`,
    ].join(' ');
}

// ---------- DOM ----------

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

const labelWidth = (s) => Math.ceil(String(s).length * 6.6) + 10;

/**
 * Draw the lanes into `parent`. The caller passes the axis width in pixels (its container's width, minus
 * nothing); labels and dots are placed in pixels so `placeLabels` can keep them apart on a phone.
 */
export function renderTimeline(parent, model, { axisPx = 330, today } = {}) {
    parent.textContent = '';
    const axis = Math.max(200, Math.round(axisPx));
    const inner = axis - 2 * AXIS_PAD_PX;
    const x = (at) => Math.round(AXIS_PAD_PX + at * inner);

    const box = el('div', 'wa-lanes');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', timelineSummary(model, today));
    box.style.width = `${axis}px`;

    // the wanted-by labels, in as many rows as they need
    const wantedPlaced = placeLabels(
        model.wanted.map((w) => ({ id: w.id, at: x(w.at) / axis, widthPx: labelWidth(dayShort(w.due)), w })), axis, 6,
    );
    const wantedRows = Math.max(1, rowCount(wantedPlaced));
    const head = el('div', 'wa-due-labels');
    head.style.height = `${wantedRows * ROW_PX}px`;
    for (const p of wantedPlaced) {
        const s = el('span', 'wa-due-l', dayShort(p.w.due));
        s.style.left = `${Math.round(p.px)}px`;
        s.style.top = `${p.row * ROW_PX}px`;
        s.title = `${p.w.name}: ${dayLong(p.w.due, today)}`;
        head.appendChild(s);
    }
    box.appendChild(head);

    const body = el('div', 'wa-lanes-body');
    const lanes = [['now', t('f.wa.tl.now')], ['plan', t('f.wa.tl.plan')]];
    for (const [key, label] of lanes) {
        const dots = model.lanes[key];
        const placed = placeLabels(dots.map((d) => ({ id: d.id, at: x(d.at) / axis, widthPx: DOT_PX, d })), axis, 3);
        const rows = Math.max(1, rowCount(placed));
        const lane = el('div', `wa-lane ${key}`);
        lane.appendChild(el('span', 'wa-lane-l', label));
        const track = el('div', 'wa-dots');
        track.style.height = `${rows * DOT_ROW_PX}px`;
        const far = dots.reduce((m, d) => (d.state === 'covered' ? m : Math.max(m, d.at)), 0);
        const line = el('i', 'wa-track');
        line.style.width = `${Math.max(0, x(far) - 0)}px`;
        line.style.top = `${DOT_ROW_PX / 2 - 2}px`;
        track.appendChild(line);
        for (const p of placed) {
            if (p.row > 0) {
                const stem = el('i', 'wa-stem');
                stem.style.left = `${Math.round(p.px)}px`;
                stem.style.top = `${DOT_ROW_PX / 2}px`;
                stem.style.height = `${p.row * DOT_ROW_PX}px`;
                track.appendChild(stem);
            }
            const g = el('span', `wa-g${p.d.late ? ' late' : ''}${p.d.state === 'covered' ? ' covered' : ''}`, String(p.d.n));
            g.style.left = `${Math.round(p.px)}px`;
            g.style.top = `${p.row * DOT_ROW_PX + (DOT_ROW_PX - DOT_PX) / 2}px`;
            g.title = `${p.d.name}: ${p.d.state === 'lands' ? dayLong(p.d.date, today) : t(`f.wa.tl.state.${p.d.state}`)}`;
            track.appendChild(g);
        }
        lane.appendChild(track);
        body.appendChild(lane);
    }
    // dashed lines for the wanted-by dates run through both lanes
    for (const p of wantedPlaced) {
        const ln = el('i', 'wa-due-line');
        ln.style.left = `${Math.round(p.px)}px`;
        body.appendChild(ln);
    }
    box.appendChild(body);

    const ax = el('div', 'wa-axis');
    const a1 = el('span', '', t('f.wa.tl.today'));
    const a2 = el('span', 'end', dayLong(model.end, today));
    ax.append(a1, a2);
    box.appendChild(ax);
    parent.appendChild(box);
    return box;
}
