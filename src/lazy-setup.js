// First-use setup (P3b). Settings, the statement import flows and Setup (onboarding) used to bind their
// events at boot, which put their whole module graphs in the first download. Each one now loads, and
// runs its setup function exactly once, the first time something needs it.
//
// `lazyFeature(load, setup)` is the pure core. The `make*` factories take a loader so tests can inject fakes; the
// exported singletons below use real dynamic import()s, so the bundler keeps each feature (and its CSS) in its own chunk.

import { alreadyOnboarded } from './ui/setup/onboarded.js';

/**
 * Returns ensure(): the first call loads the module and runs setup(mod) once; every later call (also while the
 * first is still loading) gets the same promise, so setup never runs twice. A failed load or setup is not
 * remembered, so the next use tries again. ensure.loaded is true once setup has finished.
 */
export function lazyFeature(load, setup) {
    let pending = null;
    let done = false;
    const ensure = () => {
        if (!pending) {
            pending = Promise.resolve()
                .then(load)
                .then(async (mod) => { await setup(mod); done = true; return mod; })
                .catch((err) => { pending = null; throw err; });
        }
        return pending;
    };
    Object.defineProperty(ensure, 'loaded', { get: () => done });
    return ensure;
}

// ---- Settings screen ----

export const makeSettingsFeature = (load) => lazyFeature(load, (m) => m.setupSettingsScreen());
export const ensureSettings = makeSettingsFeature(() => import('./ui/settings-screen.js'));

/** Open the Settings screen, loading and building it on the first call. */
export async function openSettingsLazy(ensure = ensureSettings) {
    try {
        const m = await ensure();
        m.openSettings();
    } catch (err) {
        console.error('Settings could not be loaded', err);
    }
}

// ---- Statement import (CSV / Excel and PDF) ----

/** Resolves to [csvModule, pdfModule] once both flows have wired their windows. */
export const makeImportFeature = (load) => lazyFeature(load, ([csv, pdf]) => { csv.setupImport(); pdf.setupPdfImport(); });
export const ensureImport = makeImportFeature(() => Promise.all([import('./import/import-ui.js'), import('./import/pdf-ui.js')]));

// ---- Setup (onboarding) ----

/**
 * Setup is wired the first time it is needed: a first run, the Settings "Run setup again" row, or a click on the
 * Today checklist. `welcome()` says whether the loading call is a first run (true opens the welcome screen).
 */
export function makeOnboardingFeature(load, welcome) {
    return lazyFeature(load, (m) => m.setupOnboarding(!welcome()));
}

let firstRun = false;
export const ensureOnboarding = makeOnboardingFeature(() => import('./ui/onboarding.js'), () => firstRun);

/** True for a new user: no saved data and Setup (old or new) never finished or skipped. */
export function needsFirstRunSetup(hadSavedData, onboarded = alreadyOnboarded()) {
    return !hadSavedData && !onboarded;
}

/**
 * Load Setup for a first run: wires it and opens the welcome screen. Until Setup has opened (or failed to load) the page
 * behind it is hidden by `body.setup-pending` (shell.css), so a new user sees the ground colour and then Setup, never a
 * frame of Today in between (P3e). The class is cleared whatever happens, so a failed load still shows Today.
 */
export function startFirstRunSetup(ensure = ensureOnboarding, doc = typeof document === 'undefined' ? null : document) {
    firstRun = true;
    const body = doc && doc.body;
    if (body) body.classList.add('setup-pending');
    return ensure()
        .catch((err) => console.error('Setup could not be loaded', err))
        .finally(() => { if (body) body.classList.remove('setup-pending'); });
}

/**
 * Wire the entry points to Setup that must exist before it is loaded: the Today checklist buttons and the
 * Settings "Run setup again" event. The first use loads Setup (without a welcome screen), then repeats the action.
 */
export function bindSetupEntryPoints(doc = document, ensure = ensureOnboarding) {
    const load = () => { firstRun = false; return ensure(); };
    const fail = (err) => console.error('Setup could not be loaded', err);
    doc.addEventListener('click', (e) => {
        if (ensure.loaded) return; // Setup's own listener answers it
        const target = e.target && typeof e.target.closest === 'function' ? e.target : null;
        const hit = target && target.closest('[data-su-resume], [data-su-notneeded], [data-su-hidelist]');
        if (!hit) return;
        e.preventDefault();
        load().then(() => { if (hit.isConnected) hit.click(); }).catch(fail);
    });
    doc.addEventListener('ledger:run-setup', (e) => {
        if (ensure.loaded) return;
        e.preventDefault(); // tells Settings it was handled
        load().then((m) => m.openSetup({ welcome: false })).catch(fail);
    });
}
