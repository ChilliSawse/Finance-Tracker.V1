// Test cases for the "setup" group (Phase 1 step C7, registered in src/test-registry.js).
// C7.1 money steps; C7.2 registry; C7.3 quiz; C7.4 checklist; C7.5 engine-only figures and escaping.
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixtures are made up.

import { store } from '../state/store.js';
import { planTotals, netPerPayCents } from '../calc/plan.js';
import { addPlanItem } from '../state/plan.js';
import { registerSetupStep, getSetupSteps, getSetupStep, clearSetupSteps, unregisterSetupStep, STEP_ORDER } from './setup/registry.js';
import { quizQuestions, quizComplete, layoutForJob, layoutsFromAnswers, applyQuiz, answersFromData, renderQuiz, quizStep } from './setup/quiz.js';
import {
    moneyRows, moneySheetSpec, makeDebt, debtRows, setupDebtSheetSpec, renderMoney, renderDebts, essentialsStep, nonEssentialsStep, debtsStep,
} from './setup/steps-money.js';
import { splitModel, transfersModel, firstStep, modelStep, splitStep, transfersStep, onTemplateSplit } from './setup/steps-basic.js';
import { payReadout, renderPay, layoutStep } from './setup/steps-pay.js';
import { savePlanItem } from './plan-lists.js';
import {
    readSetupState, writeSetupState, markStep, startSetupState, checklistItems, checklistVisible, checklistHtml,
} from './setup/checklist.js';
import { withholdingForPay } from '../calc/withholding.js';
import { applySuggestedSplit } from '../state/saving-model.js';

const TODAY = '2026-11-21';
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => {
    const d = clone(store.financeData);
    d.incomeSources[0].name = 'My job';
    d.incomeSources[0].grossAnnual = 84500;
    d.incomeSources[0].paySchedule = 'fortnightly';
    d.incomeSources[0].payAnchor = '2026-11-14';
    return d;
};
const memStore = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};
const mkCtx = (data, extra = {}) => ({ data, today: TODAY, state: {}, save() {}, refresh() {}, finish(o) { this.finished = o; }, ...extra });
const noop = () => {};

export const SETUP_TEST_CASES = [
    {
        name: 'C7.1 money steps: essentials and non-essentials write plan items, debts write liabilities, skipping writes nothing',
        fn(assert) {
            const d = fresh();
            const before = JSON.stringify(d);

            // skipping a step is not calling its onNext: rendering every step leaves the data as it was
            const ctx = mkCtx(d);
            [essentialsStep, nonEssentialsStep, debtsStep, modelStep, splitStep, transfersStep, firstStep, layoutStep].forEach((s) => s.render(ctx));
            renderPay(ctx);
            assert('rendering every step changes nothing', JSON.stringify(d), before);

            // essentials: the sheet only offers essential categories, bills carry a due date
            const spec = moneySheetSpec(d, 'essential');
            const catField = spec.fields.find((f) => f.key === 'categoryId');
            const cats = new Map(d.categories.map((c) => [c.id, c]));
            assert('essential sheet offers only essential categories', catField.options.every((o) => cats.get(o.value).essential), true);
            const nonSpec = moneySheetSpec(d, 'non');
            assert('non-essential sheet offers only non-essential categories',
                nonSpec.fields.find((f) => f.key === 'categoryId').options.every((o) => !cats.get(o.value).essential), true);
            assert('a quick-start fills the name and category', moneySheetSpec(d, 'essential', null, { name: 'Rent', categoryId: 'housing' }).values.categoryId, 'housing');

            const rent = savePlanItem(d, null, { name: 'Rent', amount: 1120, frequency: 'fortnightly', categoryId: 'housing', isBill: true, anchorDue: '2026-11-24', inTotals: true }, { kind: 'essential' });
            const groc = savePlanItem(d, null, { name: 'Groceries', amount: 240, frequency: 'weekly', categoryId: 'groceries', isBill: false, anchorDue: '', inTotals: true }, { kind: 'essential' });
            const fun = savePlanItem(d, null, { name: 'Netflix', amount: 20, frequency: 'monthly', categoryId: 'entertainment', isBill: false, anchorDue: '', inTotals: true }, { kind: 'non' });
            assert('essentials were written through addPlanItem', [rent.ok, groc.ok, fun.ok], [true, true, true]);
            assert('plan items have ids', d.plan.every((p) => typeof p.id === 'string' && p.id.length > 0), true);
            assert('a bill carries its due date', d.plan.find((p) => p.name === 'Rent').anchorDue, '2026-11-24');
            assert('essential list is by the category flag', moneyRows(d, 'essential').map((p) => p.name), ['Rent', 'Groceries']);
            assert('non-essential list is by the category flag', moneyRows(d, 'non').map((p) => p.name), ['Netflix']);
            const pt = planTotals(d);
            assert('the readout total is the engine total', renderMoney(mkCtx(d), 'essential').includes(pt.essentialPerCycle.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), true);

            // the split step's totals equal planTotals
            const m = splitModel(d, TODAY);
            assert('split essentials equal planTotals', m.essentialCents, Math.round(pt.essentialPerCycle * 100));
            assert('split non-essentials equal planTotals', m.nonEssentialCents, Math.round(pt.nonEssentialPerCycle * 100));
            assert('split net equals the engine net', m.netCents, netPerPayCents(d));
            assert('split rows plus left to place equal the net', m.rows.reduce((s, r) => s + r.perPayCents, 0) + m.leftCents, m.netCents);
            assert('preview of the suggestion writes nothing', onTemplateSplit(d), true);
            const copy = clone(d);
            applySuggestedSplit(copy);
            assert('the previewed daily share is the suggestion', m.rows.find((r) => r.role === 'daily').pct, copy.allocation.find((a) => a.role === 'daily').percentage);
            const saved = clone(d);
            assert('Next on the split step saves the suggestion', splitStep.onNext(mkCtx(saved)), true);
            assert('and the template is gone', onTemplateSplit(saved), false);

            // debts: a liability with an id, balance, rate and minimum; the untouched placeholder row goes
            const e = fresh();
            assert('starts with the placeholder liability', e.liabilities.length, 1);
            assert('the placeholder is not a debt', debtRows(e).length, 0);
            const card = makeDebt(e, { name: 'Credit card', balance: 1200, interestRate: 21.99, minRepayment: 35 });
            assert('debt has an id, balance, rate and minimum', [typeof card.id, card.balance, card.interestRate, card.minRepayment], ['string', 1200, 21.99, 35]);
            const card2 = makeDebt(e, { name: 'Credit card', balance: 50 });
            assert('ids are unique', card.id !== card2.id, true);
            assert('the placeholder was replaced', e.liabilities.map((l) => l.name), ['Credit card', 'Credit card']);
            assert('debt sheet needs a name and balance', Object.keys(setupDebtSheetSpec().validate({ name: '', balance: null })).sort(), ['balance', 'name']);
            assert('debts render lists them', renderDebts(mkCtx(e)).includes('Credit card'), true);
        },
    },
    {
        name: 'C7.2 step registry: order, default steps and E8 replacement',
        fn(assert) {
            clearSetupSteps();
            const mk = (id, order, over = {}) => ({ id, order, title: id, render: () => id, ...over });
            registerSetupStep(mk('b', 20));
            registerSetupStep(mk('a', 10));
            registerSetupStep(mk('c', 20));
            assert('steps come back in order, ties in registration order', getSetupSteps().map((s) => s.id), ['a', 'b', 'c']);
            assert('a default does not replace a step already there', registerSetupStep(mk('a', 5, { title: 'x' }), { defaultOnly: true }), false);
            assert('and the original stays', getSetupStep('a').order, 10);
            registerSetupStep(mk('model', 1, { title: 'default model' }), { defaultOnly: true });
            registerSetupStep(mk('model', 1, { title: 'E8 model' }));
            assert('a normal registration replaces a default', getSetupStep('model').title, 'E8 model');
            registerSetupStep(mk('split', 3, { title: 'E8 split' }));
            assert('a default never beats E8 whatever the load order', registerSetupStep(mk('split', 3, { title: 'default split' }), { defaultOnly: true }), false);
            let threw = 0;
            [{}, { id: 'x' }, { id: 'x', order: 1 }, { id: 'x', order: 1, render() {} }].forEach((bad) => { try { registerSetupStep(bad); } catch (e) { threw += 1; } });
            assert('an incomplete step is refused', threw, 4);
            assert('remove works', unregisterSetupStep('a'), true);
            assert('the planned order is model, quiz, layout, pay, essentials, non-essentials, debts, split, transfers, first',
                Object.entries(STEP_ORDER).sort((x, y) => x[1] - y[1]).map((x) => x[0]),
                ['model', 'quiz', 'layout', 'pay', 'essentials', 'nonEssentials', 'debts', 'split', 'transfers', 'first']);
            clearSetupSteps();
        },
    },
    {
        name: 'C7.3 quiz: questions, layouts, writing the answers, escaping',
        fn(assert) {
            assert('first question is the number of jobs', quizQuestions({}).map((q) => q.id), ['jobs']);
            assert('one payslip job on a set salary', quizQuestions({ jobs: 'one', how0: 'payslip', same0: 'yes' }).map((q) => q.id), ['jobs', 'how0', 'same0']);
            assert('hours ask whether they change', quizQuestions({ jobs: 'one', how0: 'payslip', same0: 'no' }).map((q) => q.id), ['jobs', 'how0', 'same0', 'hours0']);
            assert('invoicing skips the pay questions', quizQuestions({ jobs: 'one', how0: 'invoice' }).map((q) => q.id), ['jobs', 'how0']);
            assert('two jobs repeat the questions', quizQuestions({ jobs: 'many', how0: 'app', how1: 'payslip' }).map((q) => q.id), ['jobs', 'how0', 'how1', 'same1']);
            assert('complete when every question is answered', quizComplete({ jobs: 'one', how0: 'payslip', same0: 'yes' }), true);
            assert('not complete otherwise', quizComplete({ jobs: 'one', how0: 'payslip' }), false);
            const L = (a, i = 0) => layoutForJob(a, i);
            assert('set salary is Salary', L({ how0: 'payslip', same0: 'yes' }), 'salary');
            assert('set hours is Set hours', L({ how0: 'payslip', same0: 'no', hours0: 'set' }), 'hours');
            assert('changing hours is Shifts', L({ how0: 'payslip', same0: 'no', hours0: 'change' }), 'shifts');
            assert('invoices and apps are Business', [L({ how0: 'invoice' }), L({ how0: 'app' })], ['business', 'business']);
            assert('layouts per job', layoutsFromAnswers({ jobs: 'many', how0: 'payslip', same0: 'yes', how1: 'invoice' }), ['salary', 'business']);

            // writing the answers: keeps entered figures, adds a source, second job asks about the threshold
            const d = fresh();
            applyQuiz(d, { jobs: 'many', how0: 'payslip', same0: 'yes', how1: 'invoice' });
            assert('two sources', d.incomeSources.length, 2);
            assert('the first job keeps its pay', [d.incomeSources[0].grossAnnual, d.incomeSources[0].name], [84500, 'My job']);
            assert('Business uses the self-employed editor type', [d.incomeSources[1].incomeType, d.incomeSources[1].basis], ['selfEmployed', 'selfEmployed']);
            assert('a second job does not claim the threshold', d.incomeSources[1].withholding.claimsTaxFree, false);
            const shifts = fresh();
            applyQuiz(shifts, { jobs: 'one', how0: 'payslip', same0: 'no', hours0: 'change' });
            assert('Shifts use the variable editor type', [shifts.incomeSources[0].incomeType, Array.isArray(shifts.incomeSources[0].incomeEvents)], ['variable', true]);
            const untouched = fresh();
            untouched.incomeSources[0].name = 'New Income Source';
            applyQuiz(untouched, { jobs: 'one', how0: 'payslip', same0: 'yes' });
            assert('the placeholder source name becomes My job', untouched.incomeSources[0].name, 'My job');
            const hrs = fresh();
            hrs.incomeSources[0].hourlyRate = 40; hrs.incomeSources[0].hoursPerWeek = 30;
            assert('answers describe saved hours', answersFromData(hrs), { jobs: 'one', how0: 'payslip', same0: 'no', hours0: 'set' });

            // the step: Next walks the questions, Back walks them back, nothing is written until the last
            const walk = fresh();
            const before = JSON.stringify(walk);
            const ctx = mkCtx(walk);
            ctx.state.quiz = { answers: {}, qi: 0 };
            assert('blocks Next with nothing picked', typeof quizStep.validate(ctx), 'string');
            ctx.state.quiz = { answers: { jobs: 'one', how0: 'payslip', same0: 'yes' }, qi: 0 };
            assert('Next on the first question stays on the quiz', quizStep.onNext(ctx), false);
            assert('and nothing was written', JSON.stringify(walk), before);
            assert('Back on the second question stays on the quiz', quizStep.onBack(ctx), false);
            assert('Back on the first leaves the quiz', quizStep.onBack(ctx), true);
            ctx.state.quiz.qi = 2;
            assert('Next on the last question finishes the step', quizStep.onNext(ctx), true);
            assert('the layouts are kept for the pay step', ctx.state.quiz.layouts, ['salary']);

            // escaping
            const evil = fresh();
            evil.incomeSources[0].name = '<img src=x onerror=alert(1)>';
            const html = renderQuiz(mkCtx(evil, { state: { quiz: { answers: { jobs: 'one' }, qi: 1 } } }));
            assert('a hostile job name is escaped in the quiz', html.includes('<img'), false);
            assert('and in the pay step', layoutStep.render(mkCtx(evil)).includes('<img'), false);
        },
    },
    {
        name: 'C7.4 checklist: starts only for a started setup, derives from data, stays until done',
        fn(assert) {
            const d = fresh();
            const s = memStore();
            assert('no state, no checklist (an existing user never sees one)', checklistVisible(readSetupState(s), checklistItems(d, readSetupState(s)), {}), false);
            startSetupState(s);
            const st = readSetupState(s);
            assert('state starts empty', st, { completed: [], skipped: [], notNeeded: [], dismissed: false });
            let items = checklistItems(d, st, { hasTxns: false });
            assert('pay is done from the data', items.find((i) => i.id === 'pay').done, true);
            assert('essentials are not', items.find((i) => i.id === 'essentials').done, false);
            assert('visible while anything is left', checklistVisible(st, items, {}), true);
            addPlanItem(d, { name: 'Rent', categoryId: 'housing', amount: 1000, frequency: 'monthly' });
            addPlanItem(d, { name: 'Netflix', categoryId: 'entertainment', amount: 20, frequency: 'monthly' });
            makeDebt(d, { name: 'Card', balance: 100 });
            markStep(s, 'split', 'completed');
            markStep(s, 'transfers', 'skipped');
            items = checklistItems(d, readSetupState(s), { hasTxns: false });
            assert('plan items and debts count as done', ['essentials', 'nonEssentials', 'debts', 'split'].map((id) => items.find((i) => i.id === id).done), [true, true, true, true]);
            assert('a skipped step is still to do', items.find((i) => i.id === 'transfers'), { id: 'transfers', label: 'Set up your bank transfers', done: false, skipped: true, notNeeded: false });
            assert('first expense is only done by a transaction', items.find((i) => i.id === 'first').done, false);
            const stNeed = readSetupState(s);
            stNeed.notNeeded.push('transfers');
            items = checklistItems(d, stNeed, { hasTxns: true });
            assert('done once everything is done or not needed', checklistVisible(stNeed, items, {}), false);
            assert('hidden for the sample household', checklistVisible(st, checklistItems(d, st), { sample: true }), false);
            assert('hidden when dismissed', checklistVisible({ ...st, dismissed: true }, checklistItems(d, st), {}), false);
            writeSetupState(s, { completed: 'x', skipped: [1, 'a'], notNeeded: null, dismissed: 'yes' });
            assert('a damaged state reads safely', readSetupState(s), { completed: [], skipped: ['a'], notNeeded: [], dismissed: false });
            const html = checklistHtml(checklistItems(d, st, {}));
            assert('the list offers a way back into each open step', html.includes('data-su-resume="essentials"') || html.includes('data-su-resume="transfers"'), true);
        },
    },
    {
        name: 'C7.5 closing step, readouts and the mock figures come from the engine',
        fn(assert) {
            const ctx = mkCtx(fresh());
            firstStep.actions.logExpense(ctx);
            assert('the closing step offers Quick-add', ctx.finished, { then: 'quick-add' });
            firstStep.actions.importStatement(ctx);
            assert('and the import', ctx.finished, { then: 'import' });
            assert('Done goes to Today', (firstStep.onNext(ctx), ctx.finished), { then: 'today' });
            assert('the title says what to do', firstStep.title, 'Log your first expense or import a statement');
            assert('the model step names the Bucket method, with its source', [modelStep.render().includes('Bucket method'), modelStep.render().includes('Scott Pape')], [true, true]);
            assert('the model step never uses Barefoot as a name', modelStep.render().replace('The Barefoot Investor', '').includes('Barefoot'), false);
            assert('the model step cannot be skipped', modelStep.skippable, false);

            const d = fresh();
            const r = payReadout(d, TODAY);
            assert('pay readout net is the engine net', r.netCents, netPerPayCents(d));
            assert('pay readout next pay day is from the anchor', r.nextPay, '2026-11-28');
            assert('no pay, no readout', payReadout({ ...d, incomeSources: [{ incomeType: 'salaried', paySchedule: 'fortnightly', grossAnnual: 0 }] }, TODAY).hasPay, false);
            assert('pay step shows the engine take-home', renderPay(mkCtx(d)).includes((r.netCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })), true);
            const noAnchor = fresh();
            noAnchor.incomeSources[0].payAnchor = null;
            assert('no pay day offers to set it', renderPay(mkCtx(noAnchor)).includes('Set your pay day'), true);

            // the mock's A$651, A$101 and A$752 re-run through the engine (gross A$3,250.43 a fortnight, claims the threshold)
            const noHelp = withholdingForPay({ gross: 3250.43, cycle: 'fortnightly', fy: '2026-11-21', claimsTaxFree: true, hasStudyDebt: false, extraPerPay: 0 });
            const help = withholdingForPay({ gross: 3250.43, cycle: 'fortnightly', fy: '2026-11-21', claimsTaxFree: true, hasStudyDebt: true, extraPerPay: 0 });
            assert('engine tax is a number, not the mock literal', Number.isFinite(noHelp.tax) && noHelp.tax !== 651, true);
            assert('engine HELP is a number, not the mock literal', Number.isFinite(help.help) && help.help !== 101, true);
            assert('engine total is tax plus HELP', Math.round((help.tax + help.help) * 100), Math.round(help.total * 100));
            assert('no setup source file holds the mock figures as literals',
                [renderPay.toString(), splitModel.toString(), payReadout.toString()].every((s) => !/\b(651|752)\b/.test(s)), true);
            assert('transfers list excludes Daily and ticks nothing before the bank is set', transfersModel(fresh()).transfers.map((x) => x.ticked), [false, false, false]);
            assert('Daily stays in the spending account', transfersModel(fresh()).stay.name, 'Daily expenses');
            assert('debts is skippable, quiz is skippable', [debtsStep.skippable !== false, quizStep.skippable !== false], [true, true]);
            noop();
        },
    },
];
