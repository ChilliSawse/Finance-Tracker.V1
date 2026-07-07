// ES module conversion: logic unchanged from js/theme.js; guiSettingsData now lives on the store.
import { store } from '../state/store.js';

// --- START OF: theme.js ---
// Colour utilities lifted from Odysseus (hex.js + theme.js)

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean;
    const num = parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function hexToHSL(hex) {
    let { r, g, b } = hexToRgb(hex);
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function hexToRgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// WCAG-correct sRGB perceived luminance; 0 = black, 1 = white
function perceivedLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lin = c => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// --- Theme Registry ---
// J1 — the 12 presets ported from Odysseus (the codebase this engine came from).
// Each preset is the same 5-colour base Odysseus uses — bg / fg / panel / border /
// accent (Odysseus's `red`) — plus a locked finance-semantic trio so a *positive*
// figure always reads green, never the brand accent (the motivating Net Worth bug).
//   bg       – page background base (a subtle same-hue gradient is derived from it)
//   fg       – primary text
//   panel    – card / content surface base colour
//   border   – dividers / outlines
//   accent   – brand highlight (buttons, links, active states) — NOT the page gradient
//   positive / negative / neutral – finance semantic figures (tuned per light/dark)
const THEMES = {
    light: {
        name: 'Light',
        bg: '#f0ebe3', fg: '#5a5248', panel: '#faf6f0',
        border: '#d4cdc2', accent: '#c47d5a',
        positive: '#2e7d32', negative: '#c62828', neutral: '#1565c0',
    },
    midnight: {
        name: 'Midnight',
        bg: '#0d1117', fg: '#c9d1d9', panel: '#161b22',
        border: '#30363d', accent: '#f85149',
        positive: '#3fb950', negative: '#f85149', neutral: '#58a6ff',
    },
    paper: {
        name: 'Paper',
        bg: '#faf8f5', fg: '#3b3836', panel: '#ffffff',
        border: '#d5d0c8', accent: '#c5ac4a',
        positive: '#2e7d32', negative: '#c0392b', neutral: '#1d6fb8',
    },
    retrowave: {
        name: 'Retrowave',
        bg: '#1a1a2e', fg: '#e94560', panel: '#16213e',
        border: '#533483', accent: '#e94560',
        positive: '#34d399', negative: '#ff4d6d', neutral: '#4cc9f0',
    },
    forest: {
        name: 'Forest',
        bg: '#1b2a1b', fg: '#a8d5a2', panel: '#142414',
        border: '#3d6b3d', accent: '#7cb871',
        positive: '#4ade80', negative: '#ff6b6b', neutral: '#5fa8e8',
    },
    ocean: {
        name: 'Ocean',
        bg: '#0b1a2c', fg: '#64d2ff', panel: '#091422',
        border: '#1e5074', accent: '#4facfe',
        positive: '#2ee6a6', negative: '#ff6b6b', neutral: '#8be9fd',
    },
    ume: {
        name: 'Ume',
        bg: '#2b1b2e', fg: '#f5c2e7', panel: '#1e1420',
        border: '#6c4675', accent: '#f5a0c0',
        positive: '#6ee7a0', negative: '#ff7a90', neutral: '#a5b4fc',
    },
    copper: {
        name: 'Copper',
        bg: '#1c1410', fg: '#e8c39e', panel: '#140f0a',
        border: '#7a5533', accent: '#d4764e',
        positive: '#7cc463', negative: '#e0625a', neutral: '#6fb3d4',
    },
    terminal: {
        name: 'Terminal',
        bg: '#000000', fg: '#00ff41', panel: '#0a0a0a',
        border: '#003b00', accent: '#00ff41',
        positive: '#2ee66a', negative: '#ff5f56', neutral: '#36c5f0',
    },
    organs: {
        name: 'Organs',
        bg: '#0a0406', fg: '#efe1c8', panel: '#15080a',
        border: '#3a1519', accent: '#c83240',
        positive: '#88c057', negative: '#e0524f', neutral: '#7ba7c9',
    },
    lavender: {
        name: 'Lavender',
        bg: '#f3eef8', fg: '#3d3551', panel: '#faf7ff',
        border: '#cec3de', accent: '#9b6dcc',
        positive: '#2f9e44', negative: '#d6453a', neutral: '#4263eb',
    },
    cute: {
        name: 'Cute',
        bg: '#fff0f5', fg: '#d4608a', panel: '#fff8fa',
        border: '#f0c0d0', accent: '#ff6b9d',
        positive: '#2fa866', negative: '#e63950', neutral: '#4c8df0',
    },
};

// J1 — preset set is now the 12 above. 'default'/'dark' (removed) map to the
// closest survivor so older saves keep working. DEFAULT_THEME is the fresh-load
// preset: midnight, for neutral-grey text that reads cleanly under dense figures.
const DEFAULT_THEME = 'midnight';
const THEME_ALIASES = { default: 'midnight', dark: 'midnight' };

// Resolve a saved theme name to a valid preset key (handles removed/aliased names).
function resolveTheme(name) {
    if (THEMES[name]) return name;
    if (name && THEME_ALIASES[name] && THEMES[THEME_ALIASES[name]]) return THEME_ALIASES[name];
    return DEFAULT_THEME;
}

// J1 migration — if a save points at a removed/aliased preset, repoint it AND
// rewrite the customisable colour overlay to the resolved preset's values, so the
// stale overlay can't splatter the old palette over the new base (the "split
// look" bug). No-op when the save already names a valid preset (the user's own
// overlay customisations are then left untouched).
function migrateGuiTheme(gs) {
    if (!gs || THEMES[gs.theme]) return;
    // J3 — a saved custom theme (or a freshly-applied, not-yet-saved 'custom' harmony
    // palette) carries its OWN inline base colours; don't clobber them with a fallback
    // preset's. Only legacy/removed preset names (e.g. 'default'/'dark') fall through.
    if (gs.theme === 'custom' ||
        (typeof loadCustomThemes === 'function' && loadCustomThemes()[gs.theme])) return;
    const preset = THEMES[resolveTheme(gs.theme)];
    const tokens = deriveTokens(preset);
    gs.theme = resolveTheme(gs.theme);
    gs.primaryBgStart  = preset.bg;
    gs.primaryBgEnd    = tokens['--primary-bg-color-end'];
    gs.headerTextColor = tokens['--header-text-color'];
    gs.cardBgStart     = preset.panel;
    gs.cardBgEnd       = tokens['--card-bg-gradient-end'];
    gs.accentColor     = preset.accent;
    gs.colorPositive   = preset.positive;
    gs.colorNegative   = preset.negative;
    gs.colorNeutral    = preset.neutral;
}

// J2 step 2 — backfill the colour fields introduced with the base/override split,
// and neutralise the legacy hardcoded header-text default so topbar text derives its
// own contrast (the old "#ffffff" default was the invisible-on-light-themes bug).
function migrateGuiColorFields(gs) {
    if (!gs) return;
    const preset = THEMES[resolveTheme(gs.theme)] || THEMES[DEFAULT_THEME];
    if (!gs.textColor)   gs.textColor   = preset.fg;
    if (!gs.borderColor) gs.borderColor = preset.border;
    if (gs.headerTextColor === '#ffffff' || gs.headerTextColor === 'white') gs.headerTextColor = '';
    ['headingColor', 'mutedColor', 'headerTextColor', 'colorEssential', 'colorWarning'].forEach(k => {
        if (typeof gs[k] !== 'string') gs[k] = '';
    });
}

// Compute every CSS custom property value from 8 core colours
function deriveTokens(colors) {
    const lum = perceivedLuminance(colors.bg);
    const isDark = lum < 0.55;
    const overlay = isDark ? '#ffffff' : '#000000';

    const [pH, pS, pL] = hexToHSL(colors.panel);
    const panelAlt = hslToHex(pH, pS, isDark ? Math.min(pL + 4, 95) : Math.max(pL - 4, 5));

    // J1 — the page background is a *subtle same-hue* gradient (a gentle shade
    // shift of bg), not bg→accent. The old bg→accent gradient is what made ported
    // themes read muddy/clashing (e.g. midnight navy→red, copper brown→orange); a
    // single-hue wash matches Odysseus's flat backgrounds while keeping faint depth.
    const [bH, bS, bL] = hexToHSL(colors.bg);
    const bgEnd = hslToHex(bH, bS, isDark ? Math.min(bL + 5, 95) : Math.max(bL - 5, 5));

    return {
        '--primary-bg-color-start': colors.bg,
        '--primary-bg-color-end':   bgEnd,
        '--header-text-color':      isDark ? '#ffffff' : colors.fg,
        '--tab-bg-color':           hexToRgba(overlay, 0.1),
        '--tab-active-bg-color':    hexToRgba(overlay, 0.2),
        '--tab-text-color':         hexToRgba(overlay, 0.7),
        '--tab-active-text-color':  overlay,
        '--content-bg-color':       hexToRgba(colors.panel, 0.95),
        '--card-bg-gradient-start': colors.panel,
        '--card-bg-gradient-end':   panelAlt,
        '--border-color':           colors.border,
        '--text-color-primary':     colors.fg,
        '--text-color-secondary':   hexToRgba(colors.fg, 0.6),
        // J2 — headings get their own token (card/section titles), defaulting to the
        // primary text colour so there's no visual change until the user customises it.
        '--heading-color':          colors.fg,
        '--accent-color':           colors.accent,
        '--color-positive':         colors.positive,
        '--color-negative':         colors.negative,
        '--color-neutral':          colors.neutral,
        // I.7 — essentials get a calm, non-alarming tone (spending on needs isn't "bad");
        // non-essentials keep an amber "warning" cue. `--color-warning` was referenced but
        // never defined, so it silently fell back to the text colour — fixed here.
        '--color-essential':        colors.neutral,
        '--color-warning':          '#f59e0b',
        '--essential-tint':         hexToRgba(colors.neutral, 0.08),
        '--warning-tint':           hexToRgba('#f59e0b', 0.1),
        '--info-bg':                hexToRgba(colors.neutral, 0.08),
        '--info-border':            colors.neutral,
        '--positive-tint':          hexToRgba(colors.positive, 0.1),
        '--neutral-tint':           hexToRgba(colors.neutral, 0.1),
        '--negative-tint':          hexToRgba(colors.negative, 0.1),
    };
}

const _FOUC_KEY = 'ft-theme-fouc';

// Apply a full colour palette to the document root and cache for next load
function applyTheme(colors) {
    const tokens = deriveTokens(colors);
    const s = document.documentElement.style;
    for (const [k, v] of Object.entries(tokens)) {
        s.setProperty(k, v);
    }
    const mtc = document.querySelector('meta[name="theme-color"]');
    if (mtc) mtc.setAttribute('content', colors.bg);
    try { localStorage.setItem(_FOUC_KEY, JSON.stringify(tokens)); } catch (_) {}
}

// Apply whatever theme is saved in store.guiSettingsData
function loadTheme() {
    const name = (typeof store.guiSettingsData !== 'undefined' && store.guiSettingsData.theme) || DEFAULT_THEME;
    applyTheme(THEMES[resolveTheme(name)]);
}

// Render preset swatch buttons into a container element
function renderThemeSwitcher(container) {
    if (!container) return;
    // Highlight a preset only when the active theme IS one. A custom theme highlights in
    // the Your Themes grid instead, so no preset should look selected in that case.
    const raw = (typeof store.guiSettingsData !== 'undefined' && store.guiSettingsData.theme) || DEFAULT_THEME;
    const activeName = THEMES[raw] ? raw : '';
    container.innerHTML = '';
    container.className = 'theme-switcher';

    Object.entries(THEMES).forEach(([key, theme]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-swatch' + (key === activeName ? ' active' : '');
        btn.dataset.theme = key;
        btn.title = theme.name;
        btn.setAttribute('aria-pressed', key === activeName ? 'true' : 'false');

        // J2 — Odysseus-style preview: a row of overlapping circles showing the
        // four colours that define the theme's feel (bg / surface / text / accent).
        const colors = document.createElement('span');
        colors.className = 'theme-swatch-colors';
        [theme.bg, theme.panel, theme.fg, theme.accent].forEach(c => {
            const dot = document.createElement('span');
            dot.style.background = c;
            colors.appendChild(dot);
        });

        const label = document.createElement('span');
        label.className = 'swatch-label';
        label.textContent = theme.name;

        btn.appendChild(colors);
        btn.appendChild(label);
        container.appendChild(btn);
    });
}

// --- J3 — custom themes (save / load / delete / import / export) ---
// Offline-only: stored in localStorage (no server, unlike Odysseus). A custom theme is a
// snapshot of the customisable appearance state (base + override colours + font/size).
const CUSTOM_THEMES_KEY = 'ft-custom-themes';
const MAX_CUSTOM_THEMES = 12;

// The appearance fields a custom theme captures (everything the Customize tab edits).
const THEME_SNAPSHOT_KEYS = [
    'primaryBgStart', 'cardBgStart', 'textColor', 'borderColor', 'accentColor',
    'colorPositive', 'colorNegative', 'colorNeutral',
    'headingColor', 'mutedColor', 'headerTextColor', 'colorEssential', 'colorWarning',
    'fontFamily', 'baseFontSize',
];
// The base colours that must be present + valid for an imported theme to be usable.
const THEME_REQUIRED_KEYS = [
    'primaryBgStart', 'cardBgStart', 'textColor', 'borderColor', 'accentColor',
    'colorPositive', 'colorNegative', 'colorNeutral',
];

function snapshotAppearance() {
    const snap = {};
    THEME_SNAPSHOT_KEYS.forEach(k => { snap[k] = store.guiSettingsData[k]; });
    return snap;
}

function loadCustomThemes() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY)) || {}; }
    catch (_) { return {}; }
}
function _saveCustomThemesObj(obj) {
    try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(obj)); } catch (_) {}
}

// Returns 'ok' | 'limit' (cap reached for a NEW name) | 'empty' (no name).
function saveCustomTheme(name, data) {
    name = (name || '').trim();
    if (!name) return 'empty';
    const ct = loadCustomThemes();
    if (!ct[name] && Object.keys(ct).length >= MAX_CUSTOM_THEMES) return 'limit';
    ct[name] = data || snapshotAppearance();
    _saveCustomThemesObj(ct);
    return 'ok';
}

function deleteCustomTheme(name) {
    const ct = loadCustomThemes();
    delete ct[name];
    _saveCustomThemesObj(ct);
}

// Copy a saved custom theme's fields into store.guiSettingsData and mark it active.
function applyCustomTheme(name) {
    const data = loadCustomThemes()[name];
    if (!data) return false;
    store.guiSettingsData.theme = name; // active = this custom name (not a preset)
    THEME_SNAPSHOT_KEYS.forEach(k => { if (data[k] !== undefined) store.guiSettingsData[k] = data[k]; });
    return true;
}

// Validate a parsed import payload (its own export shape, or a raw snapshot).
// Returns { data, name } on success or { error } on failure.
function parseThemeImport(parsed) {
    if (!parsed || typeof parsed !== 'object') return { error: 'Not a theme file.' };
    const data = parsed.colors && typeof parsed.colors === 'object' ? parsed.colors : parsed;
    const missing = THEME_REQUIRED_KEYS.filter(k => !data[k]);
    if (missing.length) return { error: 'Missing colours: ' + missing.join(', ') };
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    const bad = THEME_REQUIRED_KEYS.find(k => !hexRe.test(data[k]));
    if (bad) return { error: 'Invalid colour for ' + bad };
    const clean = {};
    THEME_SNAPSHOT_KEYS.forEach(k => { if (data[k] !== undefined) clean[k] = data[k]; });
    return { data: clean, name: (parsed.name || 'imported').toString().slice(0, 32) };
}

// Render saved custom themes into the "Your Themes" grid (toggles the card's visibility).
function renderCustomThemes(container) {
    if (!container) return;
    const card = document.getElementById('your-themes-card');
    const ct = loadCustomThemes();
    const names = Object.keys(ct);
    container.innerHTML = '';
    if (!names.length) { if (card) card.hidden = true; return; }
    if (card) card.hidden = false;
    const active = (typeof store.guiSettingsData !== 'undefined') ? store.guiSettingsData.theme : '';

    names.forEach(name => {
        const data = ct[name];
        // Wrapper holds the swatch button + a sibling delete button (a <button> can't be
        // nested inside another <button>).
        const wrap = document.createElement('div');
        wrap.className = 'theme-swatch-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-swatch' + (name === active ? ' active' : '');
        btn.dataset.theme = name;
        btn.dataset.custom = '1';
        btn.title = name;

        const colors = document.createElement('span');
        colors.className = 'theme-swatch-colors';
        [data.primaryBgStart, data.cardBgStart, data.textColor, data.accentColor].forEach(c => {
            const dot = document.createElement('span');
            dot.style.background = c || '#000000';
            colors.appendChild(dot);
        });

        const label = document.createElement('span');
        label.className = 'swatch-label';
        label.textContent = name;

        btn.appendChild(colors);
        btn.appendChild(label);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'theme-delete-btn';
        del.dataset.delete = name;
        del.title = 'Delete theme';
        del.setAttribute('aria-label', 'Delete theme ' + name);
        del.innerHTML = "<svg viewBox='0 0 24 24' width='12' height='12' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' aria-hidden='true'><line x1='6' y1='6' x2='18' y2='18'/><line x1='18' y1='6' x2='6' y2='18'/></svg>";

        wrap.appendChild(btn);
        wrap.appendChild(del);
        container.appendChild(wrap);
    });
}

// --- J3 — Colour Harmony generator ---
// Ported from Odysseus's generateHarmonyColors(accentHex, harmonyType, mode): a chosen
// accent + a harmony rule auto-derive a full STRUCTURAL palette (bg / surface / text /
// border) around it. Adapted to FT's base fields. The finance SEMANTIC trio is NOT derived
// from the accent hue (that's the J0 bug — a red accent would paint positives red); it uses
// a mode-tuned locked green/red/blue, matching the J1 presets, so positives always read
// green. Returns the 8 base fields applyGuiStylesToPage feeds to deriveTokens.
const HARMONY_SEMANTICS = {
    dark:  { positive: '#3fb950', negative: '#f85149', neutral: '#58a6ff' },
    light: { positive: '#2e7d32', negative: '#c62828', neutral: '#1565c0' },
};

function generateHarmonyBase(accentHex, harmonyType, mode) {
    accentHex = accentHex || '#f85149';
    const [h, s] = hexToHSL(accentHex);
    const isDark = mode !== 'light';

    let bgH, bgS, bgL, fgS, fgL, panelL, borderH, borderS, borderL;

    if (harmonyType === 'complementary') {
        bgH = h; bgS = Math.max(s * 0.15, 3);
        bgL = isDark ? 13 : 95; fgL = isDark ? 85 : 15; fgS = Math.max(s * 0.2, 5);
        panelL = isDark ? 8 : 98;
        borderH = h; borderS = Math.max(s * 0.25, 8); borderL = isDark ? 28 : 75;
    } else if (harmonyType === 'analogous') {
        bgH = (h - 30 + 360) % 360; bgS = Math.max(s * 0.12, 3);
        bgL = isDark ? 14 : 95; fgL = isDark ? 84 : 18; fgS = Math.max(s * 0.15, 5);
        panelL = isDark ? 9 : 97;
        borderH = (h + 30) % 360; borderS = Math.max(s * 0.3, 10); borderL = isDark ? 30 : 72;
    } else if (harmonyType === 'triadic') {
        bgH = (h + 240) % 360; bgS = Math.max(s * 0.1, 2);
        bgL = isDark ? 13 : 96; fgL = isDark ? 86 : 14; fgS = Math.max(s * 0.18, 5);
        panelL = isDark ? 8 : 99;
        borderH = (h + 120) % 360; borderS = Math.max(s * 0.2, 8); borderL = isDark ? 28 : 74;
    } else { // monochromatic
        bgH = h; bgS = Math.max(s * 0.08, 2);
        bgL = isDark ? 12 : 96; fgL = isDark ? 87 : 13; fgS = Math.max(s * 0.15, 5);
        panelL = isDark ? 7 : 99;
        borderH = h; borderS = Math.max(s * 0.2, 6); borderL = isDark ? 26 : 76;
    }

    const sem = HARMONY_SEMANTICS[isDark ? 'dark' : 'light'];
    return {
        primaryBgStart: hslToHex(bgH, bgS, bgL),
        cardBgStart:    hslToHex(bgH, bgS * 0.6, panelL),
        textColor:      hslToHex(h, fgS, fgL),
        borderColor:    hslToHex(borderH, borderS, borderL),
        accentColor:    accentHex,
        colorPositive:  sem.positive,
        colorNegative:  sem.negative,
        colorNeutral:   sem.neutral,
    };
}

// --- J3 — custom font upload (offline: FontFace API + localStorage) ---
// FT has no static/fonts/custom/ folder to scan (the one behavioural divergence from
// Odysseus), so uploaded fonts are base64-encoded into localStorage and registered with the
// browser via the FontFace API. Each becomes an <option> in the font dropdown; its CSS value
// is a quoted family + a safe fallback. Capped + size-limited to stay inside the quota.
const CUSTOM_FONTS_KEY = 'ft-custom-fonts';
const MAX_CUSTOM_FONTS = 4;
const MAX_FONT_BYTES = 2 * 1024 * 1024; // 2 MB per font — localStorage quota guard

function loadCustomFontStore() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_FONTS_KEY)) || {}; }
    catch (_) { return {}; }
}
function _saveCustomFontStore(obj) {
    try { localStorage.setItem(CUSTOM_FONTS_KEY, JSON.stringify(obj)); return true; }
    catch (_) { return false; } // quota exceeded
}

// The CSS font-family value for a custom font (quoted name + a safe generic fallback).
function customFontStack(name) {
    return "'" + String(name).replace(/'/g, '') + "', sans-serif";
}

// Register one font with the browser. dataUrl is a base64 data: URL. Async (FontFace.load).
function registerCustomFont(name, dataUrl) {
    if (!name || !dataUrl || typeof FontFace === 'undefined') return Promise.resolve(false);
    try {
        const ff = new FontFace(name, 'url(' + dataUrl + ')');
        return ff.load().then(loaded => { document.fonts.add(loaded); return true; })
                        .catch(() => false);
    } catch (_) { return Promise.resolve(false); }
}

// Drop a font's live registration (so a removed font stops resolving without a reload).
function unregisterCustomFont(name) {
    if (typeof document === 'undefined' || !document.fonts) return;
    try {
        const dead = [];
        document.fonts.forEach(ff => { if (ff.family === name) dead.push(ff); });
        dead.forEach(ff => document.fonts.delete(ff));
    } catch (_) {}
}

// Register every stored custom font at startup, so a saved selection actually renders.
function registerStoredCustomFonts() {
    const store = loadCustomFontStore();
    Object.keys(store).forEach(name => registerCustomFont(name, store[name]));
}

// Save + register an uploaded font. Returns 'ok' | 'empty' | 'limit' | 'quota'.
function addCustomFont(name, dataUrl) {
    name = (name || '').trim();
    if (!name || !dataUrl) return 'empty';
    const store = loadCustomFontStore();
    if (!store[name] && Object.keys(store).length >= MAX_CUSTOM_FONTS) return 'limit';
    const prev = store[name];
    store[name] = dataUrl;
    if (!_saveCustomFontStore(store)) {
        if (prev === undefined) delete store[name]; else store[name] = prev; // roll back the in-memory copy
        return 'quota';
    }
    registerCustomFont(name, dataUrl);
    return 'ok';
}

function deleteCustomFont(name) {
    const store = loadCustomFontStore();
    delete store[name];
    _saveCustomFontStore(store);
    unregisterCustomFont(name);
}

// Append an <optgroup> of stored custom fonts to the font <select> (rebuilt each call).
function populateCustomFontOptions(selectEl) {
    if (!selectEl) return;
    const existing = selectEl.querySelector('optgroup.custom-fonts');
    if (existing) existing.remove();
    const names = Object.keys(loadCustomFontStore());
    if (!names.length) return;
    const group = document.createElement('optgroup');
    group.label = 'Your fonts';
    group.className = 'custom-fonts';
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = customFontStack(name);
        opt.textContent = name;
        group.appendChild(opt);
    });
    selectEl.appendChild(group);
}

// Render the removable list of uploaded fonts under the upload control.
function renderCustomFontList(container) {
    if (!container) return;
    const names = Object.keys(loadCustomFontStore());
    container.innerHTML = '';
    names.forEach(name => {
        const row = document.createElement('div');
        row.className = 'custom-font-row';
        const label = document.createElement('span');
        label.className = 'custom-font-name';
        label.style.fontFamily = customFontStack(name);
        label.textContent = name;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'theme-delete-btn';
        del.dataset.font = name;
        del.title = 'Remove font';
        del.setAttribute('aria-label', 'Remove font ' + name);
        del.innerHTML = "<svg viewBox='0 0 24 24' width='12' height='12' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' aria-hidden='true'><line x1='6' y1='6' x2='18' y2='18'/><line x1='18' y1='6' x2='6' y2='18'/></svg>";
        row.appendChild(label);
        row.appendChild(del);
        container.appendChild(row);
    });
}

// --- J4 — decorative background effects (ported from Odysseus) ---
// constellations / petals / rain / synapse / sparkles / embers / perlin-flow. Each is a
// full-viewport <canvas> prepended behind the app shell (z-index 0; .app-shell sits at z-index 1).
// Self-terminating: the draw loop bails the moment the body's bg-effect-<name> class is gone, so
// switching/clearing tears the canvas down. Gated behind prefers-reduced-motion + a small-viewport
// perf guard (bgEffectsAllowed).
const BG_EFFECT_NAMES = ['constellations', 'petals', 'rain', 'synapse', 'sparkles', 'embers', 'perlin-flow'];

// Respect the user's motion preference; otherwise run on phones too (down to ~360px).
// Phones get a lighter version (fewer particles + lower DPR — see the _bg* helpers below)
// so the canvas loops stay smooth and easy on the battery.
function bgEffectsAllowed() {
    try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (_) {}
    return window.innerWidth >= 360;
}

// Mobile-friendly tuning (effects on phones): below this width we treat the device as a
// phone and dial the per-frame cost down.
const _BG_SMALL_BP = 700;
function _bgIsSmall() { return window.innerWidth < _BG_SMALL_BP; }
// DPR cap: 1.5 on phones (a full-screen canvas at 3× is expensive), 2 elsewhere.
function _bgDpr() { return Math.min(window.devicePixelRatio || 1, _bgIsSmall() ? 1.5 : 2); }
// Particle density: ~half the particles on phones. _bgCount scales a desktop count.
function _bgScale() { return _bgIsSmall() ? 0.5 : 1; }
function _bgCount(n) { return Math.max(1, Math.round(n * _bgScale())); }

// Effect tint: an explicit --bg-effect-color, else the accent, else primary text.
function _bgEffectColor() {
    const s = getComputedStyle(document.documentElement);
    return (s.getPropertyValue('--bg-effect-color').trim()
        || s.getPropertyValue('--accent-color').trim()
        || s.getPropertyValue('--text-color-primary').trim()
        || '#9cdef2');
}

function _makeEffectCanvas(name) {
    const canvas = document.createElement('canvas');
    canvas.id = name + '-canvas';
    canvas.className = 'ft-bg-effect-canvas';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    canvas.setAttribute('aria-hidden', 'true'); // decorative — keep it out of the a11y tree
    document.body.prepend(canvas);
    return canvas;
}

// Convert a CSS colour (hex or rgb()) to an rgba() string — needed by effects that build
// radial-gradient glows (embers) where the tint must carry a per-stop alpha.
function _bgRgba(color, a) {
    color = (color || '').trim();
    let r = 156, g = 222, b = 242; // fallback #9cdef2
    if (color[0] === '#') {
        let h = color.slice(1);
        if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
        if (h.length >= 6) { r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); }
    } else {
        const m = color.match(/[\d.]+/g);
        if (m && m.length >= 3) { r = +m[0]; g = +m[1]; b = +m[2]; }
    }
    return `rgba(${r},${g},${b},${a})`;
}

// Cheap value-noise (hash → smoothstep-interpolated), for the perlin-flow flow field.
function _bgNoise2d(x, y) { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); }
function _bgSmoothNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const a = _bgNoise2d(ix, iy), b = _bgNoise2d(ix + 1, iy), cc = _bgNoise2d(ix, iy + 1), d = _bgNoise2d(ix + 1, iy + 1);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy;
}

// ── Rain — thin falling streaks ──
function _ftRain() {
    if (document.getElementById('rain-canvas')) return;
    const canvas = _makeEffectCanvas('rain');
    const ctx = canvas.getContext('2d');
    const dpr = _bgDpr();
    let W, H;
    const drops = [];
    const MAX_DROPS = _bgCount(130);
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const _onResize = () => resize();
    window.addEventListener('resize', _onResize);
    function spawn() {
        const len = 20 + Math.random() * 40;
        drops.push({ x: Math.random() * W, y: -len, len, speed: 4 + Math.random() * 8, alpha: 0.32 + Math.random() * 0.28 });
    }
    function draw() {
        if (!document.body.classList.contains('bg-effect-rain')) { window.removeEventListener('resize', _onResize); canvas.remove(); return; }
        requestAnimationFrame(draw);
        ctx.clearRect(0, 0, W, H);
        const c = _bgEffectColor();
        if (drops.length < MAX_DROPS && Math.random() < 0.6) spawn();
        for (let i = drops.length - 1; i >= 0; i--) {
            const d = drops[i];
            d.y += d.speed;
            if (d.y > H + d.len) { drops.splice(i, 1); continue; }
            const grad = ctx.createLinearGradient(d.x, d.y - d.len, d.x, d.y);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(1, c);
            ctx.strokeStyle = grad;
            ctx.globalAlpha = d.alpha;
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y - d.len);
            ctx.lineTo(d.x, d.y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
    draw();
}

// ── Constellations — drifting stars that link when close + twinkle ──
function _ftConstellations() {
    if (document.getElementById('constellations-canvas')) return;
    const canvas = _makeEffectCanvas('constellations');
    const ctx = canvas.getContext('2d');
    const dpr = _bgDpr();
    let W, H;
    const STAR_COUNT = _bgCount(50), CONNECT_DIST = 120;
    let stars = [];
    function initStars() {
        stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * W, y: Math.random() * H,
                vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
                r: 0.8 + Math.random() * 0.8, phase: Math.random() * Math.PI * 2,
            });
        }
    }
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (stars.length === 0) initStars();
    }
    resize();
    const _onResize = () => { resize(); initStars(); };
    window.addEventListener('resize', _onResize);
    let t = 0;
    function draw() {
        if (!document.body.classList.contains('bg-effect-constellations')) { window.removeEventListener('resize', _onResize); canvas.remove(); return; }
        requestAnimationFrame(draw);
        t += 0.01;
        ctx.clearRect(0, 0, W, H);
        const c = _bgEffectColor();
        for (const s of stars) {
            s.x += s.vx; s.y += s.vy;
            if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
            if (s.y < 0) s.y = H; if (s.y > H) s.y = 0;
        }
        ctx.strokeStyle = c; ctx.lineWidth = 0.5;
        for (let i = 0; i < stars.length; i++) {
            for (let j = i + 1; j < stars.length; j++) {
                const dx = stars[i].x - stars[j].x, dy = stars[i].y - stars[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONNECT_DIST) {
                    ctx.globalAlpha = (1 - dist / CONNECT_DIST) * 0.15;
                    ctx.beginPath();
                    ctx.moveTo(stars[i].x, stars[i].y);
                    ctx.lineTo(stars[j].x, stars[j].y);
                    ctx.stroke();
                }
            }
        }
        ctx.fillStyle = c;
        for (const s of stars) {
            const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + s.phase);
            ctx.globalAlpha = 0.15 + twinkle * 0.25;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    draw();
}

// ── Petals — gentle drifting, wobbling petals ──
function _ftPetals() {
    if (document.getElementById('petals-canvas')) return;
    const canvas = _makeEffectCanvas('petals');
    const ctx = canvas.getContext('2d');
    const dpr = _bgDpr();
    let W, H;
    const petals = [];
    function makePetal() {
        return {
            x: Math.random() * W, y: -10 - Math.random() * 40,
            size: 3 + Math.random() * 5, rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 0.03, vy: 0.3 + Math.random() * 0.6,
            drift: Math.random() * Math.PI * 2, driftSpeed: 0.008 + Math.random() * 0.012,
            wobble: 0.3 + Math.random() * 0.8,
        };
    }
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (petals.length === 0) for (let i = 0; i < _bgCount(30); i++) { const p = makePetal(); p.y = Math.random() * H; petals.push(p); }
    }
    resize();
    const _onResize = () => resize();
    window.addEventListener('resize', _onResize);
    function draw() {
        if (!document.body.classList.contains('bg-effect-petals')) { window.removeEventListener('resize', _onResize); canvas.remove(); return; }
        requestAnimationFrame(draw);
        ctx.clearRect(0, 0, W, H);
        const c = _bgEffectColor();
        petals.forEach(p => {
            p.y += p.vy; p.rot += p.vr; p.drift += p.driftSpeed;
            p.x += Math.sin(p.drift) * p.wobble;
            if (p.y > H + 15) Object.assign(p, makePetal());
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = c;
            ctx.globalAlpha = 0.2;
            ctx.beginPath(); ctx.ellipse(-p.size * 0.2, 0, p.size * 0.6, p.size * 0.3, 0.3, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 0.15;
            ctx.beginPath(); ctx.ellipse(p.size * 0.2, 0, p.size * 0.6, p.size * 0.3, -0.3, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        });
        ctx.globalAlpha = 1;
    }
    draw();
}

// ── Synapse — bright pulses racing along an invisible grid ──
function _ftSynapse() {
    if (document.getElementById('synapse-canvas')) return;
    const canvas = _makeEffectCanvas('synapse');
    const ctx = canvas.getContext('2d');
    const dpr = _bgDpr();
    const GRID = 24, MAX_PULSES = _bgCount(20), SPEED_MIN = 2, SPEED_MAX = 22, TRAIL_LEN = 12;
    let W, H, cols, rows;
    const pulses = [];
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cols = Math.ceil(W / GRID); rows = Math.ceil(H / GRID);
    }
    resize();
    const _onResize = () => resize();
    window.addEventListener('resize', _onResize);
    function spawnPulse() {
        const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
        if (Math.random() > 0.5) {
            pulses.push({ x: -TRAIL_LEN, y: Math.floor(Math.random() * (rows + 1)) * GRID, dx: speed, dy: 0 });
        } else {
            pulses.push({ x: Math.floor(Math.random() * (cols + 1)) * GRID, y: -TRAIL_LEN, dx: 0, dy: speed });
        }
    }
    function draw() {
        if (!document.body.classList.contains('bg-effect-synapse')) { window.removeEventListener('resize', _onResize); canvas.remove(); return; }
        requestAnimationFrame(draw);
        ctx.clearRect(0, 0, W, H);
        const c = _bgEffectColor();
        if (pulses.length < MAX_PULSES && Math.random() < 0.12) spawnPulse();
        for (let i = pulses.length - 1; i >= 0; i--) {
            const p = pulses[i];
            p.x += p.dx; p.y += p.dy;
            if (p.x > W + TRAIL_LEN || p.y > H + TRAIL_LEN) { pulses.splice(i, 1); continue; }
            const tx = p.x - (p.dx > 0 ? TRAIL_LEN : 0);
            const ty = p.y - (p.dy > 0 ? TRAIL_LEN : 0);
            const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(1, c);
            ctx.strokeStyle = grad; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(p.x, p.y); ctx.stroke();
            ctx.globalAlpha = 0.55; ctx.fillStyle = c;
            ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    draw();
}

// ── Sparkles — twinkling 4-point stars fading in and out ──
function _ftSparkles() {
    if (document.getElementById('sparkles-canvas')) return;
    const canvas = _makeEffectCanvas('sparkles');
    const ctx = canvas.getContext('2d');
    const dpr = _bgDpr();
    let W, H;
    const sparkles = [];
    function makeSpark() {
        return { x: Math.random() * W, y: Math.random() * H, size: 2 + Math.random() * 5, phase: Math.random() * Math.PI * 2, speed: 0.015 + Math.random() * 0.03, life: 0.5 + Math.random() * 0.5 };
    }
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (sparkles.length === 0) for (let i = 0; i < _bgCount(35); i++) sparkles.push(makeSpark());
    }
    resize();
    const _onResize = () => resize();
    window.addEventListener('resize', _onResize);
    function drawStar(x, y, r, c, alpha) {
        ctx.save(); ctx.translate(x, y); ctx.fillStyle = c; ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.15, -r * 0.15, r, 0);
        ctx.quadraticCurveTo(r * 0.15, r * 0.15, 0, r);
        ctx.quadraticCurveTo(-r * 0.15, r * 0.15, -r, 0);
        ctx.quadraticCurveTo(-r * 0.15, -r * 0.15, 0, -r);
        ctx.fill(); ctx.restore();
    }
    function draw() {
        if (!document.body.classList.contains('bg-effect-sparkles')) { window.removeEventListener('resize', _onResize); canvas.remove(); return; }
        requestAnimationFrame(draw);
        ctx.clearRect(0, 0, W, H);
        const c = _bgEffectColor();
        sparkles.forEach(s => {
            s.phase += s.speed;
            const twinkle = Math.sin(s.phase);
            const alpha = Math.max(0, twinkle) * 0.25 * s.life;
            const scale = 0.5 + Math.max(0, twinkle) * 0.5;
            if (alpha > 0.01) drawStar(s.x, s.y, s.size * scale, c, alpha);
            if (s.phase > Math.PI * 6) Object.assign(s, makeSpark());
        });
        ctx.globalAlpha = 1;
    }
    draw();
}

// ── Embers — warm particles rising with an additive glow + occasional spark bursts ──
function _ftEmbers() {
    if (document.getElementById('embers-canvas')) return;
    const canvas = _makeEffectCanvas('embers');
    const ctx = canvas.getContext('2d');
    const dpr = _bgDpr();
    let W, H;
    const embers = [];
    function makeEmber() {
        return {
            x: Math.random() * W, y: H + Math.random() * 40,
            vx: (Math.random() - 0.5) * 0.3, vy: -0.3 - Math.random() * 0.8,
            r: 0.3 + Math.random() * 0.6, life: 0, maxLife: 220 + Math.random() * 220,
            wobble: Math.random() * Math.PI * 2, spark: false,
        };
    }
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (embers.length === 0) for (let i = 0; i < _bgCount(60); i++) { const e = makeEmber(); e.y = Math.random() * H; e.life = Math.random() * e.maxLife; embers.push(e); }
    }
    resize();
    const _onResize = () => resize();
    window.addEventListener('resize', _onResize);
    function draw() {
        if (!document.body.classList.contains('bg-effect-embers')) { window.removeEventListener('resize', _onResize); canvas.remove(); return; }
        requestAnimationFrame(draw);
        // Fade the previous frame toward transparent so trails decay (keeps the canvas see-through).
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        const color = _bgEffectColor();
        for (let i = embers.length - 1; i >= 0; i--) {
            const e = embers[i];
            e.wobble += 0.03;
            e.x += e.vx + Math.sin(e.wobble) * 0.5;
            e.y += e.vy;
            e.life++;
            if (e.life > e.maxLife || e.y < -20) {
                embers.splice(i, 1);
                if (embers.length < _bgCount(70)) embers.push(makeEmber());
                continue;
            }
            if (!e.spark && Math.random() < 0.003) e.spark = true;
            const lifeRatio = e.life / e.maxLife;
            const fade = Math.min(1, Math.min(lifeRatio * 4, (1 - lifeRatio) * 3));
            const r = e.r * (e.spark ? 2.4 : 1);
            const a = (e.spark ? 0.9 : 0.55) * fade;
            const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 4);
            g.addColorStop(0, _bgRgba(color, a));
            g.addColorStop(0.4, _bgRgba(color, a * 0.3));
            g.addColorStop(1, _bgRgba(color, 0));
            ctx.fillStyle = g;
            ctx.fillRect(e.x - r * 4, e.y - r * 4, r * 8, r * 8);
            ctx.fillStyle = _bgRgba('#ffffff', a * 0.6);
            ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.5, 0, Math.PI * 2); ctx.fill();
            e.spark = false;
        }
        if (Math.random() < 0.015) {
            const bx = Math.random() * W;
            for (let i = 0; i < 5; i++) { const e = makeEmber(); e.x = bx + (Math.random() - 0.5) * 40; e.y = H - 10; e.vy *= 1.5; embers.push(e); }
        }
        ctx.globalCompositeOperation = 'source-over';
    }
    draw();
}

// ── Perlin Flow — particles streaming along a smooth, organic flow field ──
function _ftPerlinFlow() {
    if (document.getElementById('perlin-flow-canvas')) return;
    const canvas = _makeEffectCanvas('perlin-flow');
    const ctx = canvas.getContext('2d');
    const dpr = _bgDpr();
    let W, H, t = 0;
    const particles = [];
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (particles.length === 0) for (let i = 0; i < 130; i++) particles.push({ x: Math.random() * W, y: Math.random() * H, life: Math.random() });
    }
    resize();
    const _onResize = () => resize();
    window.addEventListener('resize', _onResize);
    // Direct Odysseus port: fade by painting the page background over the canvas at a low alpha
    // (source-over). That's a convex blend toward the bg, so streams stay soft + bounded — a hot
    // streamline can never exceed the streak colour (the additive `destination-out` version went
    // fully opaque = "messy"). FT has no single `--bg`, so we use the primary-bg end stop; cached
    // so we only re-parse on a theme change. Trade-off: this effect's canvas fills to a flat bg
    // tone rather than letting the page gradient show through (exactly how Odysseus looks).
    let _cachedBg = '', _fadeStyle = 'rgba(13,17,23,0.04)';
    function getFade() {
        const cs = getComputedStyle(document.documentElement);
        const bg = (cs.getPropertyValue('--primary-bg-color-end').trim()
            || cs.getPropertyValue('--primary-bg-color-start').trim() || '#0d1117');
        if (bg !== _cachedBg) { _cachedBg = bg; _fadeStyle = _bgRgba(bg, 0.04); }
        return _fadeStyle;
    }
    function draw() {
        if (!document.body.classList.contains('bg-effect-perlin-flow')) { window.removeEventListener('resize', _onResize); canvas.remove(); return; }
        requestAnimationFrame(draw);
        ctx.fillStyle = getFade();
        ctx.fillRect(0, 0, W, H);
        const c = _bgEffectColor();
        particles.forEach(p => {
            const n = _bgSmoothNoise(p.x * 0.004 + t * 0.0008, p.y * 0.004 + 100);
            const angle = n * Math.PI * 6;
            const speed = 1 + _bgSmoothNoise(p.x * 0.003, p.y * 0.003 + 50) * 1.5;
            p.x += Math.cos(angle) * speed; p.y += Math.sin(angle) * speed; p.life -= 0.001;
            if (p.life <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) { p.x = Math.random() * W; p.y = Math.random() * H; p.life = 1; }
            ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
            ctx.fillStyle = c; ctx.globalAlpha = p.life * 0.15; ctx.fill();
        });
        ctx.globalAlpha = 1;
        t++;
    }
    draw();
}

const BG_EFFECTS = {
    constellations: _ftConstellations, petals: _ftPetals, rain: _ftRain,
    synapse: _ftSynapse, sparkles: _ftSparkles, embers: _ftEmbers,
    // 'perlin-flow' is temporarily disabled — the flow-field look is unresolved (an issue
    // inherited from the Odysseus original). _ftPerlinFlow is kept above to revisit later;
    // it's left out of this registry (and the index.html dropdown) so it can't be selected,
    // and any save still pointing at it falls back to 'none' in applyBackgroundEffect.
    // 'perlin-flow': _ftPerlinFlow,
};

// The one entry point: switch to the requested effect (or none). Honours the perf/motion
// guard — the stored preference is kept either way, so an effect a desktop user picked simply
// lies dormant on a phone or with reduced-motion on. Idempotent: when the wanted state already
// matches what's running it does nothing, so it's safe to call on every modal open (no flicker).
function applyBackgroundEffect(name) {
    if (typeof document === 'undefined' || !document.body) return;
    const body = document.body;
    const current = BG_EFFECT_NAMES.find(n => body.classList.contains('bg-effect-' + n)) || 'none';
    const wanted = (name && BG_EFFECTS[name] && bgEffectsAllowed()) ? name : 'none';
    if (current === wanted) return;
    BG_EFFECT_NAMES.forEach(n => body.classList.remove('bg-effect-' + n));
    document.querySelectorAll('.ft-bg-effect-canvas').forEach(c => c.remove());
    if (wanted === 'none') return;
    body.classList.add('bg-effect-' + wanted);
    BG_EFFECTS[wanted]();
}

// Optional custom tint for the effect. A non-empty value pins `--bg-effect-color` (which every
// effect reads live each frame); empty removes it so `_bgEffectColor()` falls back to the accent.
// Decorative — not part of the colour-token chokepoint, hence its own entry point.
function applyBgEffectColor(color) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const root = document.documentElement;
    if (color) root.style.setProperty('--bg-effect-color', color);
    else root.style.removeProperty('--bg-effect-color');
}

// --- END OF: theme.js ---

export {
    hexToRgb, hexToHSL, hslToHex, hexToRgba, perceivedLuminance,
    THEMES, DEFAULT_THEME, resolveTheme, migrateGuiTheme, migrateGuiColorFields,
    deriveTokens, applyTheme, loadTheme, renderThemeSwitcher,
    MAX_CUSTOM_THEMES, snapshotAppearance, loadCustomThemes, saveCustomTheme,
    deleteCustomTheme, applyCustomTheme, parseThemeImport, renderCustomThemes,
    generateHarmonyBase,
    MAX_CUSTOM_FONTS, MAX_FONT_BYTES, customFontStack, registerStoredCustomFonts,
    addCustomFont, deleteCustomFont, populateCustomFontOptions, renderCustomFontList,
    applyBackgroundEffect, applyBgEffectColor,
};
