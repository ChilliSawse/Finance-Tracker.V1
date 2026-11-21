// Pure palette registry for the Phase 1 look (step A1). No DOM, no storage, no colours:
// the colours live in the generated token file (src/styles/tokens.generated.css).
// A4 applies these ids through applyAppearance({palette, mode}).

export const PALETTE_IDS = ['sunrise', 'bucket', 'eucalypt', 'harbour'];
export const DEFAULT_PALETTE = 'sunrise';
export const MODES = ['auto', 'light', 'dark'];

// Display names: each palette has a light label and a dark partner label.
export const PALETTE_LABELS = {
    sunrise: { label: 'Sunrise', darkLabel: 'Sunrise night' },
    bucket: { label: 'Bucket tints', darkLabel: 'Forest night' },
    eucalypt: { label: 'Eucalypt & wattle', darkLabel: 'Bush night' },
    harbour: { label: 'Harbour', darkLabel: 'Harbour night' },
};

// The 13 presets the old theme engine shipped, in their original order, and whether
// each was a dark preset (its background luminance in the old THEMES object).
const OLD_THEME_MODES = {
    sunrise: 'auto',
    light: 'auto',
    midnight: 'dark',
    paper: 'auto',
    retrowave: 'dark',
    forest: 'dark',
    ocean: 'dark',
    ume: 'dark',
    copper: 'dark',
    terminal: 'dark',
    organs: 'dark',
    lavender: 'auto',
    cute: 'auto',
};
export const OLD_THEME_NAMES = Object.keys(OLD_THEME_MODES);

// Removed presets that the old resolver pointed at midnight.
const OLD_ALIASES = { default: 'midnight', dark: 'midnight' };

// A saved palette id, or the default.
export function resolvePalette(value) {
    return PALETTE_IDS.includes(value) ? value : DEFAULT_PALETTE;
}

// Old guiSettings theme name -> { palette, mode }. Every old preset becomes Sunrise,
// dark ones keep a dark mode; 'custom', saved custom names, unknown and missing
// values become Sunrise on auto. Settings that already carry a palette keep it.
// Pure: reads the settings object, never changes it or any key name.
export function migrateAppearance(guiSettings) {
    const g = guiSettings && typeof guiSettings === 'object' ? guiSettings : {};
    if (PALETTE_IDS.includes(g.palette)) {
        return { palette: g.palette, mode: MODES.includes(g.mode) ? g.mode : 'auto' };
    }
    const name = OLD_ALIASES[g.theme] || g.theme;
    const mode = Object.prototype.hasOwnProperty.call(OLD_THEME_MODES, name) ? OLD_THEME_MODES[name] : 'auto';
    return { palette: DEFAULT_PALETTE, mode };
}
