// Test cases for the "theme" group (registered in src/test-registry.js). Step A4 (theme runtime).
// Shape: { name, fn(assert) }, assert(label, actual, expected). Everything here is synthetic:
// no real storage, no real backup.

import { migrateGuiAppearance, readAppearance, parseFouc, foucValue, purgeStaleFouc, FOUC_KEY } from './theme.js';
import { cloneDefaultGuiSettings } from '../state/defaults.js';

// A synthetic guiSettings in the shape the retired engine saved (dark preset, pinned colours, a font, an effect).
const oldSave = () => ({
    theme: 'midnight', primaryBgStart: 'dark-ground', cardBgStart: 'card', textColor: 'text',
    accentColor: 'accent', headingColor: 'white', fontFamily: 'Georgia, serif', baseFontSize: '18',
    bgEffect: 'rain', bgEffectColor: '', mainHeading: 'Ledger', subHeading: 'x',
});

const fakeStorage = (initial) => {
    const m = new Map(Object.entries(initial));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => { m.delete(k); }, has: (k) => m.has(k), get: (k) => m.get(k) };
};

// index.html text: from disk under Node, over fetch in the browser (null if neither works).
async function indexHtml() {
    try {
        if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            const nodeFs = 'node:fs';
            const fs = await import(/* @vite-ignore */ nodeFs);
            return fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
        }
        const r = await fetch(new URL('../../index.html', import.meta.url));
        return r.ok ? await r.text() : null;
    } catch (_) { return null; }
}

export const THEME_TEST_CASES = [
    {
        name: 'A4.1 every start lands on a valid palette and mode',
        fn(assert) {
            const fresh = cloneDefaultGuiSettings();
            assert('a fresh profile is sunrise and auto', [fresh.theme, fresh.colorMode], ['sunrise', 'auto']);
            assert('fresh settings carry no colour fields', Object.keys(fresh).sort(), ['baseFontSize', 'colorMode', 'theme']);

            const old = migrateGuiAppearance(oldSave());
            assert('an old dark save lands on sunrise dark', [old.theme, old.colorMode], ['sunrise', 'dark']);
            assert('the old colour, font and effect fields stay in the save', [old.primaryBgStart, old.fontFamily, old.bgEffect, old.baseFontSize], ['dark-ground', 'Georgia, serif', 'rain', '18']);

            // A JSON import of an old backup goes through the same function.
            const bundle = JSON.parse(JSON.stringify({ financeData: {}, guiSettings: { ...oldSave(), theme: 'paper' } }));
            const imported = migrateGuiAppearance(bundle.guiSettings);
            assert('an imported old light backup lands on sunrise auto', [imported.theme, imported.colorMode], ['sunrise', 'auto']);

            assert('custom and unknown names land on sunrise auto', [{ theme: 'custom' }, { theme: 'My Teal' }, {}].map((g) => readAppearance(g)), Array(3).fill({ palette: 'sunrise', mode: 'auto' }));
            const again = migrateGuiAppearance({ theme: 'harbour', colorMode: 'light' });
            assert('a new-shape save is kept', [again.theme, again.colorMode], ['harbour', 'light']);
            assert('migrating twice changes nothing', JSON.stringify(migrateGuiAppearance(migrateGuiAppearance(oldSave()))), JSON.stringify(migrateGuiAppearance(oldSave())));
            assert('a bad colour mode falls back to auto', readAppearance({ theme: 'bucket', colorMode: 'blue' }), { palette: 'bucket', mode: 'auto' });
        },
    },
    {
        name: 'A4.2 the cache holds {p, m}; an old-shape value is ignored and removed (U12)',
        fn(assert) {
            assert('the new shape', JSON.parse(foucValue({ palette: 'eucalypt', mode: 'dark' })), { p: 'eucalypt', m: 'dark' });
            assert('the new shape parses', parseFouc('{"p":"harbour","m":"auto"}'), { palette: 'harbour', mode: 'auto' });
            const oldShape = '{"--primary-bg-color-start":"dark-ground","--accent-color":"accent"}';
            assert('an old-shape value is not a cache', [parseFouc(oldShape), parseFouc('nope'), parseFouc('{"p":"x","m":"auto"}'), parseFouc(null)], [null, null, null, null]);
            const s = fakeStorage({ [FOUC_KEY]: oldShape });
            assert('purge removes the old shape', [purgeStaleFouc(s), s.has(FOUC_KEY)], [true, false]);
            const good = fakeStorage({ [FOUC_KEY]: '{"p":"bucket","m":"light"}' });
            assert('purge keeps the new shape', [purgeStaleFouc(good), good.has(FOUC_KEY)], [false, true]);
            assert('purge with no value does nothing', purgeStaleFouc(fakeStorage({})), false);
            assert('the key keeps its name', FOUC_KEY, 'ft-theme-fouc');
        },
    },
    {
        name: 'A4.3 the inline script is small, is allowed by hash (S2) and sets only the two attributes',
        async fn(assert) {
            const html = await indexHtml();
            if (html === null) { assert('index.html could not be read here, so the script is not checked', true, true); return; }
            const m = html.replace(/\r\n/g, '\n').match(/<script>([\s\S]*?)<\/script>/);
            assert('the inline script is a plain classic script (no nonce)', Boolean(m), true);
            const body = m[1].trim();
            assert('at most 300 bytes', new TextEncoder().encode(body).length <= 300, true);
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[1]));
            const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
            const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)[1];
            const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
            assert('script-src carries the committed sha256 of the exact script', scriptSrc.includes("'sha256-" + b64 + "'"), true);
            assert('script-src has no nonce and no unsafe-inline', /nonce-|unsafe-inline|unsafe-eval/.test(scriptSrc), false);
            for (const d of ['object-src', 'base-uri', 'form-action', 'frame-src']) {
                assert(d + " is 'none'", new RegExp(d + " 'none'").test(csp), true);
            }
            assert('the old nonce is gone everywhere', html.includes('ft-fouc-init'), false);
            const run = (stored) => {
                const doc = { documentElement: { dataset: {} } };
                new Function('localStorage', 'document', body)({ getItem: () => stored }, doc);
                return doc.documentElement.dataset;
            };
            assert('new shape sets both', run('{"p":"harbour","m":"dark"}'), { palette: 'harbour', mode: 'dark' });
            assert('auto sets only the palette', run('{"p":"bucket","m":"auto"}'), { palette: 'bucket' });
            assert('old shape sets nothing', run('{"--primary-bg-color-start":"dark-ground"}'), {});
            assert('no value or junk sets nothing and does not throw', [run(null), run('{{')], [{}, {}]);
        },
    },
];
