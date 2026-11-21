// Z1 (AT-11, the part plain http on 127.0.0.1 can prove; localhost is a secure context so the service worker runs):
// serve build A, let the SW install, close; serve build B (A with sw.js changed by one comment line), reopen the SAME profile,
// look for the Update prompt, tap it, and check the page ends controlled by the new worker. No tailscale involved.
//   node tools/z1-update.mjs <dist> [--out dir]
import { mkdir, mkdtemp, cp, appendFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';
const dist = resolve(process.argv[2] || 'dist');
const out = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'z1-shots');
await mkdir(out, { recursive: true });
const tmp = await mkdtemp(join(tmpdir(), 'z1-upd-'));
const A = join(tmp, 'A'), B = join(tmp, 'B'), prof = join(tmp, 'prof');
await cp(dist, A, { recursive: true }); await cp(dist, B, { recursive: true });
await appendFile(join(B, 'sw.js'), '\n// build B marker\n');
const log = (k, v) => console.log(k.padEnd(30), typeof v === 'string' ? v : JSON.stringify(v));
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import { extname } from 'node:path';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const PORT = 8763;
const serve = (root) => new Promise((ok) => { const s = http.createServer(async (q, r) => { try { const p = decodeURIComponent(q.url.split('?')[0]); const d = await readFile(join(root, p === '/' ? 'index.html' : p)); r.writeHead(200, { 'content-type': T[extname(p === '/' ? 'x.html' : p)] || 'application/octet-stream', 'cache-control': 'no-cache' }); r.end(d); } catch (_) { r.writeHead(404); r.end(); } }).listen(PORT, '127.0.0.1', () => ok(s)); });
const open = async (root, fn) => {
    const s = await serve(root);
    const ctx = await chromium.launchPersistentContext(prof, { executablePath: process.env.CHROMIUM_PATH, viewport: { width: 1440, height: 900 } });
    const page = ctx.pages()[0] || await ctx.newPage();
    try { await fn(page); } finally { await ctx.close(); s.close(); }
};
try {
    await open(A, async (page) => {
        await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForTimeout(1500);
        const sm = page.locator('[data-su="sample"]'); if (await sm.count()) { await sm.first().click(); await page.waitForTimeout(1000); }
        await page.waitForTimeout(3500);
        log('A: sw state', await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active.state; }));
        log('A: update banner', await page.locator('#update-banner, .update-banner, [data-update]').count());
    });
    await open(B, async (page) => {
        await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForTimeout(4000);
        const st = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { waiting: !!(r && r.waiting), active: !!(r && r.active), controller: !!navigator.serviceWorker.controller }; });
        log('B: registration', st);
        const txt = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /update/i.test(b.textContent)).map((b) => b.textContent.trim() + '|' + b.closest('[role],div').className).slice(0, 5));
        log('B: update buttons', txt);
        log('B: body mentions update', /update/i.test(await page.locator('body').innerText()));
        await page.screenshot({ path: join(out, 'update-prompt.png') });
        const btn = page.locator('button', { hasText: /update now|update/i }).first();
        if (await btn.count()) {
            await btn.click().catch(() => {}); await page.waitForTimeout(3500);
            log('B: after tap', await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { waiting: !!(r && r.waiting), controller: !!navigator.serviceWorker.controller, hasData: !!localStorage.getItem('financeTrackerData_v2') }; }));
        }
    });
} finally { await rm(tmp, { recursive: true, force: true }).catch(() => {}); }
