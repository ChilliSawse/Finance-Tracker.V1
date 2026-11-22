// Test cases for the "activity" group (A7.1 to A7.3, registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixture: fake household, integer cents.

import { buildTodayModel, buildActivityFeed } from '../state/today-model.js';
import { buildActivityView, renderListHtml, renderSummaryHtml, renderWhereHtml, matchesQuery, dayLabel } from './activity.js';

const ALLOC = [
    { id: 'daily', role: 'daily', name: 'Daily expenses', percentage: 60 }, { id: 'splurge', role: 'splurge', name: 'Splurge', percentage: 10 },
    { id: 'smile', role: 'smile', name: 'Smile', percentage: 10 }, { id: 'fire', role: 'fire', name: 'Fire', percentage: 20 },
];
const CATS = [
    { id: 'groceries', name: 'Groceries', essential: true }, { id: 'rent', name: 'Rent', essential: true },
    { id: 'entertainment', name: 'Entertainment', essential: false }, { id: 'subscriptions', name: 'Subscriptions', essential: false },
    { id: 'other', name: 'Other', essential: false }, { id: 'income', name: 'Income', essential: false },
];
const PLAN = [
    { id: 'nfx', categoryId: 'subscriptions', name: 'Netflix', amount: 16.99, frequency: 'monthly', anchorDue: '2026-10-11', inTotals: false },
    { id: 'rentp', categoryId: 'rent', name: 'Rent', amount: 1120, frequency: 'monthly', anchorDue: '2026-10-02', inTotals: false },
];
const DATA = {
    dataVersion: 2, incomeSources: [{ incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: '2026-10-31' }],
    primaryIncomeIndex: 0, allocation: ALLOC, categories: CATS, plan: PLAN,
};
const out = (date, categoryId, dollars, extra = {}) => ({ id: `${date}-${categoryId}-${dollars}`, date, categoryId, description: `Shop ${categoryId}`, amountCents: Math.round(-dollars * 100), source: 'csv', ...extra });
const ROWS = [
    { id: 'pay', date: '2026-10-31', categoryId: 'income', description: 'Salary', amountCents: 343843, source: 'csv' },
    out('2026-11-02', 'rent', 1120, { id: 'rent1', description: 'Ray White', billMatch: { planId: 'rentp', dueDate: '2026-11-02' } }),
    out('2026-11-02', 'entertainment', 24, { id: 'hoyts', description: 'Hoyts', bucketId: 'splurge' }),
    out('2026-11-03', 'groceries', 40, { id: 'g1', description: 'Woolworths', bucketId: 'daily' }),
    out('2026-11-04', 'other', 32, { id: 'mkt', description: '<b>MARKET</b>', status: 'review' }),
    out('2026-11-04', 'groceries', 10, { id: 'man', description: 'Milk', source: 'manual' }),
];
const TODAY = '2026-11-04';
const build = (over = {}) => {
    const feed = buildActivityFeed({ data: DATA, rows: ROWS, today: TODAY });
    const model = buildTodayModel({ data: DATA, rows: ROWS, today: TODAY });
    return buildActivityView({ feed, model, data: DATA, today: TODAY, ...over });
};
const flat = (v) => v.days.flatMap((d) => d.items);
const byId = (v, id) => flat(v).find((d) => d.id === id);
const labels = (d) => d.pills.map((p) => p.key);

export const ACTIVITY_TEST_CASES = [
    {
        name: 'A7.1 statuses come from the row and bill state, none typed',
        fn(assert) {
            const v = build();
            assert('review row has the review pill and a choose action', [labels(byId(v, 'mkt')), byId(v, 'mkt').action.label], [['review'], 'Choose a category']);
            assert('bill-matched row is matched', labels(byId(v, 'rent1')), ['matched']);
            assert('manual override to Splurge is covered', labels(byId(v, 'hoyts')), ['covered']);
            assert('covered label names the bucket', byId(v, 'hoyts').pills[0].label, 'Covered from Splurge');
            assert('a row moved to Daily is not covered', byId(v, 'g1').pills, []);
            assert('plain rows have no pill', byId(v, 'man').pills, []);
            assert('review count from data', v.chips.find((c) => c.id === 'review').count, 1);
            assert('review box', [v.reviewBox.count, v.reviewBox.items[0].id], [1, 'mkt']);
            assert('covered box lists only the override', v.coveredBox.items.map((d) => d.id), ['hoyts']);
            const clean = buildActivityView({
                feed: buildActivityFeed({ data: DATA, rows: ROWS.filter((r) => r.id !== 'mkt' && r.id !== 'hoyts'), today: TODAY }),
                model: buildTodayModel({ data: DATA, rows: ROWS, today: TODAY }), data: DATA, today: TODAY });
            assert('boxes hide when empty', [clean.reviewBox, clean.coveredBox], [null, null]);
        },
    },
    {
        name: 'A7.2 coming up, bill pills, day totals and filters',
        fn(assert) {
            const v = build();
            const nfx = v.coming.items.find((d) => d.name === 'Netflix');
            assert('upcoming bill pill carries date and days', nfx.pills[0].label, 'Wed 11 Nov \u00b7 in 7 days');
            assert('coming total is the unpaid bills', v.coming.totalCents, v.coming.items.reduce((a, d) => a - d.amountCents, 0));
            assert('bills still to come are not repeated in day groups', flat(v).some((d) => d.kind === 'bill'), false);
            assert('day total counts money out only', v.days.find((d) => d.date === '2026-11-04').spentCents, 4200);
            assert('days newest first', v.days.map((d) => d.date), ['2026-11-04', '2026-11-03', '2026-11-02', '2026-10-31']);
            assert('pay day heading', v.days.find((d) => d.date === '2026-10-31').label, 'Sat 31 Oct, pay day');
            assert('today heading', v.days[0].label, 'Today, Wed 4 Nov');
            assert('review filter', flat(build({ filter: 'review' })).map((d) => d.id), ['mkt']);
            assert('income filter', flat(build({ filter: 'income' })).map((d) => d.id), ['pay']);
            assert('bills filter keeps the matched row', flat(build({ filter: 'bills' })).map((d) => d.id), ['rent1']);
            assert('essential filter', flat(build({ filter: 'essential' })).map((d) => d.id).sort(), ['g1', 'man', 'rent1']);
            assert('non-essential filter', flat(build({ filter: 'nonessential' })).map((d) => d.id).sort(), ['hoyts', 'mkt']);
            assert('review hides coming up', build({ filter: 'review' }).coming.items.length, 0);
            assert('search by payee', flat(build({ query: 'hoyts' })).map((d) => d.id), ['hoyts']);
            assert('search by amount', flat(build({ query: '1120' })).map((d) => d.id), ['rent1']);
            assert('search by category', flat(build({ query: 'groceries' })).map((d) => d.id).sort(), ['g1', 'man']);
            assert('matchesQuery empty', matchesQuery({ name: 'x', cat: { name: 'y' }, amountCents: -100 }, ''), true);
            assert('dayLabel', dayLabel('2026-11-04'), 'Wed 4 Nov');
        },
    },
    {
        name: 'A7.3 figures come from the model and every data string is escaped',
        fn(assert) {
            const v = build();
            const model = buildTodayModel({ data: DATA, rows: ROWS, today: TODAY });
            assert('left is the model figure', v.summary.leftCents, model.leftCents);
            assert('money in is the pay row', v.summary.inCents, 343843);
            assert('where total is all spending', v.where.totalCents, 112000 + 2400 + 4000 + 3200 + 1000);
            assert('unsorted spend is the Other row', v.where.unsortedCents, 3200);
            const html = renderListHtml(v) + renderSummaryHtml(v) + renderWhereHtml(v);
            assert('no raw tag from a description', html.includes('<b>MARKET</b>'), false);
            assert('escaped form is present', html.includes('&lt;b&gt;MARKET&lt;/b&gt;'), true);
            assert('review button carries the id', renderListHtml(v).includes('data-act-edit="mkt"'), true);
            const D0 = { ...DATA, plan: [] };
            const empty = buildActivityView({ feed: buildActivityFeed({ data: D0, rows: [], today: TODAY }), model: buildTodayModel({ data: D0, rows: [], today: TODAY }), data: D0, today: TODAY });
            assert('empty state', empty.empty, true);
        },
    },
    {
        name: 'H9.1 a transfer row: where it went, suggested until confirmed, kept out of spending',
        fn(assert) {
            const xr = (id, extra) => ({ id, date: '2026-11-03', categoryId: 'transfer', description: 'To ' + id, amountCents: -50000, source: 'csv', ...extra });
            const rows = [...ROWS, xr('plain', { bucketId: 'fire' }), xr('sug', { bucketId: 'smile', bucketSuggested: true, status: 'review' }), xr('none', {}), xr('stale', { bucketId: 'gone' })];
            const feed = buildActivityFeed({ data: DATA, rows, today: TODAY });
            const model = buildTodayModel({ data: DATA, rows, today: TODAY });
            const v = buildActivityView({ feed, model, data: DATA, today: TODAY });
            const p = (id) => byId(v, id).pills;
            assert('confirmed: Went to Fire, no action', [p('plain').map((x) => x.label), byId(v, 'plain').action], [['Went to Fire'], null]);
            assert('suggested: marked suggested, in To review with a one-tap Confirm', [p('sug').map((x) => x.label), byId(v, 'sug').action.confirm, byId(v, 'sug').action.label, byId(v, 'sug').review],
                [['To review', 'Went to Smile (suggested)'], true, 'Confirm', true]);
            assert('no bucket or a stale one: not marked, with a way to choose', [p('none').map((x) => x.label), byId(v, 'none').action.label, p('stale').map((x) => x.label)],
                [['Not marked to a bucket'], 'Choose where it went', ['Not marked to a bucket']]);
            assert('named Transfer, between your accounts', [byId(v, 'plain').cat.name, byId(v, 'plain').kindText], ['Transfer', 'between your accounts']);
            assert('not a covered row', byId(v, 'plain').covered, null);
            assert('To review lists the suggested one', v.reviewBox.items.some((d) => d.id === 'sug'), true);
            assert('and its box says what to do about a guessed bucket', renderSummaryHtml(v).includes('where the app guessed the bucket'), true);
            assert('without one the box keeps its old wording', renderSummaryHtml(build()).includes('These have no category yet.'), true);
            const day = v.days.find((d) => d.date === '2026-11-03');
            assert('the day total ignores transfers', day.spentCents, 4000);
            assert('essential and non-essential filters leave transfers out', [build({ filter: 'nonessential' }).days.flatMap((d) => d.items).some((d) => d.cat.transfer), buildActivityView({ feed, model, data: DATA, today: TODAY, filter: 'nonessential' }).days.flatMap((d) => d.items).some((d) => d.cat.transfer)], [false, false]);
            const html = renderListHtml(v);
            assert('the Confirm button is its own tap target, labelled for a screen reader', [html.includes('data-act-confirm="sug"'), html.includes('Confirm that To sug went to Smile')], [true, true]);
            assert('a confirmed row has no Confirm button', html.includes('data-act-confirm="plain"'), false);
        },
    },
];
