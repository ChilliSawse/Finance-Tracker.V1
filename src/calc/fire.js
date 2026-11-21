// Fire extinguisher and Mojo maths (E2). Pure and DOM-free: no storage, inputs never mutated.
// Money is integer cents. Targets live in savingModel.fire.targets (array order is the order).
// Debt interest is simple per pay: round(remaining x rate / paysPerYear), half up, in integers.
// HELP is never a target (FT-R-91).

export const MOJO_STARTER_CENTS = 200000;
export const MOJO_NOTE = 'mojo-under-starter';

const clone = (x) => JSON.parse(JSON.stringify(x));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const cents = (dollars) => Math.round(num(dollars) * 100);

/** Round-half-up integer division for non-negative n and positive d. */
function divRound(n, d) { return Math.floor((2 * n + d) / (2 * d)); }

/** Interest for one pay, whole cents. ratePct is the annual percentage (20.99). */
export function interestForPay(remainingCents, ratePct, paysPerYear) {
    const r = Math.round(num(ratePct) * 100);
    const p = Math.max(1, Math.round(num(paysPerYear)) || 26);
    if (remainingCents <= 0 || r <= 0) return 0;
    return divRound(remainingCents * r, 10000 * p);
}

/**
 * Default target list (FT-R-82): debts with a balance, smallest first (ties: higher rate first),
 * then Mojo, then Home deposit (and home loan), then Super top-up. Liabilities without an id are left out.
 */
export function defaultFireTargets(liabilities) {
    const debts = (Array.isArray(liabilities) ? liabilities : [])
        .filter((l) => l && l.id != null && cents(l.balance) > 0)
        .sort((a, b) => cents(a.balance) - cents(b.balance) || num(b.interestRate) - num(a.interestRate));
    const out = debts.map((l) => ({
        id: `debt:${l.id}`, type: 'debt', liabilityId: String(l.id), label: l.name || 'Debt', skip: false,
        state: 'queued', startCents: cents(l.balance), remainingCents: cents(l.balance), balanceSeenCents: cents(l.balance),
    }));
    out.push({ id: 'mojo', type: 'mojo', label: 'Mojo', skip: false, state: 'queued' });
    out.push({ id: 'home', type: 'home', label: 'Home deposit, then home loan', goalCents: null, savedCents: 0, skip: false, state: 'queued' });
    out.push({ id: 'super', type: 'super', label: 'Super top-up', savedCents: 0, skip: false, state: 'queued' });
    return out;
}

/**
 * Re-base debt targets on a balance edit made outside a roll: remaining = the new balance,
 * start = max(start, remaining). Returns a new array (the same objects where nothing changed).
 */
export function rebaseTargets(targets, liabilities) {
    const libs = Array.isArray(liabilities) ? liabilities : [];
    return (Array.isArray(targets) ? targets : []).map((t) => {
        if (!t || t.type !== 'debt') return t;
        const l = libs.find((x) => x && String(x.id) === String(t.liabilityId));
        if (!l) return t;
        const cur = cents(l.balance);
        if (cur === t.balanceSeenCents) return t;
        return { ...t, remainingCents: cur, startCents: Math.max(num(t.startCents), cur), balanceSeenCents: cur };
    });
}

/**
 * Pays needed to clear a debt: ceil(-ln(1 - rB/P) / ln(1 + r)), r = rate per pay.
 * Infinity when the payment does not beat the interest; 0% gives ceil(B/P); 0 when nothing is owed.
 * `{continuous:true}` returns the unrounded figure.
 */
export function payoffPays(remainingCents, annualRatePct, perPayCents, paysPerYear, opts = {}) {
    const B = num(remainingCents), P = num(perPayCents);
    if (B <= 0) return 0;
    if (P <= 0) return Infinity;
    const r = num(annualRatePct) / 100 / (paysPerYear || 26);
    let n;
    if (r <= 0) n = B / P;
    else {
        if (P <= r * B) return Infinity;
        n = -Math.log(1 - (r * B) / P) / Math.log(1 + r);
    }
    return opts.continuous ? n : Math.ceil(n - 1e-9);
}

function evaluate(t, libs, mojo) {
    if (t.skip) return { open: false, state: 'skipped' };
    switch (t.type) {
        case 'debt': {
            const l = libs.find((x) => x && String(x.id) === String(t.liabilityId));
            if (!l) return { open: false, state: 'skipped', auto: 'missing' };
            if (num(t.remainingCents) <= 0) return { open: false, state: 'done' };
            return { open: true };
        }
        case 'mojo':
            if (num(mojo.targetCents) > 0 && num(mojo.balanceCents) >= mojo.targetCents) return { open: false, state: 'done' };
            return { open: true };
        case 'home':
            if (!(num(t.goalCents) > 0)) return { open: false, state: 'skipped', auto: 'no-goal' };
            return num(t.savedCents) >= t.goalCents ? { open: false, state: 'done' } : { open: true };
        case 'saver':
            return num(t.goalCents) > 0 && num(t.savedCents) >= t.goalCents ? { open: false, state: 'done' } : { open: true };
        default:
            return { open: true }; // super: open-ended
    }
}

function progressOf(t, mojo) {
    const clamp = (x) => Math.max(0, Math.min(1, x));
    if (t.type === 'debt') return num(t.startCents) > 0 ? clamp(1 - num(t.remainingCents) / t.startCents) : 1;
    if (t.type === 'mojo') return num(mojo.targetCents) > 0 ? clamp(num(mojo.balanceCents) / mojo.targetCents) : null;
    if ((t.type === 'home' || t.type === 'saver') && num(t.goalCents) > 0) return clamp(num(t.savedCents) / t.goalCents);
    return null;
}

/**
 * The state of the list: one active target (the first that is not skipped, done or inapplicable).
 * mojo = {balanceCents, targetCents|null}. Returns {targets (with state, progress), activeId, free, note}.
 * `note` is 'mojo-under-starter' while Mojo is on the list, not skipped and under A$2,000 (FT-R-82).
 */
export function fireStatus(targets, liabilities, mojo = {}) {
    const libs = Array.isArray(liabilities) ? liabilities : [];
    const list = Array.isArray(targets) ? targets : [];
    let activeId = null;
    const out = list.map((t) => {
        const e = evaluate(t, libs, mojo);
        let state = e.state;
        if (e.open) { if (activeId === null) { activeId = t.id; state = 'active'; } else state = 'queued'; }
        const row = { ...t, state, progress: progressOf(t, mojo) };
        if (e.auto) row.auto = e.auto; else delete row.auto;
        return row;
    });
    const m = list.find((t) => t && t.type === 'mojo' && !t.skip);
    const note = m && num(mojo.balanceCents) < MOJO_STARTER_CENTS ? MOJO_NOTE : null;
    return { targets: out, activeId, free: activeId === null, note };
}

/**
 * Apply one pay's Fire amount. Interest accrues once, on the target that is active when the pay starts
 * (if a debt); overflow carries to the next target in the same pay with no interest this pay.
 * args: {targets, liabilities, mojo:{balanceCents, targetCents}, paysPerYear, cents, date}.
 * Returns {targets, applications:[{targetId,type,cents}], mojoCreditCents, interestCents, freeCents,
 * liabilityBalances:{[id]: cents}}.
 */
export function applyPay({ targets, liabilities, mojo = {}, paysPerYear = 26, cents: pay = 0, date = null }) {
    const libs = Array.isArray(liabilities) ? liabilities : [];
    const ts = clone(rebaseTargets(targets, libs));
    let left = Math.max(0, Math.round(num(pay)));
    let mojoBal = num(mojo.balanceCents);
    const applications = [];
    let mojoCredit = 0, interestCents = 0, accrued = false;
    for (let guard = 0; left > 0 && guard < ts.length + 2; guard++) {
        const st = fireStatus(ts, libs, { balanceCents: mojoBal, targetCents: mojo.targetCents });
        if (st.activeId === null) break;
        const t = ts.find((x) => x.id === st.activeId);
        let use = 0;
        if (t.type === 'debt') {
            if (!accrued) {
                const l = libs.find((x) => String(x.id) === String(t.liabilityId));
                const i = interestForPay(t.remainingCents, l && l.interestRate, paysPerYear);
                t.remainingCents += i; interestCents += i;
            }
            use = Math.min(left, t.remainingCents);
            t.remainingCents -= use;
        } else if (t.type === 'mojo') {
            const room = num(mojo.targetCents) > 0 ? Math.max(0, mojo.targetCents - mojoBal) : left;
            use = Math.min(left, room);
            mojoBal += use; mojoCredit += use;
        } else if (t.type === 'home' || t.type === 'saver') {
            const room = num(t.goalCents) > 0 ? Math.max(0, t.goalCents - num(t.savedCents)) : left;
            use = Math.min(left, room);
            t.savedCents = num(t.savedCents) + use;
        } else {
            use = left;
            t.savedCents = num(t.savedCents) + use;
        }
        accrued = true;
        if (use <= 0) break;
        left -= use;
        applications.push({ targetId: t.id, type: t.type, cents: use });
    }
    const liabilityBalances = {};
    ts.forEach((t) => {
        if (t.type !== 'debt') return;
        if (t.remainingCents !== num(t.balanceSeenCents)) liabilityBalances[t.liabilityId] = t.remainingCents;
        t.balanceSeenCents = t.remainingCents;
    });
    const final = fireStatus(ts, libs, { balanceCents: mojoBal, targetCents: mojo.targetCents });
    ts.forEach((t, i) => {
        t.state = final.targets[i].state;
        if (t.state === 'done' && !t.doneOn && date) t.doneOn = date;
    });
    return { targets: ts, applications, mojoCreditCents: mojoCredit, interestCents, freeCents: left, liabilityBalances };
}

// ---------- Mojo ----------

/**
 * Living costs for Mojo: essentials only (FT-R-83). Planned = essentialPerPay x cyclesPerYear / 12.
 * Actual = mean of the last up to 3 complete months of essential spend, used only with 2 or more months.
 * basis 'auto' prefers actual when it has 2+ months; 'actual' falls back to planned (fellBack); 'planned' ignores actuals.
 * Returns {monthlyCents (rounded), exactMonthlyCents, basis (the one used), requested, fellBack}.
 */
export function mojoLivingCosts({ essentialPerPayCents = 0, cyclesPerYear = 26, actualMonthlyCents = [], basis = 'auto' } = {}) {
    const planned = (num(essentialPerPayCents) * (num(cyclesPerYear) || 26)) / 12;
    const months = (Array.isArray(actualMonthlyCents) ? actualMonthlyCents : []).filter((x) => Number.isFinite(x)).slice(-3);
    const haveActual = months.length >= 2;
    const wantActual = basis === 'actual' || basis === 'auto';
    const useActual = wantActual && haveActual;
    const exact = useActual ? months.reduce((a, b) => a + b, 0) / months.length : planned;
    return {
        monthlyCents: Math.round(exact), exactMonthlyCents: exact,
        basis: useActual ? 'actual' : 'planned', requested: basis, fellBack: basis === 'actual' && !haveActual,
    };
}

/**
 * The Mojo ladder. mojo = {starter (cents, default 2,000), months (default 3), steps:[{id,kind:'custom',amount}]};
 * living = mojoLivingCosts result (or a monthly cents number). Steps are sorted by amount; the active step is the
 * first not yet reached. progressPct is the balance against the active step (100 when complete).
 */
export function mojoSteps(mojo = {}, living = 0, balanceCents = 0) {
    const monthly = living && typeof living === 'object' ? num(living.exactMonthlyCents ?? living.monthlyCents) : num(living);
    const months = mojo.months == null ? 3 : num(mojo.months);
    const steps = [{ id: 'starter', kind: 'starter', amountCents: mojo.starter == null ? MOJO_STARTER_CENTS : Math.round(num(mojo.starter)) }];
    (Array.isArray(mojo.steps) ? mojo.steps : []).forEach((s) => {
        if (s && s.kind === 'custom' && num(s.amount) > 0) steps.push({ id: s.id || 'custom', kind: 'custom', amountCents: Math.round(s.amount) });
    });
    if (months > 0) steps.push({ id: 'months', kind: 'months', amountCents: Math.round(months * monthly) });
    const sorted = steps.filter((s) => s.amountCents > 0).sort((a, b) => a.amountCents - b.amountCents);
    const bal = Math.max(0, num(balanceCents));
    const active = sorted.find((s) => bal < s.amountCents) || null;
    const targetCents = sorted.length ? sorted[sorted.length - 1].amountCents : null;
    return {
        steps: sorted, active, complete: !!sorted.length && !active, targetCents,
        progressPct: active ? Math.round((bal / active.amountCents) * 100) : 100,
    };
}
