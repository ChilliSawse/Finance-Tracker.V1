// Z1: cold-load weight. node tools/measure-load.mjs [dist] [width] -> JSON (requests, raw and gzip bytes). SW blocked, load + 2.5 s.
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';
const srv = await serveDir(path.resolve(process.argv[2] || 'dist'));
const width = Number(process.argv[3] || 1440);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const rows = [];
    page.on('response', async (r) => {
        try {
            const b = await r.body();
            rows.push({ url: r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), status: r.status(), raw: b.length, gzip: gzipSync(b, { level: 6 }).length });
        } catch (e) { rows.push({ url: r.url(), status: r.status(), raw: 0, gzip: 0, err: String(e) }); }
    });
    await page.goto(`http://127.0.0.1:${srv.port}/index.html`);
    await page.waitForTimeout(2500);
    const ok = rows.filter((x) => x.status < 400);
    const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
    console.log(JSON.stringify({ width, n: ok.length, raw: sum(ok, 'raw'), gzip: sum(ok, 'gzip'), rows, failed: rows.filter((x) => x.status >= 400).map((x) => x.url) }, null, 1));
} finally { await browser.close(); srv.close(); }
