// Milestone detection — the "moments that make someone smile" feed events.
//
// Called after data changes with fresh totals. Each milestone fires once per
// crossing (state in localStorage), and only in the positive direction — the
// feed celebrates; it doesn't rub in a dip. Falling back below a threshold
// re-arms it, so a later re-crossing celebrates again.

import { logEvent } from './eventlog.js';
import { formatCurrency } from '../utils.js';

// UI layers (toasts, confetti-adjacent things) listen for this without the
// state layer having to know about them.
function announce(detail) {
    try { document.dispatchEvent(new CustomEvent('ledger:milestone', { detail })); } catch (err) { console.warn('Ledger: milestone event failed', err); }
}

const MILESTONES_KEY = 'ft-milestones';

// Net worth celebrates at every $10k, and at $1k/$5k early on where $10k is far away.
const NET_WORTH_STEPS = [1000, 5000];
const NET_WORTH_STEP = 10000;
// Savings-rate thresholds worth calling out (%).
const SAVINGS_RATE_STEPS = [10, 20, 30, 50];
const SAVINGS_DEF = 'buckets'; // FT-R-116: savings = pay into saving buckets

function readState() {
    try { return JSON.parse(localStorage.getItem(MILESTONES_KEY)) || {}; }
    catch (_) { return {}; }
}
function writeState(s) {
    try { localStorage.setItem(MILESTONES_KEY, JSON.stringify(s)); } catch (_) { /* storage full or blocked: skip, deliberate */ }
}

function netWorthThreshold(value) {
    if (value < NET_WORTH_STEP) {
        let best = 0;
        for (const step of NET_WORTH_STEPS) if (value >= step) best = step;
        return best;
    }
    return Math.floor(value / NET_WORTH_STEP) * NET_WORTH_STEP;
}

function savingsRateThreshold(rate) {
    let best = 0;
    for (const step of SAVINGS_RATE_STEPS) if (rate >= step) best = step;
    return best;
}

/**
 * Compare totals against the last celebrated thresholds and log feed events
 * for new crossings. Fire-and-forget async (event log is IndexedDB).
 * @param {{netWorth:number, savingsRate:number}} totals
 */
export function checkMilestones(totals) {
    const state = readState();
    const next = { ...state };

    const nwNow = netWorthThreshold(totals.netWorth);
    const nwCelebrated = state.netWorth || 0;
    if (nwNow > nwCelebrated && totals.netWorth > 0) {
        next.netWorth = nwNow;
        logEvent('milestone', { kind: 'net-worth', threshold: nwNow, value: totals.netWorth }).catch(() => {});
        announce({ kind: 'net-worth', threshold: nwNow, thresholdLabel: formatCurrency(nwNow, undefined, 0) });
    } else if (nwNow < nwCelebrated) {
        next.netWorth = nwNow; // re-arm after a dip, silently
    }

    const srNow = savingsRateThreshold(totals.savingsRate);
    const srCelebrated = state.savingsRate || 0;
    const perPay = Number.isFinite(totals.savingsPerPayCents) ? totals.savingsPerPayCents : null;
    if (state.savingsDef !== SAVINGS_DEF) {
        // FT-R-116: the stored threshold was earned under the old definition (net minus expenses). Re-baseline
        // to the new figure without celebrating, so nothing fires for a number that only changed meaning.
        next.savingsRate = srNow;
        next.savingsDef = SAVINGS_DEF;
    } else if (srNow > srCelebrated && totals.savingsRate > 0) {
        next.savingsRate = srNow;
        logEvent('milestone', { kind: 'savings-rate', threshold: srNow, value: Math.round(totals.savingsRate * 10) / 10, perPayCents: perPay }).catch(() => {});
        announce({ kind: 'savings-rate', threshold: srNow, perPayCents: perPay });
    } else if (srNow < srCelebrated) {
        next.savingsRate = srNow;
    }

    if (next.netWorth !== state.netWorth || next.savingsRate !== state.savingsRate || next.savingsDef !== state.savingsDef) {
        writeState(next);
    }
}
