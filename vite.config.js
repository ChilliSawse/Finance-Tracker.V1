import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Ledger — Vite build. Vanilla JS (no framework); Vite gives us ES modules,
// hashed assets, and a *generated* service worker (vite-plugin-pwa/Workbox),
// replacing the manually-versioned sw.js that repeatedly went stale.
export default defineConfig({
    // Relative base so the same dist/ works on GitHub Pages subpaths and any static host.
    base: './',
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
        VitePWA({
            registerType: 'prompt', // keep the explicit "Update Now" banner UX
            // manifest.json + icons live in public/ and are referenced from the
            // HTML directly; the plugin only generates the service worker.
            manifest: false,
            includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'manifest.json'],
            workbox: {
                globPatterns: ['**/*.{js,css,html,png,json,woff2}'],
                // App-shell fallback so deep links / offline navigations resolve.
                navigateFallback: 'index.html',
                cleanupOutdatedCaches: true,
            },
        }),
    ],
});
