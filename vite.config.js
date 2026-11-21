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
                if (scripts.length !== 1) throw new Error('ft-csp-hash: expected exactly one classic inline script, found ' + scripts.length);
                const hash = createHash('sha256').update(scripts[0][1].replace(/\r\n/g, '\n'), 'utf8').digest('base64');
                if (!/script-src [^;]*'sha256-[^']+'/.test(html)) throw new Error('ft-csp-hash: no sha256 source in script-src');
                return html.replace(/(script-src [^;]*)'sha256-[^']+'/, "$1'sha256-" + hash + "'");
            },
        },
    };
}

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
            input: {
                main: resolve(__dirname, 'index.html'),
                // The calculation test harness ships as a second page so the
                // deployed build can be verified in place (dev: /tests.html).
                tests: resolve(__dirname, 'tests.html'),
            },
        },
    },
    plugins: [
        ftCspHash(),
        VitePWA({
            registerType: 'prompt', // keep the explicit "Update Now" banner UX
            // manifest.json + icons live in public/ and are referenced from the
            // HTML directly; the plugin only generates the service worker.
            manifest: false,
            includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'manifest.json'],
            workbox: {
                globPatterns: ['**/*.{js,mjs,css,html,png,json,woff2}'],
                // App-shell fallback so deep links / offline navigations resolve.
                navigateFallback: 'index.html',
                cleanupOutdatedCaches: true,
            },
        }),
    ],
});
