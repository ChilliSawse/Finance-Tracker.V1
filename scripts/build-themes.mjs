// Theme token generator (step A1).
//   npm run build:themes           writes src/styles/tokens.generated.css from src/theme/themes.json
//   node scripts/build-themes.mjs --check   fails when the committed file is out of date
//
// themes.json is the output of the theme sheet (OKLCH-built, AA-checked colours for 4 palettes
// x light and dark, 10 bucket slots each, 3 family shades per slot). This file turns it into CSS:
// the 8 token sets, the derived tokens the sheet does not carry, the role aliases and the
// bucket-slot classes. The pure functions below are also used by the tests, so this module
// touches no files unless it is run directly.

export const PALETTE_ORDER = ['sunrise', 'bucket', 'eucalypt', 'harbour'];
export const SLOTS = 10;
export const DERIVED_TOKENS = ['--active', '--rule', '--control', '--track', '--scrim', '--warn-line', '--float-shadow'];

// Role aliases point at slots (slot 5 is Mojo, slot 6 is Grow). They are var() references, so the
// slot stays the single source of each colour.
const ROLE_SLOTS = [['daily', 1], ['splurge', 2], ['smile', 3], ['fire', 4], ['mojo', 5], ['grow', 6]];

const BASE_KEYS = ['ground', 'surface', 'raised', 'border', 'text', 'muted', 'accent', 'accent-ink', 'mark', 'positive', 'negative',
    'warn-bg', 'warn-ink', 'ok-bg', 'ok-ink', 'neutral-bg', 'neutral-ink'];

// ---------- colour maths (sRGB, WCAG 2 contrast) ----------
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((c, i) => c + (y[i] - c) * t)); };
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const [r, g, b] = toRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
const rgba = (hex, alpha) => `rgba(${toRgb(hex).join(', ')}, ${alpha})`;

// Tokens the theme sheet does not carry. The mock added them by hand for Sunrise only; these
// rules reproduce its values closely and work for every palette.
function derive(base, dark) {
    return {
        '--active': base.border,
        '--rule': mix(base.surface, base.border, 0.5),
        '--control': mix(base.border, base.muted, 0.15),
        '--track': dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.75)',
        '--scrim': dark ? 'rgba(0, 0, 0, 0.6)' : rgba(base.text, 0.32),
        '--warn-line': mix(base['warn-bg'], base['warn-ink'], 0.12),
        '--float-shadow': dark ? '0 8px 28px rgba(0, 0, 0, 0.5)' : `0 8px 24px ${rgba(base.text, 0.14)}`,
    };
}

// One token set per palette and mode: { palette, mode, vars } with vars in a stable order.
export function buildTokenSets(themes) {
    const sets = [];
    for (const palette of PALETTE_ORDER) {
        for (const mode of ['light', 'dark']) {
            const dark = mode === 'dark';
            const { base, buckets } = themes[palette][mode];
            const vars = { 'color-scheme': mode };
            for (const k of BASE_KEYS) vars[`--${k}`] = base[k];
            Object.assign(vars, derive(base, dark));
            for (const [role, slot] of ROLE_SLOTS) {
                vars[`--${role}-bg`] = `var(--b${slot}-bg)`;
                vars[`--${role}-ink`] = `var(--b${slot}-ink)`;
                vars[`--${role}-mid`] = `var(--b${slot}-chart)`;
            }
            for (const b of buckets) {
                const n = b.slot;
                vars[`--b${n}-bg`] = b.bg;
                vars[`--b${n}-ink`] = b.ink;
                vars[`--b${n}-chart`] = b.chart;
                b.shades.forEach((s, i) => { vars[`--b${n}-shade${i + 1}`] = s.bg; });
            }
            sets.push({ palette, mode, vars });
        }
    }
    return sets;
}

// Every foreground and background pair, with the ratio it must reach (4.5 text, 3 chart marks
// and the "spent" mark). The same 62 pairs per set as the sheet's contrast report.
export function contrastRows(themes) {
    const rows = [];
    for (const palette of PALETTE_ORDER) {
        for (const mode of ['light', 'dark']) {
            const set = `${palette} ${mode}`;
            const { base, buckets } = themes[palette][mode];
            const add = (label, fg, bg, need) => rows.push({ set, label, ratio: Math.round(contrast(fg, bg) * 100) / 100, need });
            const pairs = [['text', 'ground', 4.5], ['text', 'surface', 4.5], ['muted', 'surface', 4.5], ['muted', 'ground', 4.5],
                ['accent', 'surface', 4.5], ['accent-ink', 'accent', 4.5], ['negative', 'surface', 4.5], ['positive', 'surface', 4.5],
                ['warn-ink', 'warn-bg', 4.5], ['ok-ink', 'ok-bg', 4.5], ['neutral-ink', 'neutral-bg', 4.5], ['mark', 'surface', 3]];
            for (const [fg, bg, need] of pairs) add(`${fg} on ${bg}`, base[fg], base[bg], need);
            for (const b of buckets) {
                add(`slot ${b.slot} ink on tile`, b.ink, b.bg, 4.5);
                add(`slot ${b.slot} chart on surface`, b.chart, base.surface, 3);
                b.shades.forEach((s, i) => add(`slot ${b.slot} ink on shade ${i + 1}`, b.ink, s.bg, 4.5));
            }
        }
    }
    return rows;
}

const block = (selector, vars, indent = '') =>
    `${indent}${selector} {\n${Object.entries(vars).map(([k, v]) => `${indent}    ${k}: ${v};`).join('\n')}\n${indent}}\n`;

// The whole token file as a string.
export function buildCss(themes) {
    const sets = buildTokenSets(themes);
    const out = ['/* GENERATED by scripts/build-themes.mjs from src/theme/themes.json. Do not edit by hand. */\n',
        '/* Selectors: light is html[data-palette], forced dark is [data-mode="dark"], and auto follows the system',
        '   through the media rule, which a forced light mode (data-mode="light") switches off. Sunrise is also the',
        '   default on the bare root, so the page has colours before a palette is set. */\n'];
    for (const palette of PALETTE_ORDER) {
        const light = sets.find((s) => s.palette === palette && s.mode === 'light').vars;
        const dark = sets.find((s) => s.palette === palette && s.mode === 'dark').vars;
        const isDefault = palette === PALETTE_ORDER[0];
        out.push(`/* ===== ${palette}: light ===== */`);
        out.push(block(isDefault ? `:root, html[data-palette="${palette}"]` : `html[data-palette="${palette}"]`, light));
        out.push(`/* ===== ${palette}: dark ===== */`);
        const forced = isDefault
            ? `html[data-palette="${palette}"][data-mode="dark"], html[data-mode="dark"]:not([data-palette])`
            : `html[data-palette="${palette}"][data-mode="dark"]`;
        out.push(block(forced, dark));
        const auto = isDefault
            ? `html[data-palette="${palette}"]:not([data-mode="light"]), html:not([data-palette]):not([data-mode="light"])`
            : `html[data-palette="${palette}"]:not([data-mode="light"])`;
        out.push('@media (prefers-color-scheme: dark) {\n' + block(auto, dark, '    ') + '}\n');
    }
    out.push('/* classes */');
    out.push('/* Bucket tiles, their three family shades, and progress bars, for all ten slots. Slot 5 is Mojo. */');
    for (let n = 1; n <= SLOTS; n++) {
        out.push(`.k${n} { background: var(--b${n}-bg); color: var(--b${n}-ink); }`);
        for (let s = 1; s <= 3; s++) out.push(`.k${n}-s${s} { background: var(--b${n}-shade${s}); color: var(--b${n}-ink); }`);
    }
    out.push('');
    for (let n = 1; n <= SLOTS; n++) {
        out.push(`.p-bar.k${n} { background: var(--raised); color: var(--b${n}-chart); }`);
        out.push(`.p-bar.k${n} i { background: currentColor; }`);
    }
    out.push('');
    out.push('/* Palette swatches for the appearance screen: a chip shows one palette in one mode, whatever the page uses. */');
    for (const s of sets) {
        const v = s.vars;
        out.push(`.pal-sw[data-sw="${s.palette}-${s.mode}"] { --sw-ground: ${v['--ground']}; --sw-surface: ${v['--surface']}; --sw-accent: ${v['--accent']}; --sw-b1: ${v['--b1-chart']}; --sw-b2: ${v['--b2-chart']}; --sw-b3: ${v['--b3-chart']}; }`);
    }
    return out.join('\n') + '\n';
}

// ---------- command line (only when run directly under Node) ----------
const isNode = typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv[1];
if (isNode && process.argv[1].replace(/\\/g, '/').endsWith('/scripts/build-themes.mjs')) {
    const nodeFs = 'node:fs';
    const fs = await import(/* @vite-ignore */ nodeFs);
    const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    const themes = JSON.parse(read('src/theme/themes.json'));
    const css = buildCss(themes);
    const rows = contrastRows(themes);
    const fails = rows.filter((r) => r.ratio < r.need);
    console.log(`${buildTokenSets(themes).length} token sets, ${rows.length} contrast pairs, ${fails.length} failures`);
    for (const f of fails) console.error(`FAIL ${f.set}: ${f.label} ${f.ratio}:1 (needs ${f.need})`);
    if (fails.length) process.exit(1);
    const target = new URL('../src/styles/tokens.generated.css', import.meta.url);
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
        if (current !== css) { console.error('tokens.generated.css is out of date: run npm run build:themes'); process.exit(1); }
        console.log('tokens.generated.css is current');
    } else {
        fs.mkdirSync(new URL('../src/styles/', import.meta.url), { recursive: true });
        fs.writeFileSync(target, css);
        console.log('wrote src/styles/tokens.generated.css');
    }
}
