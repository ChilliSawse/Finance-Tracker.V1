// Z1 / P3e: cold-load budget on the production build (FT-R-104).
//   node tools/z1-coldload.mjs [--table] [--dist dir]      (CHROMIUM_PATH points at a local chrome)
// By default it builds the app itself into a temp folder with FT_NO_TESTS=1, exactly as deploy.yml's final build does: the
// build that includes tests.html splits shared chunks differently, so measuring dist/ from a plain `npm run build` would be wrong.
// --dist measures a folder you already built (it must be an FT_NO_TESTS=1 build).
// Fresh browser context, service worker blocked, load + 2.5 s, gzip level 6 per response body, at 390 and 1440 wide.
// Returning user (ft-onboarded=1) must stay at or under 180 KB gzip and 12 requests, and pdf.js must not load.
// A first run is measured and printed, and pdf.js must not load there either; its size is not gated (it adds Setup).
// Exits 1 on any breach.

import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';

export const BUDGET = { gzipBytes: 180 * 1024, requests: 12 };
const args = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
let tmp = null;
let dist;
if (args.includes('--dist')) dist = resolve(args[args.indexOf('--dist') + 1]);
else {
    tmp = mkdtempSync(join(tmpdir(), 'ft-coldload-'));
    dist = join(tmp, 'dist');
    const b = spawnSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: root, env: { ...process.env, FT_NO_TESTS: '1' }, encoding: 'utf8' });
    if (b.status !== 0) { console.log('FAIL the production build failed');
    console.log(b.stdout + b.stderr); process.exit(1); }
}
const table = args.includes('--table');
const served = await serveDir(dist);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const fails = [];

async function measure(width, returning) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 } });
    try {
        const page = await ctx.newPage();
        if (returning) await page.addInitScript(() => { try { localStorage.setItem('ft-onboarded', '1'); } catch (e) { console.warn('storage blocked', e); } });
        const rows = [];
        page.on('response', async (r) => {
            try {
                const b = await r.body();
                rows.push({ url: r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), status: r.status(), raw: b.length, gzip: gzipSync(b, { level: 6 }).length });
            } catch (e) { rows.push({ url: r.url(), status: r.status(), raw: 0, gzip: 0 }); }
        });
        await page.goto(`http://127.0.0.1:${served.port}/index.html`);
        await page.waitForTimeout(2500);
        const ok = rows.filter((x) => x.status < 400);
        return { width, returning, ok, gzip: ok.reduce((s, x) => s + x.gzip, 0), failed: rows.filter((x) => x.status >= 400).map((x) => x.url) };
    } finally { await ctx.close(); }
}

try {
    for (const width of [390, 1440]) {
        for (const returning of [true, false]) {
            const m = await measure(width, returning);
            const label = `${returning ? 'returning' : 'first run'} @${width}`;
            console.log(`${label}: ${m.ok.length} requests, ${(m.gzip / 1024).toFixed(1)} KB gzip`);
            if (table) m.ok.slice().sort((a, b) => b.gzip - a.gzip).forEach((r) => console.log(`   ${String(r.gzip).padStart(6)}  ${r.url}`));
            if (m.ok.some((r) => /pdf\.min|pdf\.worker|pdfjs/i.test(r.url) && !/pdfjs-loader/i.test(r.url))) fails.push(`${label}: pdf.js loaded at startup`);
            if (m.failed.length) fails.push(`${label}: failed requests ${m.failed.join(', ')}`);
            if (returning && m.gzip > BUDGET.gzipBytes) fails.push(`${label}: ${(m.gzip / 1024).toFixed(1)} KB gzip is over ${BUDGET.gzipBytes / 1024} KB`);
            if (returning && m.ok.length > BUDGET.requests) fails.push(`${label}: ${m.ok.length} requests is over ${BUDGET.requests}`);
        }
    }
} finally { await browser.close(); served.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); }
if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1); }
console.log('ok   cold-load budget held');
