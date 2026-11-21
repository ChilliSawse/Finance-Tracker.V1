// Pay-day roll core (E2, FT-R-80). Pure: never mutates its input; returns the same data object
// (identity) when nothing changed, which is what makes a second run a no-op. The on/off policy
// and the `visibilitychange` trigger live elsewhere (E5); this is only the maths.
//
// Rules: each pay date after autoCredit.rolledThrough up to today is applied once; the marker moves
// to the last applied date; catch-up is capped (default 52 pays, the latest ones win); movements are capped;
// first enable sets the marker to the latest pay date with no retro credit; on=false does nothing.

import { getCycle, payDatesBetween, addDays } from './pay-cycle.js';
import { netPerPayCents, planTotals } from './plan.js';
import { allocateCents, bucketByRole, buildTree, creditFamily } from './saving-model.js';
import { applyPay, mojoSteps, mojoLivingCosts } from './fire.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));
const addCents = (dollars, c) => Math.round(num(dollars) * 100 + c) / 100;
const SPEND_ROLES = ['daily', 'splurge'];

export const MAX_CATCH_UP = 52;
export const MAX_MOVEMENTS = 1000;
const MOVEMENT_DAYS = 24 * 31;

function essentialCents(d) {
    try { return Math.round(num(planTotals(d).essentialPerCycle) * 100); } catch (e) { return 0; }
}

function primarySource(data) {
    const s = (data && data.incomeSources) || [];
    return s[(data && data.primaryIncomeIndex) || 0] || s[0] || null;
}

const isSave = (row) => (row.kind ? row.kind === 'save' : !SPEND_ROLES.includes(row.role));

function creditRow(data, row, cents, tree, move) {
    const leaves = creditFamily(cents, row.id, tree);
    if (!leaves) { row.currentBalance = addCents(row.currentBalance, cents); move(row.id, cents, 'pay'); return; }
    leaves.forEach((leaf) => {
        if (leaf.id === row.id) row.currentBalance = addCents(row.currentBalance, leaf.cents);
        else {
            const g = (data.bucketGoals || []).find((x) => String(x.id) === leaf.id);
            if (g) g.saved = addCents(g.saved, leaf.cents);
        }
        if (leaf.cents) move(leaf.id, leaf.cents, 'pay');
    });
}

/**
 * Roll the pay days up to `today`.
 * opts: {netCents (default netPerPayCents(data)), maxCatchUp, maxMovements, actualMonthlyCents}.
 * Returns {data, changed, paysApplied, skipped}.
 */
export function runPayRoll(data, today, opts = {}) {
    const same = { data, changed: false, paysApplied: 0, skipped: 0 };
    const sm = data && data.savingModel;
    const ac = sm && sm.autoCredit;
    if (!ac || !ac.on) return same;
    const source = primarySource(data);
    const cycle = getCycle(source, today);
    if (cycle.mode !== 'cycle') return same;

    if (!ac.rolledThrough) {
        const next = clone(data);
        next.savingModel.autoCredit.rolledThrough = cycle.start;
        return { data: next, changed: true, paysApplied: 0, skipped: 0 };
    }
    let dates = payDatesBetween(source, addDays(ac.rolledThrough, 1), today);
    if (!dates.length) return same;
    const maxCatchUp = opts.maxCatchUp || MAX_CATCH_UP;
    const skipped = Math.max(0, dates.length - maxCatchUp);
    dates = dates.slice(skipped);

    const next = clone(data);
    next.allocation = Array.isArray(next.allocation) ? next.allocation : [];
    next.liabilities = Array.isArray(next.liabilities) ? next.liabilities : [];
    next.bucketGoals = Array.isArray(next.bucketGoals) ? next.bucketGoals : [];
    const m = next.savingModel;
    m.movements = Array.isArray(m.movements) ? m.movements : [];
    m.fire = m.fire && Array.isArray(m.fire.targets) ? m.fire : { targets: [] };
    const net = opts.netCents != null ? opts.netCents : netPerPayCents(next);
    const rows = next.allocation;
    const split = allocateCents(net, rows.map((r) => num(r.percentage)));
    const paysPerYear = cycle.cyclesPerYear;
    const living = mojoLivingCosts({
        essentialPerPayCents: opts.essentialPerPayCents != null ? opts.essentialPerPayCents : essentialCents(next), cyclesPerYear: paysPerYear,
        actualMonthlyCents: opts.actualMonthlyCents || [], basis: (m.mojo && m.mojo.basis) || 'auto',
    });
    const mojoRow = bucketByRole(next, 'mojo');
    const fireRow = bucketByRole(next, 'fire');

    dates.forEach((date) => {
        const move = (bucketId, cents, kind) => { if (cents) m.movements.push({ date, bucketId, cents, kind }); };
        const tree = buildTree(rows, next.bucketGoals);
        rows.forEach((row, i) => {
            const cents = split[i];
            if (!cents || !isSave(row)) return;
            if (row === fireRow) {
                const mojoBal = mojoRow ? Math.round(num(mojoRow.currentBalance) * 100) : 0;
                const ladder = mojoSteps(m.mojo || {}, living, mojoBal);
                const r = applyPay({ targets: m.fire.targets, liabilities: next.liabilities,
                    mojo: { balanceCents: mojoBal, targetCents: ladder.targetCents }, paysPerYear, cents, date });
                m.fire.targets = r.targets;
                next.liabilities.forEach((l) => {
                    if (l && r.liabilityBalances[l.id] != null) l.balance = r.liabilityBalances[l.id] / 100;
                });
                if (mojoRow && r.mojoCreditCents) mojoRow.currentBalance = addCents(mojoRow.currentBalance, r.mojoCreditCents);
                r.applications.forEach((a) => move(a.type === 'mojo' && mojoRow ? mojoRow.id : row.id, a.cents, 'target'));
                if (r.freeCents) move(row.id, r.freeCents, 'pay');
                if (r.freeCents) row.currentBalance = addCents(row.currentBalance, r.freeCents);
            } else {
                creditRow(next, row, cents, tree, move);
            }
        });
    });

    m.autoCredit.rolledThrough = dates[dates.length - 1];
    const cap = opts.maxMovements || MAX_MOVEMENTS;
    const cutoff = addDays(today, -MOVEMENT_DAYS);
    m.movements = m.movements.filter((x) => x.date >= cutoff);
    if (m.movements.length > cap) m.movements = m.movements.slice(m.movements.length - cap);
    return { data: next, changed: true, paysApplied: dates.length, skipped };
}
