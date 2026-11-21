// Theme runtime (Phase 1, step A4). Four palettes, each with a dark partner, chosen by two
// attributes on <html>: data-palette (sunrise|bucket|eucalypt|harbour) and data-mode
// (light|dark; absent = Auto, which follows the system). The colours live in
// src/styles/tokens.generated.css; nothing here knows a colour.
//
// FRAGILE: the inline script in index.html head replays the `ft-theme-fouc` cache ({p, m}) before
// CSS loads. This module owns what that cache holds. An old-shape value (a map of CSS properties
// from the retired engine) is ignored by the script and removed here, so it cannot paint old colours.

import { store } from '../state/store.js';
import {
    PALETTE_IDS, MODES, PALETTE_LABELS, migrateAppearance,
} from './palettes.js';

export const FOUC_KEY = 'ft-theme-fouc';
// Keys the retired theme builder, font upload and background effects used (the last was the canvas id). Never renamed, never read, left in place;
// listed so the storage-key gate (G4) still sees them.
export const RETIRED_KEYS = ['ft-custom-themes', 'ft-custom-fonts', 'ft-bg-effect-canvas'];

export const PALETTES = PALETTE_IDS.map((id) => ({ id, label: PALETTE_LABELS[id].label, darkLabel: PALETTE_LABELS[id].darkLabel }));

// Appearance held in guiSettings: `theme` is a palette id ('sunrise' is also a valid old id),
// `colorMode` is auto|light|dark. Old saves keep their colour, font and effect fields unread.
export function readAppearance(g) {
    const s = g && typeof g === 'object' ? g : {};
    const palette = PALETTE_IDS.includes(s.theme) ? s.theme : undefined;
    return migrateAppearance({ palette, mode: s.colorMode, theme: s.theme });
}

// Bring a guiSettings object (fresh, old save or imported backup) onto the new shape. Idempotent.
export function migrateGuiAppearance(g) {
    if (!g || typeof g !== 'object') return g;
    const { palette, mode } = readAppearance(g);
    g.theme = palette;
    g.colorMode = mode;
    return g;
}

// The cache value for a palette and mode, and the reverse. parseFouc returns null for anything
// that is not the new shape (old property maps, junk, bad JSON).
export const foucValue = ({ palette, mode }) => JSON.stringify({ p: palette, m: mode });
export function parseFouc(raw) {
    try {
        const t = JSON.parse(raw);
        if (t && PALETTE_IDS.includes(t.p) && MODES.includes(t.m)) return { palette: t.p, mode: t.m };
    } catch (_) { /* not JSON */ }
    return null;
}

// Remove a stale old-shape cache. Takes a storage so it can be tested; returns true if it removed one.
export function purgeStaleFouc(storage) {
    try {
        const raw = storage.getItem(FOUC_KEY);
        if (raw !== null && !parseFouc(raw)) { storage.removeItem(FOUC_KEY); return true; }
    } catch (_) { /* storage blocked */ }
    return false;
}

function syncThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    const ground = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
    if (meta && ground) meta.setAttribute('content', ground);
}

// The one place the attributes are set. Auto removes data-mode.
export function applyAppearance({ palette, mode }) {
    const a = migrateAppearance({ palette, mode });
    const root = document.documentElement;
    root.dataset.palette = a.palette;
    if (a.mode === 'auto') root.removeAttribute('data-mode'); else root.dataset.mode = a.mode;
    try { localStorage.setItem(FOUC_KEY, foucValue(a)); } catch (_) { /* storage full or blocked */ }
    syncThemeColor();
    return a;
}

// Text size is the only typography control kept (FT-R-73 C10).
export function applyTextSize(g) {
    const n = parseInt(g && g.baseFontSize, 10);
    const px = Number.isFinite(n) ? Math.min(24, Math.max(10, n)) : 16;
    document.documentElement.style.setProperty('--base-font-size', px + 'px');
}

// Normalise the stored settings, then apply them. Safe to call after any load, import or reset.
export function applyStoredAppearance() {
    const g = migrateGuiAppearance(store.guiSettingsData);
    purgeStaleFouc(localStorage);
    const a = applyAppearance(readAppearance(g));
    applyTextSize(g);
    return a;
}

let watching = false;
export function loadTheme() {
    applyStoredAppearance();
    if (!watching && typeof matchMedia === 'function') {
        watching = true; // in Auto the ground changes with the system, so the browser bar follows
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
    }
}

// Swatch helper for the Settings appearance screen (D2) and the stripped modal: one button per palette,
// each showing its light and dark partner from the generated `.pal-sw[data-sw]` classes.
export function renderPaletteSwatches(container, current) {
    if (!container) return;
    container.replaceChildren();
    container.setAttribute('role', 'radiogroup');
    for (const p of PALETTES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-swatch' + (p.id === current.palette ? ' active' : '');
        btn.dataset.palette = p.id;
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', p.id === current.palette ? 'true' : 'false');
        const chips = document.createElement('span');
        chips.className = 'theme-swatch-chips';
        for (const m of ['light', 'dark']) {
            const chip = document.createElement('span');
            chip.className = 'pal-sw';
            chip.dataset.sw = `${p.id}-${m}`;
            chip.setAttribute('aria-hidden', 'true');
            chips.appendChild(chip);
        }
        const name = document.createElement('span');
        name.className = 'swatch-label';
        name.textContent = `${p.label} / ${p.darkLabel}`;
        btn.append(chips, name);
        container.appendChild(btn);
    }
}
