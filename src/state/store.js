// The one mutable application-state container.
//
// Previously these were implicit globals spread across <script defer> files
// (financeData, guiSettingsData, whatIfFinanceData, autoSave, …). They stay
// deliberately simple — a plain object modules import and read/write — because
// the codebase's editing model is "mutate in place, then tell the renderer"
// (see ui/render.js for the scoped-render coordination that replaced the old
// re-render-everything 'dataChanged' CustomEvent).
//
// JSON serialisation note: taxBrackets use max: Infinity for the open top band.
// JSON.stringify(Infinity) === 'null', and calculateTaxFromBrackets treats
// null max as Infinity, so the round-trip through localStorage is lossless
// in effect. Preserved behaviour from the pre-module code.

import { cloneDefaultFinanceData, cloneDefaultGuiSettings, defaultFinanceData, defaultGuiSettings } from './defaults.js';

export const store = {
    financeData: cloneDefaultFinanceData(),
    guiSettingsData: cloneDefaultGuiSettings(),

    // Session defaults — actionSetCurrentAsDefault re-points these so an
    // in-session "Reset to My Defaults" matches what was just saved.
    defaultFinanceData,
    defaultGuiSettings,

    // What If sandbox — a full clone of financeData. Editable What If sections
    // write here (via data-scope="whatif" routing), never to live data.
    whatIfFinanceData: null,
    whatIfViewPeriod: 'fortnightly',
    // Tracks whether the What If tab has been seeded from live data yet, so tab
    // switches don't clobber in-progress edits. Reset by "Reset to current".
    whatIfInitialized: false,

    // FinanceAutoSave instance (constructed in main.js after DOM ready).
    autoSave: null,

    // The visible tab — ui/render.js uses it to re-render only what's on screen.
    activeTab: 'dashboard',
};
