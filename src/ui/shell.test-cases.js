// Test cases for the "shell" group (registered in src/test-registry.js).
// A5.1: each stored tab name maps, an unknown value lands on today.
// A5.2: the sidebar scope line and the tab keyboard model (pure helpers in nav-model.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { helpModel, HELP_SCREENS } from './help.js';
import { VALID_TABS, LEGACY_TAB_MAP, resolveTab, scopeLine, nextTabIndex, DEFAULT_TAB } from './nav-model.js';

const src = (over) => ({ incomeType: 'salaried', grossAnnual: 90000, paySchedule: 'fortnightly', ...over });

export const SHELL_TEST_CASES = [
    {
        name: 'A5.1 stored tab names map to the four screens',
        fn(assert) {
            assert('valid tabs', VALID_TABS, ['today', 'activity', 'plan', 'future']);
            assert('default', DEFAULT_TAB, 'today');
            const expected = {
                home: 'today', dashboard: 'today', income: 'plan', expenses: 'plan',
                savings: 'future', liabilities: 'future', whatIf: 'future',
            };
            assert('map table', LEGACY_TAB_MAP, expected);
            for (const [from, to] of Object.entries(expected)) assert(`${from} lands on ${to}`, resolveTab(from), to);
            for (const v of VALID_TABS) assert(`${v} stays`, resolveTab(v), v);
        },
    },
    {
        name: 'A5.1 an unknown or missing value lands on today',
        fn(assert) {
            assert('unknown', resolveTab('nope'), 'today');
            assert('empty', resolveTab(''), 'today');
            assert('null', resolveTab(null), 'today');
            assert('undefined', resolveTab(undefined), 'today');
            assert('settings (removed in D.6)', resolveTab('settings'), 'today');
            assert('prototype key', resolveTab('constructor'), 'today');
        },
    },
    {
        name: 'A5.2 scope line is derived from the primary income source',
        fn(assert) {
            assert('fortnightly', scopeLine({ incomeSources: [src()], primaryIncomeIndex: 0 }), 'Paid fortnightly');
            assert('weekly', scopeLine({ incomeSources: [src({ paySchedule: 'weekly' })], primaryIncomeIndex: 0 }), 'Paid weekly');
            assert('monthly', scopeLine({ incomeSources: [src({ paySchedule: 'monthly' })], primaryIncomeIndex: 0 }), 'Paid monthly');
            assert('primary index picks the second source',
                scopeLine({ incomeSources: [src(), src({ paySchedule: 'monthly' })], primaryIncomeIndex: 1 }), 'Paid monthly');
            assert('missing primary index uses the first', scopeLine({ incomeSources: [src()] }), 'Paid fortnightly');
        },
    },
    {
        name: 'A5.2 scope line is hidden when unset',
        fn(assert) {
            assert('no data', scopeLine(null), '');
            assert('no sources', scopeLine({ incomeSources: [] }), '');
            assert('primary index out of range', scopeLine({ incomeSources: [src()], primaryIncomeIndex: 4 }), '');
            assert('no schedule', scopeLine({ incomeSources: [src({ paySchedule: undefined })], primaryIncomeIndex: 0 }), '');
            assert('unknown schedule', scopeLine({ incomeSources: [src({ paySchedule: 'hourly' })], primaryIncomeIndex: 0 }), '');
            assert('variable income', scopeLine({ incomeSources: [src({ incomeType: 'variable' })], primaryIncomeIndex: 0 }), '');
            assert('fresh install placeholder (no money entered)',
                scopeLine({ incomeSources: [src({ grossAnnual: 0 })], primaryIncomeIndex: 0 }), '');
        },
    },
    {
        name: 'A5.2 tab keyboard navigation model',
        fn(assert) {
            assert('down', nextTabIndex('ArrowDown', 0, 4), 1);
            assert('right', nextTabIndex('ArrowRight', 1, 4), 2);
            assert('down wraps', nextTabIndex('ArrowDown', 3, 4), 0);
            assert('up', nextTabIndex('ArrowUp', 2, 4), 1);
            assert('left wraps', nextTabIndex('ArrowLeft', 0, 4), 3);
            assert('home', nextTabIndex('Home', 3, 4), 0);
            assert('end', nextTabIndex('End', 0, 4), 3);
            assert('other key', nextTabIndex('a', 0, 4), -1);
            assert('focus not on a tab', nextTabIndex('ArrowDown', -1, 4), -1);
        },
    },
    {
        name: 'A11.1 each of the six screens has help words, and an unknown screen has none',
        fn(assert) {
            assert('screens', HELP_SCREENS, ['today', 'activity', 'plan', 'future', 'settings', 'setup']);
            for (const id of HELP_SCREENS) {
                const m = helpModel(id);
                assert(`${id} title`, !!m.title && !m.title.startsWith('a.help.'), true);
                assert(`${id} what`, !!m.what && !m.what.startsWith('a.help.'), true);
                assert(`${id} has jobs`, m.jobs.length > 0 && m.jobs.every((j) => j && !j.startsWith('a.help.')), true);
            }
            assert('future is short', helpModel('future').jobs.length <= 2, true);
            assert('unknown', helpModel('nope'), null);
        },
    },
];
