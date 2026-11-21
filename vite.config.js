import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const APP_VERSION = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

// S2: the inline FOUC script is allowed by hash, not by a public nonce. This plugin
// hashes the script as it appears in the final HTML (dev and build; the browser
// normalises CRLF to LF before hashing, so we do too) and writes the hash into the
// CSP meta, replacing whatever sha256 is committed there.
function ftCspHash() {
    return {
        name: 'ft-csp-hash',
        transformIndexHtml: {
            order: 'post',
            handler(html) {
                if (!html.includes('Content-Security-Policy')) return html; // tests.html has no CSP meta
                const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/g)];
                // tests.html (S4): CSP without a classic inline script and without a sha256 source: nothing to hash.
                if (scripts.length === 0 && !/script-src [^;]*'sha256-/.test(html)) return html;
                if (scripts.length !== 1) throw new Error('ft-csp-hash: expected exactly one classic inline script, found ' + scripts.length);
                const hash = createHash('sha256').update(scripts[0][1].replace(/\r\n/g, '\n'), 'utf8').digest('base64');
                if (!/script-src [^;]*'sha256-[^']+'/.test(html)) throw new Error('ft-csp-hash: no sha256 source in script-src');
                return html.replace(/(script-src [^;]*)'sha256-[^']+'/, "$1'sha256-" + hash + "'");
            },
        },
    };
}

// P3e: the modules every first load needs (the state and calculation core, the English catalogue, Today and the tab
// shell, the shared sheet and toast) ship as ONE chunk instead of about fifteen small ones, and the service-worker
// registration code as another. Only modules that main.js already reaches at startup are listed, so merging them pulls
// nothing lazy into the first download (tools/z1-coldload.mjs fails if it ever does). A module missing from this list just
// lands in a smaller chunk of its own; nothing breaks.
const STARTUP_MODULES = new Set([
    'calc/assets-debts.js',
    'calc/bill-match.js',
    'calc/calculations.js',
    'calc/fire.js',
    'calc/income-events.js',
    'calc/pay-cycle.js',
    'calc/pay-roll.js',
    'calc/plan.js',
    'calc/review.js',
    'calc/saving-model.js',
    'calc/smile.js',
    'calc/tax-au.js',
    'calc/tax-owed.js',
    'calc/tax-tables/au-2025-26.js',
    'calc/tax-tables/au-2026-27.js',
    'calc/tax-tables/index.js',
    'calc/withholding.js',
    'i18n/en-a.js',
    'i18n/en-b.js',
    'i18n/en-c.js',
    'i18n/en-d.js',
    'i18n/en-e.js',
    'i18n/en-f.js',
    'i18n/en.js',
    'i18n/strings.js',
    'state/asset-debt-migration.js',
    'state/backup.js',
    'state/bills.js',
    'state/bucket-migration.js',
    'state/categories.js',
    'state/db.js',
    'state/defaults.js',
    'state/eventlog.js',
    'state/income-migration.js',
    'state/migration-chain.js',
    'state/migrations.js',
    'state/milestones.js',
    'state/plan-migration.js',
    'state/safety-db.js',
    'state/sample-flag.js',
    'state/sanitize.js',
    'state/saving-model.js',
    'state/snapshots.js',
    'state/spend-cache.js',
    'state/store.js',
    'state/today-model.js',
    'state/transactions.js',
    'theme/palettes.js',
    'theme/theme.js',
    'ui/feed.js',
    'ui/focus.js',
    'ui/html.js',
    'ui/nav-model.js',
    'ui/render.js',
    'ui/review.js',
    'ui/settings-forms.js',
    'ui/setup/checklist.js',
    'ui/setup/rows.js',
    'ui/sheet.js',
    'ui/tabs.js',
    'ui/tax-card.js',
    'ui/toast.js',
    'ui/today.js',
    'utils.js',
]);
const startupModule = (id) => {
    const path = id.split('\\').join('/');
    const i = path.lastIndexOf('/src/');
    return i >= 0 && STARTUP_MODULES.has(path.slice(i + 5));
};

// Ledger — Vite build. Vanilla JS (no framework); Vite gives us ES modules,
// hashed assets, and a *generated* service worker (vite-plugin-pwa/Workbox),
// replacing the manually-versioned sw.js that repeatedly went stale.
export default defineConfig({
    // Relative base so the same dist/ works on GitHub Pages subpaths and any static host.
    base: './',
    // D2: the Version row in Settings, About.
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    build: {
        rollupOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        { name: 'core', test: startupModule },
                        { name: 'pwa', test: /virtual:pwa-register|workbox-window/ },
                    ],
                },
            },
            input: {
                main: resolve(__dirname, 'index.html'),
                // The calculation test harness ships as a second page so the
                // deployed build can be verified in place (dev: /tests.html).
                // FT_NO_TESTS=1 leaves it out: deploy.yml runs the gate on the full build,
                // then rebuilds without it so the Pages artifact carries no test page.
                ...(process.env.FT_NO_TESTS ? {} : { tests: resolve(__dirname, 'tests.html') }),
            },
        },
    },
    // G6W12-6: the dev server must never serve real bank files or downloaded backups (they sit inside the Vite root).
    server: {
        fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/real-files/**', '**/finance-data-backup-*.json', '**/ledger-saved-data-*.json', '**/sweep-shots/**'] },
    },
    plugins: [
        ftCspHash(),
        VitePWA({
            registerType: 'prompt', // keep the explicit "Update Now" banner UX
            // manifest.json + icons live in public/ and are referenced from the
            // HTML directly; the plugin only generates the service worker.
            manifest: false,
            includeAssets: ['icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'manifest.json'],
            workbox: {
                globPatterns: ['**/*.{js,mjs,css,html,png,json,woff2}'],
                // App-shell fallback so deep links / offline navigations resolve.
                navigateFallback: 'index.html',
                cleanupOutdatedCaches: true,
            },
        }),
    ],
});
