// P3b tests: features that used to bind at boot now bind on first use, and only once.
// Pure cases use fakes for the module loaders and the document; the browser case runs the real Setup module
// on a throwaway DOM for the first-run path.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    lazyFeature, makeSettingsFeature, makeImportFeature, makeOnboardingFeature,
    openSettingsLazy, needsFirstRunSetup, startFirstRunSetup, bindSetupEntryPoints,
} from './lazy-setup.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A document stand-in: records listeners, dispatch(type, event) calls them. */
function fakeDoc() {
    const l = {};
    return {
        addEventListener(type, fn) { (l[type] = l[type] || []).push(fn); },
        dispatch(type, ev) { (l[type] || []).forEach((fn) => fn(ev)); return ev; },
    };
}
const clickEvent = (target) => ({ target, prevented: false, preventDefault() { this.prevented = true; } });
const button = (matches, log) => ({
    isConnected: true,
    closest: (sel) => (matches.some((m) => sel.includes(m)) ? button(matches, log) : null),
    click() { log.push('re-click'); },
});
const customEvent = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

export const LAZY_SETUP_TEST_CASES = [
    {
        name: 'P3b.1 lazyFeature: loads and sets up once, however often and however fast it is asked',
        async fn(assert) {
            const log = [];
            const ensure = lazyFeature(() => { log.push('load'); return { name: 'mod' }; }, (m) => { log.push('setup ' + m.name); });
            assert('not loaded before first use', ensure.loaded, false);
            assert('nothing ran yet', log, []);
            const [a, b] = await Promise.all([ensure(), ensure()]); // two clicks before the first finishes
            const c = await ensure(); // a later click
            assert('load and setup ran once', log, ['load', 'setup mod']);
            assert('every caller gets the same module', a === b && b === c, true);
            assert('loaded after first use', ensure.loaded, true);
        },
    },
    {
        name: 'P3b.2 lazyFeature: a failed load is not remembered, the next use tries again',
        async fn(assert) {
            let calls = 0;
            const ensure = lazyFeature(() => { calls++; if (calls === 1) throw new Error('offline'); return { ok: true }; }, () => {});
            let failed = false;
            try { await ensure(); } catch (e) { failed = e.message === 'offline'; }
            assert('first use reports the failure', failed, true);
            assert('not marked loaded', ensure.loaded, false);
            const m = await ensure();
            assert('second use loads', m.ok, true);
            assert('loaded now', ensure.loaded, true);
        },
    },
    {
        name: 'P3b.3 Settings: the screen is built on the first open, and a second open does not build it again',
        async fn(assert) {
            const log = [];
            const mod = { setupSettingsScreen() { log.push('setup'); }, openSettings() { log.push('open'); } };
            const ensure = makeSettingsFeature(() => mod);
            assert('nothing at boot', log, []);
            await openSettingsLazy(ensure);
            assert('first open: set up, then open', log, ['setup', 'open']);
            await openSettingsLazy(ensure);
            assert('second open: open only', log, ['setup', 'open', 'open']);
        },
    },
    {
        name: 'P3b.4 Import: both flows wire on first use, once, for CSV and for PDF',
        async fn(assert) {
            const log = [];
            const csv = { setupImport() { log.push('csv'); }, startCsvImport() {} };
            const pdf = { setupPdfImport() { log.push('pdf'); }, startPdfImport() {} };
            const ensure = makeImportFeature(() => [csv, pdf]);
            assert('nothing at boot', log, []);
            const first = await ensure();
            await ensure();
            assert('each flow wired exactly once', log, ['csv', 'pdf']);
            assert('hands back both flows', [first[0] === csv, first[1] === pdf], [true, true]);
        },
    },
    {
        name: 'P3b.5 Setup: a checklist button loads it once, then repeats the click; later clicks are left to Setup',
        async fn(assert) {
            const log = [];
            const mod = { setupOnboarding(had) { log.push('setup ' + had); }, openSetup() { log.push('open'); } };
            const ensure = makeOnboardingFeature(() => mod, () => false);
            const doc = fakeDoc();
            bindSetupEntryPoints(doc, ensure);
            const plain = doc.dispatch('click', clickEvent({ closest: () => null }));
            assert('an unrelated click loads nothing', [plain.prevented, ensure.loaded], [false, false]);
            const first = doc.dispatch('click', clickEvent(button(['data-su-resume'], log)));
            const second = doc.dispatch('click', clickEvent(button(['data-su-resume'], log)));
            assert('a checklist click is held back while Setup loads', [first.prevented, second.prevented], [true, true]);
            await tick(); await tick();
            assert('Setup wired once (not a first run), and each click repeated', log, ['setup true', 're-click', 're-click']);
            const later = doc.dispatch('click', clickEvent(button(['data-su-resume'], log)));
            assert('once loaded the handler steps aside', later.prevented, false);
        },
    },
    {
        name: 'P3b.6 Settings > Run setup again: handled at once, Setup opens once it has loaded',
        async fn(assert) {
            const log = [];
            const mod = { setupOnboarding(had) { log.push('setup ' + had); }, openSetup(o) { log.push('open welcome=' + o.welcome); } };
            const ensure = makeOnboardingFeature(() => mod, () => false);
            const doc = fakeDoc();
            bindSetupEntryPoints(doc, ensure);
            const ev = doc.dispatch('ledger:run-setup', customEvent());
            assert('Settings is told it was handled (no "coming soon" toast)', ev.prevented, true);
            await tick(); await tick();
            assert('Setup wired then opened', log, ['setup true', 'open welcome=false']);
            const again = doc.dispatch('ledger:run-setup', customEvent());
            assert('after load, Setup answers its own event', again.prevented, false);
        },
    },
    {
        name: 'P3b.7 first run: a new user gets Setup (welcome and sample data); returning users do not',
        async fn(assert) {
            assert('no saved data, never onboarded: Setup opens', needsFirstRunSetup(false, false), true);
            assert('saved data: no Setup', needsFirstRunSetup(true, false), false);
            assert('finished or skipped before: no Setup', needsFirstRunSetup(false, true), false);
            const log = [];
            const mod = { setupOnboarding(had) { log.push('setup hadSavedData=' + had); } };
            const ensure = makeOnboardingFeature(() => mod, () => true);
            await startFirstRunSetup(ensure);
            await startFirstRunSetup(ensure);
            assert('the first run wires Setup once and asks it for the welcome screen', log, ['setup hadSavedData=false']);
        },
    },
    {
        name: 'P3e.1 first run: the page is hidden while Setup loads and shown again once it has opened or failed',
        async fn(assert) {
            const classes = new Set();
            const doc = { body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } } };
            let release;
            const gate = new Promise((r) => { release = r; });
            let seenWhileLoading = null;
            const ensure = makeOnboardingFeature(async () => { seenWhileLoading = classes.has('setup-pending'); await gate; return { setupOnboarding() {} }; }, () => true);
            const p = startFirstRunSetup(ensure, doc);
            assert('pending the moment the first run starts', classes.has('setup-pending'), true);
            await tick();
            assert('still pending while the Setup module loads', seenWhileLoading, true);
            release();
            await p;
            assert('cleared once Setup has opened', classes.has('setup-pending'), false);
            const broken = makeOnboardingFeature(() => Promise.reject(new Error('offline')), () => true);
            const quiet = console.error; console.error = () => {};
            try { await startFirstRunSetup(broken, doc); } finally { console.error = quiet; }
            assert('a failed load still hands the page back', classes.has('setup-pending'), false);
        },
    },
];

// Browser only: the real Setup module on a throwaway page structure.
export const LAZY_SETUP_BROWSER_TEST_CASES = [
    {
        name: 'P3b.8 first run on the real Setup module: the welcome opens with Explore with sample data, once',
        async fn(assert) {
            let keep = null;
            try { keep = localStorage.getItem('ft-onboarded'); localStorage.removeItem('ft-onboarded'); } catch (e) { keep = null; }
            const app = document.createElement('div'); app.className = 'app';
            const root = document.createElement('div'); root.id = 'setup-root';
            document.body.append(app, root);
            try {
                const m = await import('./ui/onboarding.js');
                m.setupOnboarding(false); // exactly what startFirstRunSetup does
                assert('Setup is open for a new user', m.isSetupOpen(), true);
                assert('the page behind it is inert', app.hasAttribute('inert'), true);
                assert('welcome offers the sample data', !!root.querySelector('[data-su="sample"]'), true);
                assert('and the guided start', !!root.querySelector('[data-su="start"]'), true);
                m.setupOnboarding(false); // wiring twice must not open a second Setup
                assert('still one welcome screen', root.querySelectorAll('[data-su="sample"]').length, 1);
                m.closeSetup();
                assert('closing hands the page back', app.hasAttribute('inert'), false);
                assert('and marks the user as onboarded', localStorage.getItem('ft-onboarded'), '1');
                m.setupOnboarding(false);
                assert('a returning user does not get the welcome again', m.isSetupOpen(), false);
            } finally {
                app.remove(); root.remove();
                document.body.classList.remove('has-setup');
                try { if (keep === null) localStorage.removeItem('ft-onboarded'); else localStorage.setItem('ft-onboarded', keep); } catch (e) { console.warn('could not restore ft-onboarded', e); }
            }
        },
    },
];
