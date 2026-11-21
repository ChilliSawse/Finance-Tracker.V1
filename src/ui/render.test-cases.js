// Test cases for the "render-lazy" group (registered in src/test-registry.js).
// P3a: only the visible tab renders at boot, the others are dirty and render on first open,
// and a data change while a tab is hidden re-renders it when opened. Browser env: showTab and
// the render pass touch the DOM, so the loaders are stubs and the screens are throwaway elements.
// Shape: { name, fn(assert) } (async allowed), assert(label, actual, expected).

import { store } from '../state/store.js';
import { updateAllUI, updateDataAndUI, renderActiveTab, refreshTab, isTabDirty, isTabReady, _resetTabsForTest } from './render.js';
import { showTab } from './tabs.js';

const NAMES = ['today', 'activity', 'plan', 'future'];

// A stand-in for index.html: four screens and the tab buttons, removed again afterwards.
function mountShell() {
    const root = document.createElement('div');
    root.innerHTML = NAMES.map((n) => `<section id="${n}" class="screen${n === 'today' ? ' active' : ''}"></section>`).join('')
        + '<nav role="tablist">' + NAMES.map((n) => `<button role="tab" data-tab-target="${n}"></button>`).join('') + '</nav>';
    document.body.appendChild(root);
    return root;
}

// Stub loaders that record loads and renders. hold/release keep a module "download" open.
function stubLoaders() {
    const log = { loads: [], renders: [] };
    const gates = {};
    const loaders = {};
    for (const tab of ['activity', 'plan', 'future']) {
        loaders[tab] = () => {
            log.loads.push(tab);
            const ready = gates[tab] ? gates[tab].promise : Promise.resolve();
            return ready.then(() => () => { log.renders.push(tab); });
        };
    }
    log.hold = (tab) => { let resolve; const promise = new Promise((r) => { resolve = r; }); gates[tab] = { promise, resolve }; };
    log.release = (tab) => gates[tab].resolve();
    return { loaders, log };
}

async function withShell(fn) {
    const saved = Object.assign({}, localStorage);
    const prevTab = store.activeTab;
    const root = mountShell();
    try { await fn(); } finally {
        root.remove();
        store.activeTab = prevTab;
        _resetTabsForTest();
        localStorage.clear();
        for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    }
}

export const RENDER_LAZY_TEST_CASES = [
    {
        name: 'P3a.1 updateAllUI renders only the active tab; the others wait, dirty, and are not even loaded',
        async fn(assert) {
            await withShell(async () => {
                const { loaders, log } = stubLoaders();
                _resetTabsForTest(loaders);
                store.activeTab = 'today';
                await updateAllUI();
                assert('no other module loaded', log.loads, []);
                assert('no other tab rendered', log.renders, []);
                assert('activity dirty', isTabDirty('activity'), true);
                assert('plan dirty', isTabDirty('plan'), true);
                assert('future dirty', isTabDirty('future'), true);
                assert('today not dirty (rendered)', isTabDirty('today'), false);
            });
        },
    },
    {
        name: 'P3a.1b updateAllUI on another active tab renders that tab only',
        async fn(assert) {
            await withShell(async () => {
                const { loaders, log } = stubLoaders();
                _resetTabsForTest(loaders);
                store.activeTab = 'plan';
                await updateAllUI();
                assert('only plan rendered', log.renders, ['plan']);
                assert('only plan loaded', log.loads, ['plan']);
                assert('plan clean', isTabDirty('plan'), false);
                assert('activity still dirty', isTabDirty('activity'), true);
            });
        },
    },
    {
        name: 'P3a.2 first open of another tab loads and renders it, and the screen switches only after the module has loaded',
        async fn(assert) {
            await withShell(async () => {
                const { loaders, log } = stubLoaders();
                _resetTabsForTest(loaders);
                store.activeTab = 'today';
                await updateAllUI();
                log.hold('activity');
                assert('not ready before first open', isTabReady('activity'), false);
                const opening = showTab('activity');
                assert('still showing today while it loads', document.getElementById('today').classList.contains('active'), true);
                assert('activity not yet shown', document.getElementById('activity').classList.contains('active'), false);
                assert('activeTab unchanged while loading', store.activeTab, 'today');
                log.release('activity');
                await opening;
                assert('activity rendered once', log.renders, ['activity']);
                assert('activity shown', document.getElementById('activity').classList.contains('active'), true);
                assert('today hidden', document.getElementById('today').classList.contains('active'), false);
                assert('activeTab updated', store.activeTab, 'activity');
                assert('tab button selected', document.querySelector('[data-tab-target="activity"]').getAttribute('aria-selected'), 'true');
                assert('activity clean', isTabDirty('activity'), false);
                // Opening it again does not render it again.
                await showTab('today');
                await showTab('activity');
                assert('no re-render when clean', log.renders, ['activity']);
            });
        },
    },
    {
        name: 'P3a.2b the latest tab request wins when a slower one resolves later',
        async fn(assert) {
            await withShell(async () => {
                const { loaders, log } = stubLoaders();
                _resetTabsForTest(loaders);
                store.activeTab = 'today';
                await updateAllUI();
                log.hold('plan');
                const slow = showTab('plan');
                await showTab('future');
                log.release('plan');
                await slow;
                assert('future is the active tab', store.activeTab, 'future');
                assert('plan was not shown over it', document.getElementById('plan').classList.contains('active'), false);
            });
        },
    },
    {
        name: 'P3a.3 a data change on a hidden tab re-renders it when it is next opened',
        async fn(assert) {
            await withShell(async () => {
                const { loaders, log } = stubLoaders();
                _resetTabsForTest(loaders);
                store.activeTab = 'today';
                await updateAllUI();
                await showTab('plan');
                assert('plan rendered on first open', log.renders, ['plan']);
                await showTab('today');
                await updateDataAndUI(() => {});
                assert('hidden plan is dirty again', isTabDirty('plan'), true);
                assert('hidden plan not rendered while hidden', log.renders, ['plan']);
                await showTab('plan');
                assert('plan re-rendered on open', log.renders, ['plan', 'plan']);
                assert('plan clean', isTabDirty('plan'), false);
            });
        },
    },
    {
        name: 'P3a.4 a data change on the active lazy tab re-renders it at once; refreshTab renders without being dirty',
        async fn(assert) {
            await withShell(async () => {
                const { loaders, log } = stubLoaders();
                _resetTabsForTest(loaders);
                store.activeTab = 'today';
                await updateAllUI();
                await showTab('future');
                await updateDataAndUI(() => {});
                assert('re-rendered on change', log.renders, ['future', 'future']);
                await refreshTab('future');
                assert('refresh renders', log.renders, ['future', 'future', 'future']);
                await renderActiveTab();
                assert('clean tab: renderActiveTab does nothing', log.renders.length, 3);
            });
        },
    },
    {
        name: 'P3a.5 a failed module load is retried on the next open, and does not strand the screen',
        async fn(assert) {
            await withShell(async () => {
                let attempts = 0;
                const orig = console.error;
                console.error = () => {};
                try {
                    _resetTabsForTest({
                        activity: () => {
                            attempts += 1;
                            return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(() => {});
                        },
                    });
                    store.activeTab = 'today';
                    await updateAllUI();
                    await showTab('activity');
                    assert('screen still switches after a failed load', store.activeTab, 'activity');
                    assert('tab still dirty after a failed load', isTabDirty('activity'), true);
                    await showTab('today');
                    await showTab('activity');
                    assert('second open loaded it', attempts, 2);
                    assert('clean after the retry', isTabDirty('activity'), false);
                } finally { console.error = orig; }
            });
        },
    },
];
