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

// Apply whatever theme is saved in guiSettingsData
function loadTheme() {
    const name = (typeof guiSettingsData !== 'undefined' && guiSettingsData.theme) || DEFAULT_THEME;
    applyTheme(THEMES[resolveTheme(name)]);
}

// Render preset swatch buttons into a container element
function renderThemeSwitcher(container) {
    if (!container) return;
    const activeName = resolveTheme((typeof guiSettingsData !== 'undefined' && guiSettingsData.theme) || DEFAULT_THEME);
    container.innerHTML = '';
    container.className = 'theme-switcher';

    Object.entries(THEMES).forEach(([key, theme]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-swatch' + (key === activeName ? ' active' : '');
        btn.dataset.theme = key;
        btn.title = theme.name;
        btn.setAttribute('aria-pressed', key === activeName ? 'true' : 'false');
        btn.style.background = `linear-gradient(135deg, ${theme.bg} 0%, ${theme.accent} 100%)`;

        const dot = document.createElement('span');
        dot.className = 'swatch-dot';
        dot.style.background = theme.panel;
        dot.style.borderColor = theme.accent;

        const label = document.createElement('span');
        label.className = 'swatch-label';
        label.textContent = theme.name;

        btn.appendChild(dot);
        btn.appendChild(label);
        container.appendChild(btn);
    });
}

// --- END OF: theme.js ---
