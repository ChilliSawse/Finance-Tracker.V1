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

    // Factory defaults (D2: "Save as My Defaults" is gone; Erase all data uses the clones in defaults.js).
    defaultFinanceData,
    defaultGuiSettings,

    // FinanceAutoSave instance (constructed in main.js after DOM ready).
    autoSave: null,

    // The visible tab — ui/render.js uses it to re-render only what's on screen.
    activeTab: 'today',
};
