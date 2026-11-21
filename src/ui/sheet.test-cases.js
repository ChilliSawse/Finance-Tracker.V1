// Test cases for the "sheet" group (registered in src/test-registry.js).
// D1.1 to D1.5 (plan section 12). The pure parts run in Node and in tests.html;
// the cases that need a DOM only run when `document` exists (tests.html).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    weeklyAmountRule, hoursRule, bucketTotalRule, runPlausibility,
    createSheetModel, coerceFieldValue, noteSig, removeAt, deleteWithUndo,
} from './sheet.js';
import { createToastQueue } from './toast.js';
import { openSheet } from './sheet.js';
import { toastKindForModal, showCustomModal, confirmDialog } from './confirm.js';

const HAS_DOM = typeof document !== 'undefined';

// A fake clock and a recording view, so the toast queue is tested without a DOM.
function fakeQueue() {
    let now = 0, nextId = 1;
    const timers = new Map();
    const shown = [];
    let hidden = 0;
    const queue = createToastQueue({
        view: { show: (e) => shown.push(e.message), hide: () => { hidden++; } },
        setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimer: (id) => timers.delete(id),
        now: () => now,
    });
    const tick = (ms) => {
        now += ms;
        for (const [id, tm] of [...timers]) if (tm.at <= now) { timers.delete(id); tm.fn(); }
    };
    return { queue, tick, shown, hiddenCount: () => hidden, timerCount: () => timers.size };
}

const SAMPLE_PLAN = [
    { id: 'a', name: 'Rent', amount: 1120 },
    { id: 'b', name: 'Netflix', amount: 22.99 },
    { id: 'c', name: 'Gym', amount: 15 },
];

export const SHEET_TEST_CASES = [
    {
        name: 'D1.1 plausibility',
        fn(assert) {
            const rent = weeklyAmountRule({ field: 'amount', frequencyField: 'frequency' });
            const flagged = runPlausibility([rent], { amount: 7000, frequency: 'weekly' });
            assert('weekly rent A$7,000 is flagged', flagged.map((n) => n.field), ['amount']);
            assert('flag carries a message', typeof flagged[0].message === 'string' && flagged[0].message.length > 0, true);
            assert('A$700 a week is fine', runPlausibility([rent], { amount: 700, frequency: 'weekly' }), []);
            assert('A$7,000 a month is about A$1,615 a week: fine', runPlausibility([rent], { amount: 7000, frequency: 'monthly' }), []);
            assert('A$11,000 a fortnight is flagged', runPlausibility([rent], { amount: 11000, frequency: 'fortnightly' }).length, 1);

            const hours = hoursRule({ field: 'hours' });
            assert('81 hours a week is flagged', runPlausibility([hours], { hours: 81 }).map((n) => n.field), ['hours']);
            assert('80 hours a week is not', runPlausibility([hours], { hours: 80 }), []);
            assert('38 hours is fine', runPlausibility([hours], { hours: 38 }), []);

            const buckets = bucketTotalRule({ fields: ['daily', 'splurge', 'smile', 'fire'], smileField: 'smile' });
            const under = { daily: 60, splurge: 10, smile: 5, fire: 20 };
            const notes = runPlausibility([buckets], under);
            assert('buckets at 95 are flagged', notes.length, 1);
            assert('the fix is offered', !!notes[0].fix && typeof notes[0].fix.label === 'string', true);
            assert('put the difference into Smile', notes[0].fix.apply({ ...under }), { smile: 10 });
            assert('buckets at 100 are fine', runPlausibility([buckets], { daily: 60, splurge: 10, smile: 10, fire: 20 }), []);
            const over = { daily: 60, splurge: 10, smile: 15, fire: 20 };
            assert('over 100 offers the fix too', runPlausibility([buckets], over)[0].fix.apply({ ...over }), { smile: 10 });
            assert('no fix when Smile would go negative', runPlausibility([buckets], { daily: 90, splurge: 30, smile: 5, fire: 0 })[0].fix, undefined);

            // None of them blocks Save.
            const model = createSheetModel({
                fields: [{ key: 'amount', label: 'Amount', type: 'money' }, { key: 'frequency', label: 'How often', type: 'select', options: ['weekly', 'monthly'] }],
                values: { amount: 100, frequency: 'weekly' },
                plausibility: (v) => runPlausibility([rent], v),
            });
            model.set('amount', '7000');
            assert('the note appears', model.notes().length, 1);
            const res = model.save();
            assert('plausibility does not block Save', res.ok, true);
            assert('the value is kept', res.values.amount, 7000);

            // The one-tap fix goes through the model.
            const m2 = createSheetModel({
                fields: ['daily', 'splurge', 'smile', 'fire'].map((k) => ({ key: k, label: k, type: 'percent' })),
                values: under,
                plausibility: (v) => runPlausibility([buckets], v),
            });
            m2.applyFix(0);
            assert('applyFix puts the difference into Smile', m2.current().smile, 10);
            assert('and the note goes away', m2.notes(), []);
        },
    },
    {
        name: 'D1.2 undo',
        fn(assert) {
            const coll = JSON.parse(JSON.stringify(SAMPLE_PLAN));
            const before = JSON.parse(JSON.stringify(coll));
            const removed = removeAt(coll, 1);
            assert('the item is removed', coll.map((x) => x.id), ['a', 'c']);
            assert('the snapshot has the item and its index', [removed.item.id, removed.index], ['b', 1]);
            removed.undo();
            assert('undo gives a collection deep-equal to before', coll, before);
            assert('the item is back at its index', coll[1].id, 'b');

            // deleteWithUndo reinserts and tells the caller to render and save each time.
            let changes = 0, toastOpts = null;
            const c2 = JSON.parse(JSON.stringify(SAMPLE_PLAN));
            deleteWithUndo(c2, 0, { message: 'Rent deleted', onChange: () => { changes++; }, toast: (opts) => { toastOpts = opts; } });
            assert('deleted at once', c2.map((x) => x.id), ['b', 'c']);
            assert('the caller was told', changes, 1);
            assert('the toast message is passed on', toastOpts.message, 'Rent deleted');
            toastOpts.onUndo();
            assert('undo through the toast restores the list', c2, before);
            assert('and tells the caller again', changes, 2);

            // The second delete lands while the first is still undoable: indexes still hold.
            const c3 = JSON.parse(JSON.stringify(SAMPLE_PLAN));
            const first = removeAt(c3, 2);
            const second = removeAt(c3, 0);
            second.undo();
            first.undo();
            assert('two deletes undone newest first restore the list', c3, before);
            const far = removeAt(c3, 2);
            c3.length = 0;
            far.undo();
            assert('an index past the end is clamped', c3.map((x) => x.id), ['c']);
            assert('an out-of-range remove does nothing', removeAt([1, 2], 5), null);
        },
    },
    {
        name: 'D1.3 toast queue',
        fn(assert) {
            const f = fakeQueue();
            let expiredA = 0, expiredB = 0, undoneA = 0;
            f.queue.show({ message: 'A deleted', duration: 6000, action: { label: 'Undo', onAction: () => { undoneA++; } }, onExpire: () => { expiredA++; } });
            f.queue.show({ message: 'B deleted', duration: 6000, onExpire: () => { expiredB++; } });
            assert('a second toast replaces the first', f.shown, ['A deleted', 'B deleted']);
            assert('and calls the first onExpire exactly once', expiredA, 1);
            assert('without running its undo', undoneA, 0);
            f.tick(7000);
            assert('the first is not expired again later', expiredA, 1);
            assert('the second expires with its timer', expiredB, 1);
            assert('the toast is hidden after expiry', f.hiddenCount(), 1);

            // Undo does not commit.
            let exp = 0, undone = 0;
            f.queue.show({ message: 'C deleted', duration: 6000, action: { label: 'Undo', onAction: () => { undone++; } }, onExpire: () => { exp++; } });
            f.queue.act();
            f.tick(10000);
            assert('undo runs the action once', undone, 1);
            assert('undo does not also commit', exp, 0);

            // Pause holds the timer; resume keeps the remaining time.
            let exp2 = 0;
            f.queue.show({ message: 'D', duration: 6000, onExpire: () => { exp2++; } });
            f.tick(4000);
            f.queue.pause();
            f.tick(60000);
            assert('paused toast stays', exp2, 0);
            f.queue.resume();
            f.tick(1999);
            assert('the remaining time is kept', exp2, 0);
            f.tick(2);
            assert('then it expires', exp2, 1);

            // Persistent (duration 0): no timer, dismiss commits.
            let exp3 = 0;
            f.queue.show({ message: 'Storage full', kind: 'error', duration: 0, onExpire: () => { exp3++; } });
            assert('persistent toast sets no timer', f.timerCount(), 0);
            f.tick(100000);
            assert('and stays', exp3, 0);
            f.queue.dismiss();
            assert('dismiss commits it', exp3, 1);
            f.queue.dismiss();
            assert('dismiss twice is harmless', exp3, 1);
        },
    },
    {
        name: 'D1.4 validate',
        fn(assert) {
            const fields = [
                { key: 'name', label: 'Name', type: 'text', required: true },
                { key: 'amount', label: 'Amount', type: 'money' },
                { key: 'pct', label: 'Share', type: 'percent' },
            ];
            let saved = null;
            const model = createSheetModel({
                fields,
                values: { name: 'Netflix', amount: 22.99, pct: 10 },
                validate: (v) => (v.amount != null && v.amount < 0 ? { amount: 'Amounts cannot be negative' } : {}),
            });
            model.set('amount', '-5');
            const res = model.save();
            if (res.ok) saved = res.values;
            assert('a returned error blocks Save', res.ok, false);
            assert('the error is reported for the field', res.errors.amount, 'Amounts cannot be negative');
            assert('nothing was saved', saved, null);
            assert('the rejected value is not kept', model.raw.amount, '22.99');
            assert('the draft is back to the last good value', model.current().amount, 22.99);

            model.set('amount', '$1,234.50');
            const ok = model.save();
            assert('a valid value saves', ok.ok, true);
            assert('money text is parsed', ok.values.amount, 1234.5);

            model.set('name', '   ');
            const req = model.save();
            assert('a required field left empty blocks Save', [req.ok, typeof req.errors.name], [false, 'string']);
            assert('and reverts to the last good name', model.raw.name, 'Netflix');

            model.set('pct', 'abc');
            const bad = model.save();
            assert('text in a percent field blocks Save', [bad.ok, typeof bad.errors.pct], [false, 'string']);
            assert('and the text is cleared back', model.raw.pct, '10');

            assert('coerce: money with symbols', coerceFieldValue({ type: 'money' }, 'A$ 1,000.456'), { ok: true, value: 1000.46 });
            assert('coerce: cents unit', coerceFieldValue({ type: 'money', unit: 'cents' }, '12.34'), { ok: true, value: 1234 });
            assert('coerce: empty number is null', coerceFieldValue({ type: 'number' }, ''), { ok: true, value: null });
            assert('coerce: toggle', coerceFieldValue({ type: 'toggle' }, true), { ok: true, value: true });
            assert('coerce: select keeps option type', coerceFieldValue({ type: 'select', options: [{ value: 2, label: 'Two' }] }, '2'), { ok: true, value: 2 });
        },
    },
    {
        name: 'D1.5 dialog and wrapper',
        async fn(assert) {
            assert('info maps to info', toastKindForModal('info'), 'info');
            assert('error maps to error', toastKindForModal('error'), 'error');
            assert('success maps to success', toastKindForModal('success'), 'success');
            assert('anything else is info', toastKindForModal('nope'), 'info');
            if (!HAS_DOM) return;

            showCustomModal('Saved as your defaults.', 'success');
            const toast = document.getElementById('ledger-toast');
            assert('showCustomModal raises a toast of that kind', toast.classList.contains('is-success'), true);
            assert('with the message as text', toast.textContent.includes('Saved as your defaults.'), true);
            showCustomModal('Could not read file <b>x</b>', 'error');
            assert('error kind', toast.classList.contains('is-error'), true);
            assert('markup in a message is text, not HTML', toast.querySelector('b'), null);

            const p1 = confirmDialog({ title: 'Erase all data?', body: 'This cannot be undone.', confirmLabel: 'Erase', danger: true });
            const dlg = document.querySelector('dialog.ledger-dialog');
            assert('a dialog is open', !!dlg && dlg.open, true);
            assert('it has an accessible title', dlg.getAttribute('aria-labelledby') !== null, true);
            dlg.querySelector('[data-dialog-confirm]').click();
            assert('confirm resolves true', await p1, true);
            assert('the dialog is removed', document.querySelector('dialog.ledger-dialog'), null);

            const p2 = confirmDialog({ title: 'Restore?', body: 'x' });
            document.querySelector('dialog.ledger-dialog [data-dialog-cancel]').click();
            assert('cancel resolves false', await p2, false);

            const p3 = confirmDialog({ title: 'Restore?', body: 'x' });
            document.querySelector('dialog.ledger-dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
            assert('Escape resolves false', await p3, false);
        },
    },
    { name: 'T3.1 a note keeps its node while its message and fixes are unchanged', fn(assert) {
        const fix = { label: 'Put the difference into Smile' };
        assert('same message and fix, same signature', noteSig('Adds to 98%', [fix]), noteSig('Adds to 98%', [{ label: 'Put the difference into Smile' }]));
        assert('a new message changes it', noteSig('Adds to 99%', [fix]) === noteSig('Adds to 98%', [fix]), false);
        assert('a new fix label changes it', noteSig('Adds to 98%', [{ label: 'Other' }]) === noteSig('Adds to 98%', [fix]), false);
        assert('no message is the empty signature', [noteSig('', [fix]), noteSig(null)], ['', '']);
    } },
    {
        name: 'P2.1 an open sheet is never covered by a toast (390 and 1440)',
        async fn(assert) {
            if (!HAS_DOM) return;
            // Real layout: the repo CSS inside an iframe of the given width holding a copy of the open sheet and the toast.
            const [sheetCss, baseCss] = [(await import('./sheet.css?raw')).default, (await import('../../style.css?raw')).default];
            const fields = [
                { key: 'name', label: 'Name', type: 'text', hint: 'A short name for this debt.' },
                { key: 'bal', label: 'Balance', type: 'money', hint: 'What you owe today.' },
                { key: 'rate', label: 'Rate', type: 'number', hint: 'Yearly interest.' },
            ];
            const s = openSheet({ title: 'Add debt', fields, values: {}, onSave() {} });
            const sheetHtml = s.layer.outerHTML;
            s.close();
            const cases = [[390, 780], [1440, 900], [800, 900]];
            for (const [w, h] of cases) {
                const fr = document.createElement('iframe');
                fr.style.cssText = `position:fixed;left:-9999px;top:0;border:0;width:${w}px;height:${h}px`;
                fr.srcdoc = `<!doctype html><html><head><style>${baseCss}</style><style>${sheetCss}</style></head><body class="has-sheet">${sheetHtml}<div id="ledger-toast" role="status" aria-live="polite" class="is-info has-controls is-visible"><span class="toast-msg">Added Family car.</span><button type="button" class="toast-action">Undo</button></div></body></html>`;
                document.body.appendChild(fr);
                await new Promise((r) => { fr.onload = r; });
                await new Promise((r) => setTimeout(r, 400)); // the toast fades in
                const d = fr.contentDocument;
                const rect = (sel) => d.querySelector(sel).getBoundingClientRect();
                const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
                const toast = rect('#ledger-toast');
                assert(`${w}: toast is shown`, toast.width > 0 && toast.height > 0, true);
                assert(`${w}: toast inside the viewport`, toast.left >= 0 && toast.right <= w && toast.top >= 0 && toast.bottom <= h, true);
                assert(`${w}: toast clear of the sheet body`, hit(toast, rect('.sheet-body')), false);
                assert(`${w}: toast clear of the footer`, hit(toast, rect('.sheet-foot')), false);
                assert(`${w}: toast clear of the sheet header`, hit(toast, rect('.sheet-head')), false);
                assert(`${w}: the Undo button is on screen`, rect('.toast-action').bottom <= h && rect('.toast-action').top >= 0, true);
                assert(`${w}: toast keeps role and live region`, [d.querySelector('#ledger-toast').getAttribute('role'), d.querySelector('#ledger-toast').getAttribute('aria-live')], ['status', 'polite']);
                fr.remove();
            }
        },
    },
];
