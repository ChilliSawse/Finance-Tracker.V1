// Test cases for the "review" group (E9). Pure: the model, the HTML and the state marker. Sample = the B5 engine-built household.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { buildSampleHousehold } from '../state/sample-data.js';
import { reviewModel, reviewHtml, dueCardHtml, reviewDueFor, markReviewOpened, monthOptions, reviewMonthLabel } from './review.js';

const TODAY = '2026-11-21';
const MONTH = '2026-10';
const house = () => buildSampleHousehold(TODAY);
const spendOf = (rows, month) => {
    const m = new Map();
    rows.filter((r) => r.date.startsWith(month) && r.amountCents < 0).forEach((r) => m.set(r.categoryId, (m.get(r.categoryId) || 0) - r.amountCents));
    return m;
};
const has = (s, part) => s.includes(part);

export const REVIEW_TEST_CASES = [
    { name: 'E9.1 the four blocks render for the sample household', fn(assert) {
        const { data, rows } = house();
        const model = reviewModel(data, MONTH, spendOf(rows, MONTH), TODAY);
        const h = reviewHtml(model, { options: monthOptions(TODAY) });
        assert('four cards', [has(h, 'id="rv-h-spend"'), has(h, 'id="rv-h-move"'), has(h, 'id="rv-h-targets"'), has(h, 'id="rv-h-xfer"')], [true, true, true, true]);
        assert('the title names the month', has(h, 'October 2026 review'), true);
        assert('spending total matches the rows', model.spending.totalCents, model.spending.essentialCents + model.spending.nonEssentialCents);
        assert('spending has figures', model.spending.totalCents > 0, true);
        assert('the picker lists the previous month first', monthOptions(TODAY).slice(0, 2), ['2026-10', '2026-09']);
        assert('the picker marks the month', has(h, '<option value="2026-10" selected>October 2026</option>'), true);
        assert('Mojo and a Smile goal are in targets', [has(h, 'Mojo'), has(h, 'Bali trip')], [true, true]);
    } },
    { name: 'E9.2 movements are labelled planned when auto-credit is off', fn(assert) {
        const { data, rows } = house();
        data.savingModel.autoCredit = { on: false, rolledThrough: null };
        const model = reviewModel(data, MONTH, spendOf(rows, MONTH), TODAY);
        const h = reviewHtml(model, {});
        assert('planned flag and pays', [model.movements.planned, model.movements.pays > 0], [true, true]);
        assert('the Planned tag shows', has(h, 'rv-tag') && has(h, '>Planned<'), true);
        data.savingModel.autoCredit = { on: true, rolledThrough: null };
        const on = reviewHtml(reviewModel(data, MONTH, spendOf(rows, MONTH), TODAY), {});
        assert('no tag when auto-credit is on', has(on, 'rv-tag'), false);
    } },
    { name: 'E9.3 transfers read bankSetTo from savingModel.transfers', fn(assert) {
        const { data, rows } = house();
        const first = data.allocation.find((r) => r.role === 'splurge') || data.allocation[1];
        data.savingModel.transfers = { bankSetTo: { [String(first.id)]: 1 }, hiddenFor: null };
        const model = reviewModel(data, MONTH, spendOf(rows, MONTH), TODAY);
        assert('the stale row is listed with its old amount', model.transfers.some((r) => r.bucketId === String(first.id) && r.wasCents === 1), true);
        data.savingModel.transfers.bankSetTo = null;
        assert('an unseeded card is empty and says so', [reviewModel(data, MONTH, new Map(), TODAY).transfers.length, has(reviewHtml(reviewModel(data, MONTH, new Map(), TODAY), {}), 'match your split')], [0, true]);
    } },
    { name: 'E9.4 opening sets review.lastOpenedMonth, only forward; the Today card follows reviewDue', fn(assert) {
        const { data } = house();
        const opts = { hasTransactions: ['2026-10'] };
        assert('due on the 1st', reviewDueFor(data, '2026-11-01', opts), '2026-10');
        assert('not due on the last day of the month', reviewDueFor(data, '2026-10-31', opts), null);
        assert('opening writes the marker', [markReviewOpened(data, '2026-10'), data.savingModel.review.lastOpenedMonth], [true, '2026-10']);
        assert('then it is no longer due', reviewDueFor(data, '2026-11-01', opts), null);
        assert('an older month does not move it back', [markReviewOpened(data, '2026-08'), data.savingModel.review.lastOpenedMonth], [false, '2026-10']);
        assert('the card names the month and opens it', [has(dueCardHtml('2026-10'), 'October 2026 review is ready'), has(dueCardHtml('2026-10'), 'data-month="2026-10"'), dueCardHtml(null)], [true, true, '']);
        assert('label of a bad month is empty', reviewMonthLabel('nope'), '');
    } },
    { name: 'E9.5 data is escaped', fn(assert) {
        const { data, rows } = house();
        data.allocation[0].name = '<img src=x onerror=alert(1)>';
        data.savingModel.transfers = { bankSetTo: { [String(data.allocation[0].id)]: 1 }, hiddenFor: null };
        data.savingModel.autoCredit = { on: false, rolledThrough: null };
        const h = reviewHtml(reviewModel(data, MONTH, spendOf(rows, MONTH), TODAY), {});
        assert('no raw tag', has(h, '<img'), false);
        assert('the escaped text is there', has(h, '&lt;img'), true);
    } },
];
