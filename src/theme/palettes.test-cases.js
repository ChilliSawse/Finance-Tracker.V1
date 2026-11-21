// Test cases for the "palettes" group (registered in src/test-registry.js).
// Step A1 (theme generator, tokens, palettes). Shape: { name, fn(assert) }, assert(label, actual, expected).

import themes from './themes.json' with { type: 'json' };
import { migrateAppearance, resolvePalette, PALETTE_IDS, DEFAULT_PALETTE, OLD_THEME_NAMES } from './palettes.js';
import { buildTokenSets, buildCss, contrastRows, DERIVED_TOKENS } from '../../scripts/build-themes.mjs';

const css = buildCss(themes);

export const PALETTES_TEST_CASES = [
    {
        name: 'A1.1 migrateAppearance maps old themes',
        fn(assert) {
            assert('midnight is sunrise dark', migrateAppearance({ theme: 'midnight' }), { palette: 'sunrise', mode: 'dark' });
            for (const n of ['sunrise', 'light', 'paper']) {
                assert(`${n} is sunrise auto`, migrateAppearance({ theme: n }), { palette: 'sunrise', mode: 'auto' });
            }
            assert('custom is sunrise auto', migrateAppearance({ theme: 'custom' }), { palette: 'sunrise', mode: 'auto' });
            assert('a saved custom name is sunrise auto', migrateAppearance({ theme: 'My Teal' }), { palette: 'sunrise', mode: 'auto' });
            assert('unknown is sunrise auto', migrateAppearance({ theme: 'nope' }), { palette: 'sunrise', mode: 'auto' });
            assert('missing theme is sunrise auto', migrateAppearance({}), { palette: 'sunrise', mode: 'auto' });
            assert('null settings is sunrise auto', migrateAppearance(null), { palette: 'sunrise', mode: 'auto' });
            assert('all 13 old names are listed', OLD_THEME_NAMES.length, 13);
            const bad = OLD_THEME_NAMES.filter((n) => {
                const r = migrateAppearance({ theme: n });
                return r.palette !== 'sunrise' || (r.mode !== 'auto' && r.mode !== 'dark');
            });
            assert('every old name maps to sunrise with auto or dark', bad, []);
            assert('dark presets go dark', ['retrowave', 'terminal', 'forest', 'ocean', 'ume', 'copper', 'organs'].map((n) => migrateAppearance({ theme: n }).mode), Array(7).fill('dark'));
            assert('light presets stay auto', ['lavender', 'cute'].map((n) => migrateAppearance({ theme: n }).mode), ['auto', 'auto']);
            assert('removed aliases follow midnight', [migrateAppearance({ theme: 'default' }).mode, migrateAppearance({ theme: 'dark' }).mode], ['dark', 'dark']);
            assert('an already migrated palette and mode is kept', migrateAppearance({ palette: 'harbour', mode: 'light', theme: 'midnight' }), { palette: 'harbour', mode: 'light' });
            assert('an invalid mode falls back to auto', migrateAppearance({ palette: 'harbour', mode: 'blue' }), { palette: 'harbour', mode: 'auto' });
            assert('resolvePalette keeps the palette ids', resolvePalette('eucalypt'), 'eucalypt');
            assert('resolvePalette defaults', resolvePalette('zzz'), DEFAULT_PALETTE);
            assert('four palettes', PALETTE_IDS, ['sunrise', 'bucket', 'eucalypt', 'harbour']);
            const input = { theme: 'midnight' };
            migrateAppearance(input);
            assert('migrateAppearance does not mutate its input', input, { theme: 'midnight' });
        },
    },
    {
        name: 'A1.2 generator emits 8 token sets and the dark media rules',
        fn(assert) {
            const sets = buildTokenSets(themes);
            assert('eight token sets', sets.length, 8);
            assert('four light and four dark', [sets.filter((s) => s.mode === 'light').length, sets.filter((s) => s.mode === 'dark').length], [4, 4]);
            for (const id of PALETTE_IDS) {
                assert(`${id} light selector`, css.includes(`html[data-palette="${id}"] {`), true);
                assert(`${id} forced dark selector`, css.includes(`html[data-palette="${id}"][data-mode="dark"]`), true);
                assert(`${id} media dark selector`, css.includes(`html[data-palette="${id}"]:not([data-mode="light"])`), true);
            }
            assert('four dark media blocks', (css.match(/@media \(prefers-color-scheme: dark\)/g) || []).length, 4);
            assert('sunrise is also the default on the bare root', css.includes(':root, html[data-palette="sunrise"] {'), true);
            assert('every set carries all 10 slots', sets.every((s) => Object.keys(s.vars).filter((k) => /^--b\d+-bg$/.test(k)).length === 10), true);
            assert('no forced-mode legacy values', css.includes('data-theme'), false);
        },
    },
    {
        name: 'A1.3 contrast: every foreground and background pair is AA',
        fn(assert) {
            const rows = contrastRows(themes);
            assert('496 pairs (62 per set, 8 sets)', rows.length, 496);
            const fails = rows.filter((r) => r.ratio < r.need).map((r) => `${r.set} ${r.label} ${r.ratio}:1`);
            assert('no pair below its requirement', fails, []);
            assert('slots 5 to 10 and their shades are covered', rows.filter((r) => r.set === 'sunrise light' && /^slot (5|6|7|8|9|10) /.test(r.label)).length, 30);
            assert('text pairs need 4.5', rows.filter((r) => r.label.includes('ink')).every((r) => r.need === 4.5), true);
        },
    },
    {
        name: 'A1.4 classes for all ten slots',
        fn(assert) {
            let tiles = 0, shades = 0, bars = 0;
            for (let n = 1; n <= 10; n++) {
                if (new RegExp(`^\.k${n} \{`, 'm').test(css)) tiles++;
                for (let s = 1; s <= 3; s++) if (new RegExp(`^\.k${n}-s${s} \{`, 'm').test(css)) shades++;
                if (new RegExp(`^\.p-bar\.k${n} \{`, 'm').test(css)) bars++;
            }
            assert('.k1 to .k10', tiles, 10);
            assert('.kN-s1 to .s3', shades, 30);
            assert('.p-bar.kN', bars, 10);
            assert('Mojo (slot 5) tile uses slot 5 tokens', css.includes('.k5 { background: var(--b5-bg); color: var(--b5-ink); }'), true);
        },
    },
    {
        name: 'A1.5 hygiene: derived tokens exist, hex lives only in the generated file',
        fn(assert) {
            assert('the seven derived token names', DERIVED_TOKENS, ['--active', '--rule', '--control', '--track', '--scrim', '--warn-line', '--float-shadow']);
            const sets = buildTokenSets(themes);
            assert('every set has every derived token', sets.every((s) => DERIVED_TOKENS.every((k) => s.vars[k])), true);
            assert('every set has the -mid role aliases', sets.every((s) => ['--daily-mid', '--splurge-mid', '--smile-mid', '--fire-mid'].every((k) => s.vars[k])), true);
            const classPart = css.slice(css.indexOf('/* classes */'));
            assert('the class section has no hex colour', /#[0-9a-fA-F]{3,8}/.test(classPart), false);
            assert('the class section exists', css.includes('/* classes */'), true);
            assert('generated header marks the file', css.startsWith('/* GENERATED'), true);
        },
    },
];
