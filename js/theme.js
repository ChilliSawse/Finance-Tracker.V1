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
// Each preset defines 8 core colours; everything else is derived.
//   bg      – gradient start / page background
//   accent  – gradient end / brand highlight
//   panel   – card / content area base colour
//   positive / negative / neutral – finance semantic tokens
const THEMES = {
    default: {
        name: 'Default',
        bg: '#667eea', fg: '#333333', panel: '#ffffff',
        border: '#e0e0e0', accent: '#764ba2',
        positive: '#4CAF50', negative: '#f44336', neutral: '#2196F3',
    },
    midnight: {
        name: 'Midnight',
        bg: '#0d1117', fg: '#e2e8f0', panel: '#161b22',
        border: '#30363d', accent: '#d97706',
        positive: '#22c55e', negative: '#ef4444', neutral: '#60a5fa',
    },
    dark: {
        name: 'Dark',
        bg: '#282c34', fg: '#9cdef2', panel: '#1d2027',
        border: '#355a66', accent: '#e06c75',
        positive: '#50fa7b', negative: '#ff5555', neutral: '#8be9fd',
    },
    light: {
        name: 'Light',
        bg: '#f0ebe3', fg: '#5a5248', panel: '#faf6f0',
        border: '#d4cdc2', accent: '#c47d5a',
        positive: '#2e7d32', negative: '#c62828', neutral: '#1565c0',
    },
    ocean: {
        name: 'Ocean',
        bg: '#0b1a2c', fg: '#64d2ff', panel: '#091422',
        border: '#1e5074', accent: '#4facfe',
        positive: '#50fa7b', negative: '#ff5555', neutral: '#8be9fd',
    },
    forest: {
        name: 'Forest',
        bg: '#1b2a1b', fg: '#a8d5a2', panel: '#142414',
        border: '#3d6b3d', accent: '#7cb871',
        positive: '#69ff47', negative: '#ff5555', neutral: '#8be9fd',
    },
    copper: {
        name: 'Copper',
        bg: '#1c1410', fg: '#e8c39e', panel: '#140f0a',
        border: '#7a5533', accent: '#d4764e',
        positive: '#a8d5a2', negative: '#ff7070', neutral: '#b3d9f5',
    },
};

// Compute every CSS custom property value from 8 core colours
function deriveTokens(colors) {
    const lum = perceivedLuminance(colors.bg);
    const isDark = lum < 0.55;
    const overlay = isDark ? '#ffffff' : '#000000';

    const [pH, pS, pL] = hexToHSL(colors.panel);
    const panelAlt = hslToHex(pH, pS, isDark ? Math.min(pL + 4, 95) : Math.max(pL - 4, 5));

    return {
        '--primary-bg-color-start': colors.bg,
        '--primary-bg-color-end':   colors.accent,
        '--header-text-color':      isDark ? '#ffffff' : colors.fg,
        '--tab-bg-color':           hexToRgba(overlay, 0.1),
        '--tab-active-bg-color':    hexToRgba(overlay, 0.2),
        '--tab-text-color':         hexToRgba(overlay, 0.7),
        '--tab-active-text-color':  overlay,
        '--content-bg-color':       hexToRgba(colors.panel, 0.95),
        '--card-bg-gradient-start': colors.panel,
        '--card-bg-gradient-end':   panelAlt,
        '--text-color-primary':     colors.fg,
        '--text-color-secondary':   hexToRgba(colors.fg, 0.6),
        '--accent-color':           colors.accent,
        '--color-positive':         colors.positive,
        '--color-negative':         colors.negative,
        '--color-neutral':          colors.neutral,
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
    const name = (typeof guiSettingsData !== 'undefined' && guiSettingsData.theme) || 'default';
    applyTheme(THEMES[name] || THEMES.default);
}

// Render preset swatch buttons into a container element
function renderThemeSwitcher(container) {
    if (!container) return;
    const activeName = (typeof guiSettingsData !== 'undefined' && guiSettingsData.theme) || 'default';
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
