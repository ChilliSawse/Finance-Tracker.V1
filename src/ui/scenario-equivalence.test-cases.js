// Test cases for the "scenario-equivalence" group (H6). Chilli's rule: What If works exactly like the app. An edit in a
// scenario must change every dependent figure the way the same edit does in the real app; the only difference is that it
// runs on a copy.
//
// For each change kind and op the UI can produce, on three households:
//   Path A  resolveAt(data, [change]) and then every figure the What If results show (buildResultSet: cards, all numbers,
//           Compare, the chart path, FI years and number, goals, and the Explain lines).
//   Path B  the same edit made on a deep copy through the real save functions (applyIncomeValues, updatePlanItem, setSplit,
//           addGoal, updateGoal, removeGoal, applyAssumptions, newDebt and applyDebtValues, the Add income row), then the
//           figures worked out with the functions the Today, Plan and Future screens call.
// The two must be equal. The resolved data and the edited data are compared too, so a field the real save writes and the
// scenario does not shows up as a named path.
// Shape: { name, fn(assert) }, assert(label, actual, expected). Pure (no DOM).

import { buildResultSet, diffOf, bestOf } from './scenario/results.js';
import { explainLines } from './scenario/explain.js';
import { starterSpec, fmtMoney } from './scenario/starters.js';
import { resolveAt } from '../calc/scenario.js';
import { fiSummary, explainFi, projectNetWorth, savingsRatePlanned, savingsPlanned } from '../calc/fi.js';
import { planGoalsFromData } from '../calc/goal-planner.js';
import { netPerPayCents } from '../calc/plan.js';
import { calculateTotals } from '../calc/calculations.js';
import { expectedPay } from '../calc/withholding.js';
import { getBuckets } from '../state/saving-model.js';
import { setSplit, addGoal, updateGoal, removeGoal } from '../state/saving-model.js';
import { updatePlanItem, removePlanItem } from '../state/plan.js';
import { buildSampleHousehold } from '../state/sample-data.js';
import { migrateAssetDebtDetail } from '../state/asset-debt-migration.js';
import { acceptPayslipJob } from '../state/income-migration.js';
import { applyIncomeValues, sheetValuesFor } from './income-layout.js';
import { newDebt, applyDebtValues, newIncomeSourceRow } from './plan-assets-debts.js';
import { applyAssumptions, withPeople, goalsModel } from './future/model.js';
import { t } from '../i18n/strings.js';

export const TODAY = '2026-11-21';
const clone = (x) => structuredClone(x);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- the three households ----------

/** The sample household, with one dated goal so the goal plan has something to say. */
export function sampleHousehold() {
    const d = buildSampleHousehold(TODAY).data;
    migrateAssetDebtDetail(d);
    updateGoal(d, 'g-flights', { due: '2027-09-01' });
    return d;
}

/** A salaried source that carries payslip figures (the live shape H5 found). */
export function payslipHousehold() {
    const d = sampleHousehold();
    const src = d.incomeSources[0];
    const w = expectedPay({ paySchedule: src.paySchedule, grossAnnual: src.grossAnnual, claimsTaxFree: true, hasStudyDebt: true }, TODAY);
    src.taxRemoved = w.total;
    src.invoicedPayPostTax = Math.round((src.grossAnnual / 26 - w.total) * 100) / 100;
    return d;
}

/** A source migrated from Self-employed (net and tax per pay stored), then switched to Salary: the payslip figures stay. */
export function migratedHousehold() {
    const d = sampleHousehold();
    const src = d.incomeSources[0];
    src.incomeType = 'selfEmployed'; src.basis = 'selfEmployed'; src.grossAnnual = 0;
    src.taxRemoved = 700; src.invoicedPayPostTax = 2300; src.migrationPrompt = 'payslip-job';
    src.hourlyRate = null; src.hoursPerWeek = null;
    acceptPayslipJob(src);
    return d;
}

export const HOUSEHOLDS = { sample: sampleHousehold, payslip: payslipHousehold, migrated: migratedHousehold };

// ---------- changes the UI produces ----------

let seq = 0;
function change(patch) {
    seq += 1;
    return { id: `ch-${seq}`, kind: 'expense', target: null, field: null, op: 'set', value: null, baseValue: null, from: null, until: null, note: '', ...patch };
}
const build = (d, id, patch) => { const spec = starterSpec(id, d, { changes: [] }); return spec.build({ ...spec.values, ...patch }); };
const primary = (d) => d.incomeSources[d.primaryIncomeIndex || 0];

/** One case = the scenario changes, and the real app's edit on a copy. `real` writes through the app's own save functions. */
export function casesFor(d) {
    const inc = primary(d);
    const smile = d.allocation.find((r) => r.role === 'smile');
    const out = [];
    const add = (kind, op, label, changes, real) => out.push({ kind, op, label, changes, real });

    // income: the Pay starter sets or scales grossAnnual (starters.js payBuilder)
    const salaryEdit = (src, gross) => (data) => {
        const s = data.incomeSources.find((x) => x.id === src.id);
        const values = { ...sheetValuesFor(s, 'salary', TODAY), amount: gross };
        applyIncomeValues(s, values, 'salary', { grossAnnual: s.grossAnnual, paySchedule: s.paySchedule, nextPay: values.nextPay });
    };
    const g0 = Number(inc.grossAnnual);
    add('income', 'set', 'pay rise to 150,000', build(d, 'pay', { sourceId: inc.id, newGross: 150000, pct: null, from: '' }), salaryEdit(inc, 150000));
    add('income', 'set', 'pay cut to 60,000', build(d, 'pay', { sourceId: inc.id, newGross: 60000, pct: null, from: '' }), salaryEdit(inc, 60000));
    add('income', 'scale', 'pay up 10 percent', build(d, 'pay', { sourceId: inc.id, newGross: null, pct: 10, from: '' }), salaryEdit(inc, Math.round(g0 * 1.1 * 100) / 100));
    add('income', 'set', 'new job (a swap) at 120,000', build(d, 'job', { sourceId: inc.id, newGross: 120000, note: 'new job', from: '' }), salaryEdit(inc, 120000));
    // a pay change dated today (from = today) is active now
    add('income', 'set', 'pay rise from today', build(d, 'pay', { sourceId: inc.id, newGross: 110000, pct: null, from: TODAY }), salaryEdit(inc, 110000));

    // expense: Expenses starter, an item set or scaled, a group of items scaled
    const rent = d.plan.find((p) => p.id === 'p-rent');
    const planEdit = (id, fn) => (data) => { const row = data.plan.find((p) => p.id === id); updatePlanItem(data, id, { amount: fn(row.amount) }); };
    add('expense', 'set', 'rent set to 700', build(d, 'expense', { target: 'item:p-rent', newAmount: 700, pct: null }), planEdit('p-rent', () => 700));
    add('expense', 'scale', 'rent up 15 percent', build(d, 'expense', { target: 'item:p-rent', newAmount: null, pct: 15 }), planEdit('p-rent', (a) => a * 1.15));
    add('expense', 'scale', 'rent down 20 percent', build(d, 'expense', { target: 'item:p-rent', newAmount: null, pct: -20 }), planEdit('p-rent', (a) => a * 0.8));
    const catId = d.plan.find((p) => p.categoryId && d.plan.filter((q) => q.categoryId === p.categoryId).length > 1)?.categoryId || rent.categoryId;
    const catItems = d.plan.filter((p) => p.categoryId === catId);
    add('expense', 'scale', 'a whole group down 10 percent', build(d, 'expense', { target: `cat:${catId}`, newAmount: null, pct: -10 }),
        (data) => { for (const p of catItems) planEdit(p.id, (a) => a * 0.9)(data); });
    // a cut used by Plan for this: a Splurge item set to nothing
    const splurgeItem = d.plan.find((p) => p.id !== 'p-rent' && p.inTotals !== false && p.amount > 0);
    add('expense', 'set', 'an item taken to nothing (Plan for this)', [change({ kind: 'expense', target: { collection: 'plan', id: splurgeItem.id }, field: 'amount', op: 'set', value: 0, baseValue: splurgeItem.amount, from: TODAY })], planEdit(splurgeItem.id, () => 0));
    add('expense', 'remove', 'an item removed', [change({ kind: 'expense', target: { collection: 'plan', id: splurgeItem.id }, op: 'remove' })], (data) => { removePlanItem(data, splurgeItem.id); });

    // split: one change per bucket that moved, totalling 100
    const pct = (id) => d.allocation.find((r) => r.id === id).percentage;
    const splitMap = { 'b-daily': pct('b-daily') - 5, 'b-smile': pct('b-smile') + 5 };
    add('split', 'set', 'split: 5 points from Daily to Smile', build(d, 'split', { 'p_b-daily': splitMap['b-daily'], 'p_b-smile': splitMap['b-smile'] }), (data) => { setSplit(data, splitMap); });

    // goal: a new goal under Smile (add); a goal's cost or date set; a goal dropped
    const newGoal = build(d, 'goal', { bucketId: smile.id, name: 'Japan', cost: 6000, due: '2027-06-01' });
    add('goal', 'add', 'a new goal under Smile', newGoal, (data) => {
        const v = newGoal[0].value; const res = addGoal(data, v.parentId, { name: v.name, cost: v.cost, due: v.due, saved: v.saved });
        res.item.id = v.id;
    });
    const flights = d.bucketGoals.find((g) => g.id === 'g-flights');
    add('goal', 'set', 'a goal cost raised', [change({ kind: 'goal', target: { collection: 'bucketGoals', id: flights.id }, field: 'cost', op: 'set', value: 2600, baseValue: flights.cost, from: TODAY })], (data) => { updateGoal(data, flights.id, { cost: 2600 }); });
    add('goal', 'set', 'a goal date pushed out', [change({ kind: 'goal', target: { collection: 'bucketGoals', id: flights.id }, field: 'due', op: 'set', value: '2028-03-01', baseValue: flights.due, from: TODAY })], (data) => { updateGoal(data, flights.id, { due: '2028-03-01' }); });
    add('goal', 'remove', 'a goal dropped', [change({ kind: 'goal', target: { collection: 'bucketGoals', id: flights.id }, op: 'remove', from: TODAY })], (data) => { removeGoal(data, flights.id); });
    const goals3 = build(d, 'goals', { bucketId: smile.id, n1: 'Car', c1: 3000, d1: '2027-03-01', n2: 'Course', c2: 1500, d2: '2027-05-01' });
    add('goal', 'add', 'two new goals (Several goals)', goals3, (data) => {
        for (const c of goals3) { const v = c.value; const res = addGoal(data, v.parentId, { name: v.name, cost: v.cost, due: v.due, saved: v.saved }); res.item.id = v.id; }
    });

    // incomeAdd: Extra income (a new salaried source) and its real counterpart, Plan's Add income + the Salary sheet
    const extra = build(d, 'extra', { name: 'Side gig', gross: 24000, schedule: 'fortnightly' });
    add('incomeAdd', 'add', 'extra income, 24,000 a year', extra, (data) => {
        const row = newIncomeSourceRow(data.incomeSources, { name: 'Side gig' });
        row.id = extra[0].value.id;
        data.incomeSources.push(row);
        const values = { ...sheetValuesFor(row, 'salary', TODAY), amount: 24000, paySchedule: 'fortnightly' };
        applyIncomeValues(row, values, 'salary', { grossAnnual: 0, paySchedule: 'fortnightly', nextPay: '' });
    });

    // debtAdd: A loan
    const loan = build(d, 'loan', { name: 'Car loan 2', balance: 20000, interestRate: 8, minRepayment: 400, interestType: 'variable', compounding: 'monthly', repaymentFrequency: 'monthly', label: 'bad' });
    add('debtAdd', 'add', 'a new loan', loan, (data) => {
        const row = newDebt(data.liabilities, { name: 'Car loan 2' });
        applyDebtValues(row, { name: 'Car loan 2', balance: 20000, interestRate: 8, minRepayment: 400, interestType: 'variable', compounding: 'monthly', repaymentFrequency: 'monthly', label: 'bad' });
        row.id = loan[0].value.id;
        data.liabilities.push(row);
    });

    // assumption: the FI assumptions (the Future screen sets them; What If has no starter for it, the kind is in the engine)
    const fiSet = (field, value) => change({ kind: 'assumption', target: { collection: 'fiSettings', id: null }, field, op: 'set', value });
    const realFi = (patch) => (data) => { const v = { multiple: 25, expectedReturn: 7, inflation: 2.5, ...Object.fromEntries(Object.entries(data.fiSettings || {}).filter(([k]) => ['multiple', 'expectedReturn', 'inflation'].includes(k))), ...patch }; applyAssumptions(data, v); };
    add('assumption', 'set', 'return 5 percent', [fiSet('expectedReturn', 5)], realFi({ expectedReturn: 5 }));
    add('assumption', 'set', 'multiple 30', [fiSet('multiple', 30)], realFi({ multiple: 30 }));
    add('assumption', 'scale', 'inflation scaled 1.2', [change({ kind: 'assumption', target: { collection: 'fiSettings', id: null }, field: 'inflation', op: 'scale', value: 1.2 })], realFi({ inflation: (Number.isFinite(d.fiSettings?.inflation) ? d.fiSettings.inflation : 2.5) * 1.2 }));
    add('assumption', 'add', 'return plus 1 point', [change({ kind: 'assumption', target: { collection: 'fiSettings', id: null }, field: 'expectedReturn', op: 'add', value: 1 })], realFi({ expectedReturn: (Number.isFinite(d.fiSettings?.expectedReturn) ? d.fiSettings.expectedReturn : 7) + 1 }));

    // combined: several edits in one scenario, every kind at once, in order
    const combo = [...build(d, 'pay', { sourceId: inc.id, newGross: 130000, pct: null, from: '' }),
        ...build(d, 'expense', { target: 'item:p-rent', newAmount: null, pct: 10 }),
        ...build(d, 'split', { 'p_b-daily': splitMap['b-daily'], 'p_b-smile': splitMap['b-smile'] }),
        ...newGoal.map((c) => ({ ...c, id: `${c.id}-c` })), fiSet('inflation', 3)];
    add('combined', 'several', 'pay, rent, split, goal and an assumption together', combo, (data) => {
        salaryEdit(inc, 130000)(data);
        planEdit('p-rent', (a) => a * 1.1)(data);
        setSplit(data, splitMap);
        const v = newGoal[0].value; addGoal(data, v.parentId, { name: v.name, cost: v.cost, due: v.due, saved: v.saved }).item.id = v.id;
        realFi({ inflation: 3 })(data);
    });
    return out;
}

// ---------- the figures ----------

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const ROLES = ['daily', 'splurge', 'smile', 'fire', 'mojo', 'grow'];
const dollarsToCents = (v) => Math.round((Number(v) || 0) * 100);

/** What the What If results show for the scenario side, read back from the result set and the explain lines. */
export function whatIfFigures(data, changes) {
    const set = buildResultSet(data, changes, TODAY, null);
    const row = (id) => { const r = set.rows.find((x) => x.id === id); return r ? r.scen.v : null; };
    const out = {
        takeHome: row('takeHome'), savingsRate: row('savingsRate'), savingsPerPay: set.scen.savings.perPayCents, savingsPerYear: set.scen.savings.perYearCents,
        savingsText: (set.rows.find((x) => x.id === 'savingsRate') || { scen: {} }).scen.text, required: row('required'), short: row('short'), earnGap: row('earnGap'),
        debts: row('debts'), help: row('help'), mojoBalance: row('mojoBalance'), fiYears: row('fiYears'), fiNumber: row('fiNumber'),
        nw1: row('nw1'), nw5: row('nw5'), nw10: row('nw10'), nw20: row('nw20'),
        perPay: Object.fromEntries(ROLES.map((r) => [r, row(r === 'mojo' ? 'mojo' : r)])),
        goals: [...set.scen.goals.values()].map((g) => ({ name: g.name, due: g.due, costCents: g.costCents, needPerPay: g.needPerPay, impossible: g.impossible })).sort(byName),
        smilePerPay: set.scen.plan ? set.scen.plan.smilePerPayCents : null,
        path: set.scen.summary ? set.scen.summary.path.map((p) => round2(p.fiNetWorth)) : null,
        chart: projectNetWorth(withPeople(data), { today: TODAY, years: 30, changes }).path.map((p) => round2(p.fiNetWorth)),
        explainFi: explainLines(set, 'fiYears'),
        explainRate: explainLines(set, 'savingsRate'),
        explainTake: explainLines(set, 'takeHome'),
        totals: totalsOf(resolveAt(data, changes, TODAY)),
        buckets: bucketsOf(resolveAt(data, changes, TODAY), TODAY),
    };
    return out;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function totalsOf(d) {
    const x = calculateTotals(clone(d), { today: TODAY });
    return {
        gross: round2(x.totalGrossAnnualIncome), tax: round2(x.totalAnnualTax), net: round2(x.totalNetAnnualIncome), weeklyExpenses: round2(x.totalWeeklyExpenses),
        weeklySavings: round2(x.weeklySavings), savingsRateNetMinusExpenses: round2(x.savingsRate), netWorth: round2(x.netWorth), annualTaxOwed: x._annualTaxOwed === null ? null : round2(x._annualTaxOwed),
    };
}

function bucketsOf(d, today) {
    return getBuckets(d, today).map((b) => ({ name: b.name, role: b.role, kind: b.kind, top: !b.parentId, pct: b.pct, perPayCents: b.perPayCents, balanceCents: b.balanceCents }));
}

/** The same figures from the functions the Today, Plan and Future screens call, on the edited data. */
export function appFigures(d) {
    const view = withPeople(d);
    const s = fiSummary(view, { today: TODAY });                    // Future: the FI card and the chart
    const top = getBuckets(d, TODAY).filter((b) => !b.parentId);     // Plan: the buckets
    const per = (role) => { const rows = top.filter((b) => b.role === role); return rows.length ? rows.reduce((a, b) => a + b.perPayCents, 0) : null; };
    const plan = planGoalsFromData(d, { today: TODAY });             // Future: the goals card (goalsModel) and What If use this one
    const model = goalsModel(d, TODAY);
    const mojo = top.filter((b) => b.role === 'mojo');
    const goalRows = plan.perGoal.map((g) => ({ name: g.name, due: g.due, costCents: null, needPerPay: g.perPayCents, impossible: !!g.impossible })).sort(byName);
    const costs = new Map((d.bucketGoals || []).map((g) => [String(g.id), dollarsToCents(g.cost)]));
    plan.perGoal.forEach((g) => { const r = goalRows.find((x) => x.name === g.name && x.due === g.due); if (r) r.costCents = costs.get(String(g.id)) ?? null; });
    const nw = (y) => dollarsToCents(s.path[y].netWorth);
    return {
        takeHome: netPerPayCents(d),
        savingsRate: s.savingsRate,
        savingsPerPay: s.savings.perPayCents, savingsPerYear: s.savings.perYearCents,
        savingsText: t('f.res.rateAmount', { n: Math.round(s.savingsRate * 10) / 10, amount: fmtMoney(s.savings.perPayCents / 100) }),
        required: plan.perGoal.length ? plan.requiredPerPayCents : null,
        short: plan.perGoal.length ? plan.gapCents : null,
        earnGap: plan.perGoal.length ? plan.options.earn.earnedCents : null,
        debts: (d.liabilities || []).reduce((a, l) => a + Math.max(0, dollarsToCents(l.balance)), 0),
        help: dollarsToCents(s.now.help),
        mojoBalance: mojo.length ? mojo.reduce((a, b) => a + b.balanceCents, 0) : null,
        fiYears: s.yearsToFI, fiNumber: dollarsToCents(s.fiNumber),
        nw1: nw(1), nw5: nw(5), nw10: nw(10), nw20: nw(20),
        perPay: Object.fromEntries(ROLES.map((r) => [r, per(r)])),
        goals: goalRows, smilePerPay: plan.smilePerPayCents,
        goalsCardRows: model ? model.rows.length : 0,
        path: s.path.map((p) => round2(p.fiNetWorth)),
        chart: projectNetWorth(view, { today: TODAY, years: 30 }).path.map((p) => round2(p.fiNetWorth)),
        explainFi: null, explainRate: null, explainTake: null,
        totals: totalsOf(d),
        buckets: bucketsOf(d, TODAY),
        _summary: s,
    };
}

// ---------- comparing ----------

/** Paths where two values differ (a short list of 'path: a != b'). */
export function diffPaths(a, b, path = '', out = []) {
    if (out.length > 40) return out;
    if (Object.is(a, b)) return out;
    if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) return out;
    if (isObj(a) && isObj(b)) {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], `${path}.${k}`, out);
        return out;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) { a.forEach((x, i) => diffPaths(x, b[i], `${path}[${i}]`, out)); return out; }
    out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    return out;
}

const VIRTUAL = ['scenarioOneOffs', 'scenarioGoalFunds'];
const ROW_COLLECTIONS = ['bucketGoals', 'liabilities', 'incomeSources', 'plan', 'assets'];

/** The data for comparison: virtual keys dropped, the ids of rows that were not in `base` made positional. */
export function normalised(d, base) {
    const x = clone(d);
    for (const k of VIRTUAL) delete x[k];
    // not read by any figure: the Salary sheet's layout fields (a Salary-layout save clears the hourly pair) and the not-modelled sacrifice flag
    for (const r of x.incomeSources || []) { delete r.hourlyRate; delete r.hoursPerWeek; delete r.salarySacrifice; }
    for (const key of ROW_COLLECTIONS) {
        const known = new Set((base[key] || []).map((r) => r && r.id));
        let n = 0;
        if (Array.isArray(x[key])) x[key].forEach((r) => { if (r && r.id && !known.has(r.id)) r.id = `new-${n++}`; });
    }
    return x;
}

/** The figures, A against B, as the list of rows that differ. */
export function figureDiffs(a, b, keys) {
    const out = [];
    for (const k of keys) { const d = diffPaths(a[k], b[k], k); out.push(...d); }
    return out;
}

export const COMPARED = ['takeHome', 'savingsRate', 'savingsPerPay', 'savingsPerYear', 'savingsText', 'required', 'short', 'earnGap', 'debts', 'help', 'mojoBalance', 'fiYears', 'fiNumber', 'nw1', 'nw5', 'nw10', 'nw20',
    'perPay', 'goals', 'smilePerPay', 'path', 'chart', 'totals'];

/** Everything for one case on one household: the data differences and the figure differences. */
export function runCase(makeData, c) {
    const d = makeData();
    const cases = casesFor(d);
    const cs = cases.find((x) => x.label === c.label);
    const resolved = resolveAt(d, cs.changes, TODAY);
    const edited = clone(d);
    cs.real(edited);
    const a = whatIfFigures(d, cs.changes);
    const b = appFigures(edited);
    const dataDiffs = diffPaths(normalised(resolved, d), normalised(edited, d), 'data');
    const figDiffs = figureDiffs(a, b, COMPARED);
    // the explain text is the app's own text on the edited data
    const explainDiffs = [];
    const s = b._summary;
    const wantFi = explainFi(edited, { summary: s }).map((l) => l.text);
    const gotFi = a.explainFi.slice(1); // line 0 is "Now x; scenario y"
    if (JSON.stringify(gotFi) !== JSON.stringify(wantFi)) explainDiffs.push(`explain FI: ${JSON.stringify(gotFi)} != ${JSON.stringify(wantFi)}`);
    // bucket rows (parents and goals) A against B, by name
    const bucketDiffs = diffPaths([...a.buckets].sort(byName), [...b.buckets].sort(byName), 'buckets');
    return { dataDiffs, figDiffs, explainDiffs, bucketDiffs, labelOf: cs.label };
}

// ---------- the cases ----------

const caseNames = (() => { seq = 0; return casesFor(sampleHousehold()).map((c) => ({ kind: c.kind, op: c.op, label: c.label })); })();

export const SCENARIO_EQUIVALENCE_TEST_CASES = [];
for (const [hhName, make] of Object.entries(HOUSEHOLDS)) {
    for (const c of caseNames) {
        SCENARIO_EQUIVALENCE_TEST_CASES.push({
            name: `H6 ${hhName}: ${c.kind} ${c.op} (${c.label}) gives the same figures in What If and in the app`,
            fn(assert) {
                const r = runCase(make, c);
                assert('data after the scenario equals the data after the real edit', r.dataDiffs, []);
                assert('every figure What If shows equals the app figure', r.figDiffs, []);
                assert('buckets (and goals) equal', r.bucketDiffs, []);
                assert('the FI explain lines equal the app', r.explainDiffs, []);
            },
        });
    }
}

SCENARIO_EQUIVALENCE_TEST_CASES.push({
    name: 'H6 the real data is never touched by the scenario',
    fn(assert) {
        for (const make of Object.values(HOUSEHOLDS)) {
            const d = make();
            const before = JSON.stringify(d);
            for (const c of casesFor(d)) buildResultSet(d, c.changes, TODAY, null);
            assert('data unchanged after every case', JSON.stringify(d) === before, true);
        }
    },
});

SCENARIO_EQUIVALENCE_TEST_CASES.push({
    name: 'H7 (FT-R-116) one savings figure: What If, the Future FI card and Today all show pay into saving buckets, with the amount',
    fn(assert) {
        for (const make of Object.values(HOUSEHOLDS)) {
            const d = make();
            const set = buildResultSet(d, [], TODAY, null);
            const s = fiSummary(withPeople(d), { today: TODAY });
            const want = savingsPlanned(d, { today: TODAY });
            assert('What If now = savingsPlanned', set.now.savings, want);
            assert('Future FI card = savingsPlanned', s.savings, want);
            assert('percent equals savingsRatePlanned', [set.now.savingsRate, s.savingsRate], [savingsRatePlanned(d, { today: TODAY }), want.ratePct]);
            const row = set.rows.find((x) => x.id === 'savingsRate');
            assert('the card text carries percent and amount a pay', row.now.text, t('f.res.rateAmount', { n: want.ratePct, amount: fmtMoney(want.perPayCents / 100) }));
            assert('the explain text carries the definition', explainLines(set, 'savingsRate').slice(1).join(' ').includes(t('f.res.ex.savingsDef')), true);
        }
        assert('the label text is the same words on What If and the Future card', t('f.res.row.savingsRate'), t('f.future.fi.rate'));
    },
});

SCENARIO_EQUIVALENCE_TEST_CASES.push({
    name: 'H7 (FT-R-116) a pay rise in What If: same savings percent, amount up by the save share of the extra take-home; Compare says so',
    fn(assert) {
        const d = sampleHousehold();
        const c = casesFor(d).find((x) => x.kind === 'income' && x.op === 'scale');
        const set = buildResultSet(d, c.changes, TODAY, null);
        const row = set.rows.find((x) => x.id === 'savingsRate');
        const dNet = set.scen.net - set.now.net;
        const saveShare = set.now.savings.perPayCents / set.now.net;
        assert('take-home rose', dNet > 0, true);
        assert('percent unchanged', set.scen.savings.ratePct, set.now.savings.ratePct);
        assert('amount rose by the save share of the extra take-home (a few cents of rounding)', Math.abs((set.scen.savings.perPayCents - set.now.savings.perPayCents) - dNet * saveShare) <= 3, true);
        assert('per year rose too', set.scen.savings.perYearCents > set.now.savings.perYearCents, true);
        assert('Compare diff is "same rate, ... more a pay" and the scenario is best', [diffOf(row).text.startsWith('same rate,'), diffOf(row).text.endsWith('more a pay'), bestOf(row)], [true, true, 'scen']);
        assert('the cards show the amount', row.scen.text.includes(' a pay') && row.now.text.includes(' a pay'), true);
    },
});
