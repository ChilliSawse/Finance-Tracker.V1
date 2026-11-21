// P3e: a new user must never see a frame of Today before Setup. Samples every animation frame during a first-run load and
// counts frames where the app is visible, Setup is not open and Today has drawn content.
//   node tools/z1-firstframe.mjs [--dist dir] [--out dir]     (CHROMIUM_PATH points at a local chrome)
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const dist = resolve(opt('--dist') || fileURLToPath(new URL('../dist', import.meta.url)));
const out = opt('--out') ? resolve(opt('--out')) : null;
if (out) await mkdir(out, { recursive: true });
const served = await serveDir(dist);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let bad = 0;
try {
    for (const width of [390, 1440]) {
        const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        await page.addInitScript(() => {
            window.__frames = [];
            const tick = () => {
                const app = document.querySelector('.app'); const body = document.body;
                if (app && body) {
                    const tb = document.getElementById('today-body');
                    window.__frames.push({ visible: getComputedStyle(app).visibility !== 'hidden', setup: body.classList.contains('has-setup'), today: !!(tb && tb.children.length) });
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        await page.goto(`http://127.0.0.1:${served.port}/index.html`);
        await page.waitForSelector('[data-su="sample"]', { timeout: 8000 });
        await page.waitForTimeout(500);
        const frames = await page.evaluate(() => window.__frames);
        const flash = frames.filter((f) => f.visible && !f.setup && f.today).length;
        console.log(`${flash === 0 ? 'ok  ' : 'FAIL'} first run @${width}: ${frames.length} frames sampled, ${flash} showed Today before Setup`);
        if (flash) bad++;
        if (out) await page.screenshot({ path: join(out, `first-run-${width}.png`) });
        await ctx.close();
    }
} finally { await browser.close(); served.close(); }
process.exit(bad ? 1 : 0);
