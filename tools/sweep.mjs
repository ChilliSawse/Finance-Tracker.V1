// D4: the width sweep, adapted from mockup/bakeoff/_review.js. Opens each key screen of a built
// app at 360, 390, 768, 1024 and 1440 wide, screenshots it, and flags horizontal overflow, page
// errors and external requests. Uses the sample household (no real data).
//   npm run build && node tools/sweep.mjs [--out <dir>] [--dark] [--url <http://...>]
// Without --url it serves dist/ itself. CHROMIUM_PATH points at a local chrome if the Playwright
// browser is not installed. Exits 1 if any screen overflows or errors.

import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = resolve(opt('--out') || 'sweep-shots');
const dark = args.includes('--dark');
const ALL_WIDTHS = [[360, 780], [390, 844], [768, 1024], [1024, 768], [1440, 900]];
const only = opt('--width');
const WIDTHS = only ? ALL_WIDTHS.filter(([w]) => w === Number(only)) : ALL_WIDTHS;
const SCREENS = ['today', 'activity', 'plan', 'future', 'settings'];

await mkdir(out, { recursive: true });
const served = opt('--url') ? null : await serveDir(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'));
const base = opt('--url') || `http://127.0.0.1:${served.port}/`;
const origin = new URL(base).origin;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const rows = [];

try {
    for (const [w, h] of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' });
        const page = await ctx.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        const external = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
        page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
        await page.goto(base, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(1500); // the first-run welcome renders after load
        const sample = page.locator('[data-su="sample"]');
        if (await sample.count()) { await sample.first().click(); await page.waitForTimeout(1200); }
        for (const screen of SCREENS) {
            const rec = { w, screen, overflowX: null, errors: [], external: [] };
            try {
                // A DOM click, not a pointer click: at a width the page cannot fit, the layout viewport is wider than
                // the device and the pointer lands on whatever overlaps; that overflow is reported below instead.
                const sel = screen === 'settings' ? '[data-open-settings]' : `[data-tab-target="${screen}"]`;
                await page.locator(`${sel}:visible`).first().evaluate((el) => el.click());
                await page.waitForTimeout(500);
                const o = await page.evaluate((devW) => ({
                    // device width, not innerWidth: a mobile layout viewport grows to fit a too-wide page
                    sw: document.documentElement.scrollWidth, iw: devW,
                    // the first element sticking out past the right edge, by tag and class only (no page text)
                    wide: (() => { for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > devW + 1 && getComputedStyle(el).position !== 'fixed') return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''); } return null; })(),
                }), w);
                rec.overflowX = o.sw > o.iw + 1;
                if (rec.overflowX) rec.widest = o.wide;
                await page.screenshot({ path: join(out, `${screen}-${w}${dark ? '-dark' : ''}.png`) });
                if (screen === 'settings') await page.keyboard.press('Escape');
            } catch (e) { rec.errors.push('sweep: ' + String(e).replace(/001b[[0-9;]*m/g, '').slice(0, 700)); }
            rec.errors.push(...errors.splice(0));
            rec.external = [...new Set(external.splice(0))];
            rows.push(rec);
        }
        await ctx.close();
    }
} finally {
    await browser.close();
    if (served) served.close();
}

let bad = 0;
for (const r of rows) {
    const flags = [r.overflowX ? `OVERFLOW (${r.widest || '?'})` : null, r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : null, r.external.length ? 'EXTERNAL ' + r.external.join(' ') : null].filter(Boolean);
    if (flags.length) bad++;
    console.log(`${String(r.w).padStart(4)}  ${r.screen.padEnd(9)} ${flags.length ? flags.join('  ') : 'ok'}`);
}
console.log(bad ? `${bad} screen(s) flagged. Screenshots in ${out}` : `All ${rows.length} screens ok. Screenshots in ${out}`);
process.exit(bad ? 1 : 0);
