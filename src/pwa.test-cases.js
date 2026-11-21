// Test cases for the "pwa" group (A10: PWA, meta, brand). Pure: a tiny fake DOM stands in, so the
// banner and the theme-color hook run under Node and in tests.html alike. Synthetic only.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { applyAppearance, loadTheme } from './theme/theme.js';
import { showUpdateNotification, showDbNotice } from './pwa.js';
import { t } from './i18n/strings.js';

// Source text of a repo file: from disk under Node, over fetch in the browser (null if neither works).
async function repoText(rel) {
    try {
        if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            const nodeFs = 'node:fs';
            const fs = await import(/* @vite-ignore */ nodeFs);
            return fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
        }
        const r = await fetch(new URL('../' + rel, import.meta.url));
        return r.ok ? await r.text() : null;
    } catch (_) { return null; }
}

// A fake element: enough of the DOM for pwa.js (create, append, classList, attributes, events).
function fakeEl(tag) {
    const el = {
        tag, id: '', className: '', type: '', _text: '', content: '', children: [], attrs: {}, style: {}, listeners: {}, removed: false,
        get textContent() { return this._text; },
        set textContent(v) { this._text = String(v); this.children = []; },
        setAttribute(k, v) { if (k === 'content') this.content = String(v); else this.attrs[k] = String(v); },
        getAttribute(k) { return k === 'content' ? this.content : (k in this.attrs ? this.attrs[k] : null); },
        appendChild(c) { this.children.push(c); return c; },
        append(...cs) { cs.forEach((c) => this.children.push(c)); },
        addEventListener(t, f) { this.listeners[t] = f; },
        remove() { this.removed = true; },
        get isConnected() { return !this.removed; },
        click() { if (this.listeners.click) this.listeners.click(); },
        get tagName() { return this.tag.toUpperCase(); },
        classList: {
            add(c) { const s = new Set(el.className.split(/\s+/).filter(Boolean)); s.add(c); el.className = [...s].join(' '); },
            contains(c) { return el.className.split(/\s+/).includes(c); },
        },
    };
    return el;
}
const walk = (el, out = []) => { out.push(el); Array.from(el.children || []).forEach((c) => walk(c, out)); return out; };

// Install fakes on globalThis for one callback, then put everything back.
function withFakeDom(setup, fn) {
    if (typeof window !== 'undefined' && window.document) { withRealDom(fn); return; }
    const keys = ['document', 'getComputedStyle', 'localStorage', 'matchMedia'];
    const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
    const root = { dataset: {}, removeAttribute(k) { if (k === 'data-mode') delete this.dataset.mode; }, style: { setProperty() {} } };
    const meta = fakeEl('meta');
    const body = fakeEl('body');
    const byId = {};
    const doc = {
        documentElement: root, body,
        querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null),
        getElementById: (id) => (byId[id] && !byId[id].removed ? byId[id] : null),
        createElement: (t) => fakeEl(t),
    };
    body.appendChild = (c) => { body.children.push(c); if (c.id) byId[c.id] = c; return c; };
    const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    try {
        def('document', doc);
        setup(def, root);
        fn({ root, meta, body, doc });
    } finally {
        saved.forEach(([k, d]) => { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; });
    }
}

// In a browser the real document is used (its globals cannot be replaced): a temporary theme-color meta and a
// style rule give each palette and mode a distinct --ground, and everything is put back afterwards.
function withRealDom(fn) {
    const root = document.documentElement;
    const saved = [root.dataset.palette, root.dataset.mode];
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    const style = document.createElement('style');
    style.textContent = Object.entries(GROUND).map(([k, v]) => {
        const [p, m] = k.split('-');
        return ':root[data-palette="' + p + '"][data-mode="' + m + '"]{--ground:' + v + '}';
    }).join('');
    const hadMeta = document.querySelector('meta[name="theme-color"]');
    document.head.append(style);
    if (!hadMeta) document.head.append(meta);
    try { fn({ root, meta: hadMeta || meta, real: true }); } finally {
        style.remove(); if (!hadMeta) meta.remove();
        const old = document.getElementById('update-notification'); if (old) old.remove();
        if (saved[0]) root.dataset.palette = saved[0]; else delete root.dataset.palette;
        if (saved[1]) root.dataset.mode = saved[1]; else delete root.dataset.mode;
    }
}

// A stand-in for the generated tokens: a distinct ground per palette and mode.
const GROUND = { 'sunrise-light': '#aa0001', 'sunrise-dark': '#aa0002', 'harbour-light': '#aa0003', 'harbour-dark': '#aa0004' };
let systemDark = false;
const setupFakes = (def, root) => {
    def('getComputedStyle', () => ({
        getPropertyValue: (p) => {
            if (p !== '--ground') return '';
            const mode = root.dataset.mode || (systemDark ? 'dark' : 'light');
            return ' ' + GROUND[`${root.dataset.palette}-${mode}`] + ' ';
        },
    }));
    def('localStorage', { setItem() {}, getItem: () => null, removeItem() {} });
};

export const PWA_TEST_CASES = [
    {
        name: 'A10.1 theme-color follows the palette, the mode and the system in Auto',
        fn(assert) {
            let listener = null;
            withFakeDom((def, root) => {
                setupFakes(def, root);
                def('matchMedia', () => ({ addEventListener: (_t, f) => { listener = f; } }));
            }, ({ meta, root, real }) => {
                systemDark = false;
                applyAppearance({ palette: 'sunrise', mode: 'light' });
                assert('sunrise light', meta.getAttribute('content'), GROUND['sunrise-light']);
                applyAppearance({ palette: 'sunrise', mode: 'dark' });
                assert('sunrise dark', meta.getAttribute('content'), GROUND['sunrise-dark']);
                applyAppearance({ palette: 'harbour', mode: 'light' });
                assert('a palette switch updates it', meta.getAttribute('content'), GROUND['harbour-light']);
                if (real) { assert('the generated rules paint a distinct ground in the browser', meta.getAttribute('content') !== GROUND['sunrise-light'], true); return; }
                applyAppearance({ palette: 'harbour', mode: 'auto' });
                assert('Auto follows the system (light)', meta.getAttribute('content'), GROUND['harbour-light']);
                // loadTheme registers the system watcher; the browser bar follows a system change in Auto.
                loadTheme();
                systemDark = true;
                if (listener) listener();
                assert('a system change in Auto moves it to the dark ground', [listener !== null, meta.getAttribute('content')], [true, GROUND['sunrise-dark']]);
                assert('the page root carries no inline colour', Object.keys(root.style).filter((k) => k !== 'setProperty'), []);
                systemDark = false;
            });
        },
    },
    {
        name: 'A10.2 the update banner is built from theme-token classes, with no inline colour',
        fn(assert) {
            withFakeDom(setupFakes, () => {
                let updated = 0;
                showUpdateNotification(() => { updated += 1; });
                const banner = document.getElementById('update-notification');
                assert('one banner, with its id kept', [banner.id, banner.className], ['update-notification', 'update-banner']);
                assert('announced as an alert', [banner.getAttribute('role'), banner.getAttribute('aria-live')], ['alert', 'assertive']);
                const all = walk(banner);
                const tagOf = (e) => (e.tagName || '').toLowerCase();
                assert('no element carries an inline style', all.filter((e) => e.getAttribute('style')).length, 0);
                const btns = all.filter((e) => tagOf(e) === 'button');
                assert('two buttons, Update Now (primary) and Later', btns.map((b) => [b.textContent, b.className]), [['Update Now', 'update-banner-btn primary'], ['Later', 'update-banner-btn']]);
                btns[0].click();
                assert('Update Now calls the updater once and shows the wait state', [updated, banner.classList.contains('is-updating'), banner.textContent], [1, true, 'Updating… please wait a moment.']);
                showUpdateNotification(() => {});
                assert('a second call replaces the first', banner.isConnected, false);
            });
        },
    },
    {
        name: 'S11.6 the database notices reuse the update banner: reload offers Reload, blocked offers only Later',
        fn(assert) {
            withFakeDom(setupFakes, () => {
                const tagOf = (e) => (e.tagName || '').toLowerCase();
                const btnsOf = (b) => walk(b).filter((e) => tagOf(e) === 'button');
                showDbNotice('reload');
                let banner = document.getElementById('update-notification');
                assert('reload: the banner says the app was updated in another tab', banner.textContent === '' && walk(banner).some((e) => e.textContent === t('d.db.reloadBody')), true);
                assert('reload: Reload (primary) and Later', btnsOf(banner).map((b) => [b.textContent, b.className]), [[t('d.db.reloadAction'), 'update-banner-btn primary'], ['Later', 'update-banner-btn']]);
                showDbNotice('blocked');
                banner = document.getElementById('update-notification');
                assert('blocked: tells the user to close other tabs', walk(banner).some((e) => e.textContent === t('d.db.blockedBody')), true);
                assert('blocked: nothing to press but Later', btnsOf(banner).map((b) => b.textContent), ['Later']);
                showDbNotice('nonsense');
                assert('an unknown kind leaves the banner alone', document.getElementById('update-notification') === banner, true);
            });
        },
    },
    {
        name: 'A10.3 no old orange in the banner, the logo or the manifest; the manifest ground is the Sunrise light ground',
        async fn(assert) {
            const [pwa, css, html, manifestRaw, themes] = await Promise.all(
                ['src/pwa.js', 'src/styles/base.css', 'index.html', 'public/manifest.json', 'src/theme/themes.json'].map(repoText));
            if (pwa === null || css === null || html === null || manifestRaw === null) { assert('repo files cannot be read here, so the source is not checked', true, true); return; }
            const old = /#ff6b35|#f7931e|#ff4500|#f7f1e6|#2196f3|#1976d2/i;
            assert('pwa.js holds no hex colour and no old orange', [/#[0-9a-fA-F]{3,8}\b/.test(pwa), old.test(pwa)], [false, false]);
            const bannerCss = css.slice(css.indexOf('/* Update banner'));
            assert('the banner CSS holds no hex colour', /#[0-9a-fA-F]{3,8}\b/.test(bannerCss), false);
            const mark = html.match(/<symbol id="mark"[\s\S]*?<\/symbol>/)[0];
            assert('the logo mark draws only from the slot variables (accent as fallback)', [/#[0-9a-fA-F]{3,8}\b/.test(mark), (mark.match(/var\(--b\d, var\(--accent\)\)/g) || []).length], [false, 4]);
            const manifest = JSON.parse(manifestRaw);
            assert('the manifest colours are one static value, not the old cream', [manifest.background_color === manifest.theme_color, old.test(manifestRaw)], [true, false]);
            if (themes !== null) {
                const ground = JSON.parse(themes).sunrise.light.base.ground;
                assert('and it is the Sunrise light ground', manifest.background_color, ground);
            }
            assert('the app name text is unchanged', [manifest.name.startsWith('Ledger'), manifest.short_name], [true, 'Ledger']);
        },
    },
    {
        name: 'A10.4 the update prompt stays deliberate: registerType prompt and a dynamic virtual:pwa-register import',
        async fn(assert) {
            const [pwa, vite] = await Promise.all(['src/pwa.js', 'vite.config.js'].map(repoText));
            if (pwa === null || vite === null) { assert('repo files cannot be read here, so the source is not checked', true, true); return; }
            assert("registerType is 'prompt'", /registerType:\s*'prompt'/.test(vite), true);
            assert('the import is dynamic, never static', [/import\('virtual:pwa-register'\)/.test(pwa), /^import .*virtual:pwa-register/m.test(pwa)], [true, false]);
        },
    },
];
