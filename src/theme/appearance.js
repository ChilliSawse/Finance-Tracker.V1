// The appearance surface: the Themes|Customize modal form, the single
// applyGuiStylesToPage chokepoint, and every GUI-settings event handler.
// Combined from uiSettings.js + events.js — one module so the whole
// theme-application flow lives in one place.
//
// CHOKEPOINT (J2): applyGuiStylesToPage() is the ONE function every appearance
// change funnels through (load, reset, preset click, harmony apply, JSON import,
// live preview). It applies the full derived base first, then user overrides —
// this is what prevents the recurring "split look" bug. Treat with care.

import { store } from '../state/store.js';
import { getElement, getValue, setValue, setText } from '../utils.js';
import { cloneDefaultGuiSettings, defaultGuiSettings } from '../state/defaults.js';
import { inlineConfirm, showCustomModal } from '../ui/confirm.js';
import {
    THEMES, DEFAULT_THEME, resolveTheme, applyTheme, renderThemeSwitcher,
    perceivedLuminance, generateHarmonyBase,
    MAX_CUSTOM_THEMES, snapshotAppearance, saveCustomTheme, deleteCustomTheme,
    applyCustomTheme, parseThemeImport, renderCustomThemes,
    MAX_CUSTOM_FONTS, MAX_FONT_BYTES, customFontStack, addCustomFont,
    deleteCustomFont, populateCustomFontOptions, renderCustomFontList,
    applyBackgroundEffect, applyBgEffectColor,
} from './theme.js';

// J2 — appearance colour fields. `mode: 'base'` feeds deriveTokens (so the rest of the
// palette follows it); `mode: 'override'` overlays a single CSS var only when the user
// pins it (default empty = derived). `cssVar` is the token an override pins / reads back.
export const GUI_COLOR_FIELDS = [
    { id: 'gui-col-bg',         key: 'primaryBgStart', mode: 'base' },
    { id: 'gui-col-surface',    key: 'cardBgStart',    mode: 'base' },
    { id: 'gui-col-text',       key: 'textColor',      mode: 'base' },
    { id: 'gui-col-accent',     key: 'accentColor',    mode: 'base' },
    { id: 'gui-col-border',     key: 'borderColor',    mode: 'base' },
    { id: 'gui-col-heading',    key: 'headingColor',   mode: 'override', cssVar: '--heading-color' },
    { id: 'gui-col-muted',      key: 'mutedColor',     mode: 'override', cssVar: '--text-color-secondary' },
    // 'gui-col-headertext' (Topbar text) removed from the UI — on dark themes deriveTokens locks
    // the header text to #ffffff, so the override read as a no-op. The headerTextColor field stays
    // in state (harmless, empty = derived).
    { id: 'gui-col-positive',   key: 'colorPositive',  mode: 'base' },
    { id: 'gui-col-negative',   key: 'colorNegative',  mode: 'base' },
    { id: 'gui-col-neutral',    key: 'colorNeutral',   mode: 'base' },
    { id: 'gui-col-essential',  key: 'colorEssential', mode: 'override', cssVar: '--color-essential' },
    { id: 'gui-col-warning',    key: 'colorWarning',   mode: 'override', cssVar: '--color-warning' },
];

// Normalise a CSS colour (hex or rgb/rgba) to #rrggbb for a native colour input.
export function toHexColor(c) {
    if (!c) return '';
    c = c.trim();
    if (c[0] === '#') {
        return c.length === 4 ? '#' + c.slice(1).split('').map(x => x + x).join('') : c;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return '';
    const [r, g, b] = m[1].split(',').map(n => parseInt(n, 10));
    const h = v => Math.max(0, Math.min(255, v || 0)).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

// Push current colours into the Customize pickers: base fields from guiSettings, override
// fields from the live computed value (so the swatch shows the effective colour even when
// the field is empty = derived). Called on form open + after a preset swatch click.
export function syncGuiColorInputs() {
    const cs = getComputedStyle(document.documentElement);
    GUI_COLOR_FIELDS.forEach(field => {
        const el = getElement(field.id);
        if (!el) return;
        let val = store.guiSettingsData[field.key];
        if (field.mode === 'override' && !val) val = toHexColor(cs.getPropertyValue(field.cssVar));
        if (val) el.value = val;
    });
}

// One colour picker changed — write just its field, re-derive/apply, persist on commit.
export function commitGuiColor(field, persist) {
    store.guiSettingsData[field.key] = getValue(field.id);
    applyGuiStylesToPage();
    if (persist && store.autoSave) store.autoSave.onDataChange();
}

// Font / base size changed — gather them and apply.
export function commitGuiText(persist) {
    store.guiSettingsData.fontFamily   = getValue('gui-font-family');
    store.guiSettingsData.baseFontSize = getValue('gui-base-font-size');
    applyGuiStylesToPage();
    if (persist && store.autoSave) store.autoSave.onDataChange();
}

// J4 — background effect changed: store it + (re)start it. Decorative only, so it doesn't
// go through the colour-token chokepoint — applyBackgroundEffect is its own entry point.
export function commitGuiEffect(persist) {
    store.guiSettingsData.bgEffect = getValue('gui-bg-effect');
    applyBackgroundEffect(store.guiSettingsData.bgEffect);
    if (persist && store.autoSave) store.autoSave.onDataChange();
}

// J4 — effect tint changed. "Match accent" (checked) clears the pinned colour so the effect
// follows the accent; unchecked pins the picker's value. Disables the picker while matching.
export function commitGuiEffectColor(persist) {
    const accentEl = getElement('gui-bg-effect-accent');
    const picker = getElement('gui-bg-effect-color');
    const matchAccent = accentEl ? accentEl.checked : true;
    if (picker) picker.disabled = matchAccent;
    store.guiSettingsData.bgEffectColor = matchAccent ? '' : getValue('gui-bg-effect-color');
    applyBgEffectColor(store.guiSettingsData.bgEffectColor);
    if (persist && store.autoSave) store.autoSave.onDataChange();
}

// J2 — Themes / Customize tab switching in the appearance modal. Idempotent
// (guarded), so repeated initializeGuiSettingsForm() calls don't double-bind.
function activateAppearanceTab(btn) {
    const tabs = btn.closest('.appearance-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('.appearance-tab').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(b.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
    });
}

export function setupAppearanceTabs() {
    const tabs = document.querySelector('#guiSettings .appearance-tabs');
    if (!tabs || tabs.dataset.wired) return;
    tabs.dataset.wired = '1';
    const buttons = [...tabs.querySelectorAll('.appearance-tab')];
    buttons.forEach(btn => btn.addEventListener('click', () => activateAppearanceTab(btn)));
    // Roving Left/Right arrow keys across the tabs (matches the sidebar tablist pattern).
    tabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const i = buttons.indexOf(document.activeElement);
        if (i < 0) return;
        const next = e.key === 'ArrowRight'
            ? (i + 1) % buttons.length
            : (i - 1 + buttons.length) % buttons.length;
        buttons[next].focus();
        activateAppearanceTab(buttons[next]);
        e.preventDefault();
    });
}

// Populate the appearance modal form from guiSettingsData (called on modal open,
// reset, factory reset and JSON import — always followed by the chokepoint apply).
export function initializeGuiSettingsForm() {
    setupAppearanceTabs();
    renderThemeSwitcher(document.getElementById('theme-switcher-container'));
    renderCustomThemes(document.getElementById('your-themes-container'));
    // Apply first so the computed tokens are current, then read them back into the
    // override pickers (base pickers read straight from guiSettings).
    applyGuiStylesToPage();
    syncGuiColorInputs();
    // J3 — fold uploaded custom fonts into the dropdown before selecting the saved value.
    populateCustomFontOptions(getElement('gui-font-family'));
    renderCustomFontList(getElement('custom-fonts-list'));
    setValue('gui-font-family', store.guiSettingsData.fontFamily);
    setValue('gui-base-font-size', store.guiSettingsData.baseFontSize);
    setValue('gui-bg-effect', store.guiSettingsData.bgEffect || 'none'); // J4 — background effect
    // J4 — effect tint: empty = match accent (checkbox on, picker disabled + showing the accent as
    // a sensible starting point if they uncheck). A pinned value populates the picker directly.
    const effColor = store.guiSettingsData.bgEffectColor || '';
    const effAccentEl = getElement('gui-bg-effect-accent');
    if (effAccentEl) effAccentEl.checked = !effColor;
    const effPicker = getElement('gui-bg-effect-color');
    if (effPicker) {
        effPicker.disabled = !effColor;
        effPicker.value = effColor
            || toHexColor(getComputedStyle(document.documentElement).getPropertyValue('--accent-color'))
            || '#58a6ff';
    }
    applyBgEffectColor(effColor);
    // Re-sync the running effect to the current settings (idempotent — no-op if unchanged),
    // so reset / factory-reset / JSON import all restore the right backdrop via this one path.
    applyBackgroundEffect(store.guiSettingsData.bgEffect);
    initHarmonyControls(); // J3 — seed + preview
}

// J2 — single chokepoint. BASE colours (user value, else active preset) feed deriveTokens,
// which produces the FULL token set (2nd-stop gradients, content bg, tab/muted/header-text
// colours, tints, semantics). applyTheme() applies + replaces the FOUC cache, so no stale
// token can survive a base change (the old "split look" bug). OVERRIDE colours are overlaid
// on top only when the user has pinned one, and merged into the cache.
export function applyGuiStylesToPage() {
    const root = document.documentElement;
    const g = store.guiSettingsData;
    const preset = THEMES[resolveTheme(g.theme)] || THEMES[DEFAULT_THEME];
    if (!preset) return;

    const base = {
        bg:       g.primaryBgStart || preset.bg,
        fg:       g.textColor      || preset.fg,
        panel:    g.cardBgStart    || preset.panel,
        border:   g.borderColor    || preset.border,
        accent:   g.accentColor    || preset.accent,
        positive: g.colorPositive  || preset.positive,
        negative: g.colorNegative  || preset.negative,
        neutral:  g.colorNeutral   || preset.neutral,
    };
    applyTheme(base);

    // Override-only surfaces — overlaid only when pinned (empty = keep the derived value).
    const overrides = {};
    if (g.headingColor)    overrides['--heading-color']        = g.headingColor;
    if (g.mutedColor)      overrides['--text-color-secondary'] = g.mutedColor;
    if (g.headerTextColor) overrides['--header-text-color']    = g.headerTextColor;
    if (g.colorEssential)  overrides['--color-essential']      = g.colorEssential;
    if (g.colorWarning)    overrides['--color-warning']        = g.colorWarning;
    for (const [k, v] of Object.entries(overrides)) root.style.setProperty(k, v);

    root.style.setProperty('--font-family-main', g.fontFamily);
    root.style.setProperty('--base-font-size', g.baseFontSize + 'px');

    setText('main-heading-display', g.mainHeading);
    setText('sub-heading-display', g.subHeading);

    // applyTheme() just rewrote the FOUC cache to the derived set; merge any overrides in
    // so the next first-paint matches (when there are none, the cache stays pure-derived).
    if (Object.keys(overrides).length) {
        try {
            const fouc = JSON.parse(localStorage.getItem('ft-theme-fouc') || '{}');
            Object.assign(fouc, overrides);
            localStorage.setItem('ft-theme-fouc', JSON.stringify(fouc));
        } catch (_) {}
    }
}

// --- Event handlers (from events.js) ---

export function handleGuiSettingsClickEvents(event) {
    const target = event.target;
    // (No "Save Appearance" button — appearance auto-saves on change; see commitGuiColor/commitGuiText.)
    if (target.id === 'reset-gui-settings') {
        inlineConfirm(target, 'Reset appearance to application defaults?', actionResetGuiToDefaults); // H.5
        return;
    }
    // export-json-gui / import-json-gui-btn are handled by events/setup.js (data, not appearance).

    // J3 — Save / Share theme
    if (target.id === 'theme-save-btn')   { actionSaveCustomTheme(); return; }
    if (target.id === 'theme-export-btn') { actionExportTheme(); return; }
    if (target.id === 'theme-import-btn') { getElement('theme-import-file').click(); return; }
    if (target.id === 'harmony-apply-btn') { actionApplyHarmony(); return; }
    if (target.id === 'gui-font-upload-btn') { getElement('gui-font-file').click(); return; }

    // J3 — remove an uploaded custom font (the ✕ beside its name in the fonts list)
    const fontDelBtn = target.closest('[data-font]');
    if (fontDelBtn) { actionDeleteCustomFont(fontDelBtn.dataset.font); return; }

    // J3 — delete a custom theme (the ✕ lives inside its swatch, so check it first)
    const delBtn = target.closest('[data-delete]');
    if (delBtn) {
        deleteCustomTheme(delBtn.dataset.delete);
        renderCustomThemes(document.getElementById('your-themes-container'));
        if (store.autoSave) store.autoSave.onDataChange();
        return;
    }

    // Theme swatch click (built-in preset OR a saved custom theme)
    const swatch = target.closest('[data-theme]');
    if (swatch) {
        const key = swatch.dataset.theme;

        if (swatch.dataset.custom) {
            // J3 — apply a saved custom theme (its full colour/font snapshot).
            if (applyCustomTheme(key)) {
                applyGuiStylesToPage();
                syncGuiColorInputs();
                renderThemeSwitcher(document.getElementById('theme-switcher-container'));
                renderCustomThemes(document.getElementById('your-themes-container'));
                if (store.autoSave) store.autoSave.onDataChange();
            }
            return;
        }

        const preset = THEMES[key];
        if (!preset) return;

        // J2 — selecting a preset starts from its base colours and CLEARS every custom
        // override, so the preset drives the whole page (no stale overlay = no split look).
        // applyGuiStylesToPage() then derives the full token set from the base.
        const g = store.guiSettingsData;
        g.theme           = key;
        g.primaryBgStart  = preset.bg;
        g.cardBgStart     = preset.panel;
        g.textColor       = preset.fg;
        g.borderColor     = preset.border;
        g.accentColor     = preset.accent;
        g.colorPositive   = preset.positive;
        g.colorNegative   = preset.negative;
        g.colorNeutral    = preset.neutral;
        g.headingColor    = '';
        g.mutedColor      = '';
        g.headerTextColor = '';
        g.colorEssential  = '';
        g.colorWarning    = '';

        applyGuiStylesToPage();
        syncGuiColorInputs(); // refresh the Customize pickers to the new colours
        renderThemeSwitcher(document.getElementById('theme-switcher-container'));
        renderCustomThemes(document.getElementById('your-themes-container')); // clear custom highlight

        if (store.autoSave) store.autoSave.onDataChange();
    }
}

// J3 — Save the current appearance as a named custom theme.
function actionSaveCustomTheme() {
    const input = getElement('theme-save-name');
    const errEl = getElement('theme-save-error');
    const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } };
    if (errEl) errEl.hidden = true;
    const name = (input ? input.value : '').trim();
    if (!name) { showErr('Enter a name for your theme.'); return; }
    if (THEMES[name]) { showErr('That name is a built-in theme — pick another.'); return; }
    const res = saveCustomTheme(name, snapshotAppearance());
    if (res === 'limit') { showErr('You have the maximum ' + MAX_CUSTOM_THEMES + ' custom themes. Delete one first.'); return; }
    store.guiSettingsData.theme = name; // the saved theme is now the active one
    if (input) input.value = '';
    renderThemeSwitcher(document.getElementById('theme-switcher-container'));
    renderCustomThemes(document.getElementById('your-themes-container'));
    if (store.autoSave) store.autoSave.onDataChange();
}

// J3 — Colour Harmony. Seed the controls from the current appearance when the form opens:
// accent = current accent, mode inferred from the current page-background luminance.
function initHarmonyControls() {
    const acc = getElement('harmony-accent');
    if (acc && store.guiSettingsData.accentColor) acc.value = store.guiSettingsData.accentColor;
    const modeEl = getElement('harmony-mode');
    if (modeEl) {
        const bg = store.guiSettingsData.primaryBgStart || '#0d1117';
        const dark = perceivedLuminance(bg) < 0.4;
        modeEl.value = dark ? 'dark' : 'light';
    }
    updateHarmonyPreview();
}

// J3 — render the live preview row (bg / surface / text / border / accent) for the current
// harmony selection, without touching the page (Apply commits it).
export function updateHarmonyPreview() {
    const prev = getElement('harmony-preview');
    if (!prev) return;
    const base = generateHarmonyBase(getValue('harmony-accent'), getValue('harmony-type'), getValue('harmony-mode'));
    prev.innerHTML = [base.primaryBgStart, base.cardBgStart, base.textColor, base.borderColor, base.accentColor]
        .map(c => `<span style="background:${c}"></span>`).join('');
}

// J3 — Apply the generated harmony palette. Mirrors the preset-click path: it writes all 8
// base colours and CLEARS every override (so the new base drives the whole page — no split
// look), then funnels through the one applyGuiStylesToPage chokepoint. theme = 'custom' so no
// preset highlights; the user Saves it under "Your Themes" to keep it.
function actionApplyHarmony() {
    const base = generateHarmonyBase(getValue('harmony-accent'), getValue('harmony-type'), getValue('harmony-mode'));
    const g = store.guiSettingsData;
    g.theme           = 'custom';
    g.primaryBgStart  = base.primaryBgStart;
    g.cardBgStart     = base.cardBgStart;
    g.textColor       = base.textColor;
    g.borderColor     = base.borderColor;
    g.accentColor     = base.accentColor;
    g.colorPositive   = base.colorPositive;
    g.colorNegative   = base.colorNegative;
    g.colorNeutral    = base.colorNeutral;
    g.headingColor    = '';
    g.mutedColor      = '';
    g.headerTextColor = '';
    g.colorEssential  = '';
    g.colorWarning    = '';

    applyGuiStylesToPage();
    syncGuiColorInputs(); // refresh the Customize base/override pickers to the new palette
    renderThemeSwitcher(document.getElementById('theme-switcher-container'));
    renderCustomThemes(document.getElementById('your-themes-container'));
    if (store.autoSave) store.autoSave.onDataChange();
}

// J3 — Upload a custom font file: validate, store (base64), register (FontFace), add it to
// the dropdown, select + apply it. Stays offline (no server / font folder).
export function handleCustomFontUpload(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    const errEl = getElement('gui-font-error');
    const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } };
    if (errEl) errEl.hidden = true;
    if (!file) return;
    if (typeof FontFace === 'undefined') { showErr("This browser can't load custom fonts."); return; }
    if (!/\.(ttf|otf|woff2?|woff)$/i.test(file.name)) { showErr('Use a .ttf, .otf, .woff or .woff2 file.'); return; }
    if (file.size > MAX_FONT_BYTES) { showErr('Font is too large (max 2 MB).'); return; }
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 32) || 'Custom Font';

    const reader = new FileReader();
    reader.onload = (e) => {
        const res = addCustomFont(name, e.target.result);
        if (res === 'limit') { showErr('You have the maximum ' + MAX_CUSTOM_FONTS + ' custom fonts. Remove one first.'); return; }
        if (res === 'quota') { showErr('Not enough storage space for this font. Remove one first.'); return; }
        if (res === 'empty') { showErr("Couldn't read that font file."); return; }
        const sel = getElement('gui-font-family');
        populateCustomFontOptions(sel);
        if (sel) sel.value = customFontStack(name);
        commitGuiText(true); // applies + persists the new font via the chokepoint
        renderCustomFontList(getElement('custom-fonts-list'));
    };
    reader.onerror = () => showErr("Couldn't read that font file.");
    reader.readAsDataURL(file);
}

// J3 — Remove an uploaded font. If it was the active font, fall back to the default.
function actionDeleteCustomFont(name) {
    const stack = customFontStack(name);
    deleteCustomFont(name);
    const sel = getElement('gui-font-family');
    if (store.guiSettingsData.fontFamily === stack) {
        store.guiSettingsData.fontFamily = defaultGuiSettings.fontFamily;
    }
    populateCustomFontOptions(sel);
    if (sel) sel.value = store.guiSettingsData.fontFamily;
    commitGuiText(true);
    renderCustomFontList(getElement('custom-fonts-list'));
}

// J3 — Export the current appearance as a shareable JSON file.
function actionExportTheme() {
    const input = getElement('theme-save-name');
    const nm = (input && input.value.trim())
        || (THEMES[store.guiSettingsData.theme] ? store.guiSettingsData.theme : 'custom');
    const payload = { name: nm, colors: snapshotAppearance() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ft-theme-' + nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// J3 — Import a theme JSON file → save as a custom theme + apply it.
export function handleThemeImport(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const errEl = getElement('theme-save-error');
    const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } };
    const reader = new FileReader();
    reader.onload = (e) => {
        let parsed;
        try { parsed = JSON.parse(e.target.result); }
        catch (_) { showErr("That file isn't valid JSON."); return; }
        const { data, name, error } = parseThemeImport(parsed);
        if (error) { showErr(error); return; }
        let saveName = name;
        if (THEMES[saveName]) saveName += ' (imported)';
        if (saveCustomTheme(saveName, data) === 'limit') {
            showErr('You have the maximum ' + MAX_CUSTOM_THEMES + ' custom themes. Delete one first.');
            return;
        }
        if (errEl) errEl.hidden = true;
        applyCustomTheme(saveName);
        applyGuiStylesToPage();
        syncGuiColorInputs();
        renderThemeSwitcher(document.getElementById('theme-switcher-container'));
        renderCustomThemes(document.getElementById('your-themes-container'));
        if (store.autoSave) store.autoSave.onDataChange();
    };
    reader.readAsText(file);
}

function actionResetGuiToDefaults() {
    // Confirmation handled by the caller's inlineConfirm (H.5).
    store.guiSettingsData = cloneDefaultGuiSettings();
    // initializeGuiSettingsForm → applyGuiStylesToPage applies the full theme base
    // (not just the customisable subset), so the whole UI returns to default cleanly.
    initializeGuiSettingsForm();
    if (store.autoSave) store.autoSave.onDataChange();
    showCustomModal('Appearance reset.');
}
