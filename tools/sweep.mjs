// D4: the width sweep, adapted from mockup/bakeoff/_review.js. Opens each key screen of a built
// app at 360, 390, 768, 1024 and 1440 wide, screenshots it, and flags horizontal overflow, page
// errors and external requests. Uses the sample household (no real data).
//   npm run build && node tools/sweep.mjs [--out <dir>] [--dark] [--full] [--url <http://...>]
// --full (AT-3, P4) adds widths 1104 and 1300, then at 390 and 1440 the Quick-add sheet, Setup (first steps),
// the monthly review, What If Answer and Compare, and all four palettes in light and dark (Today and Plan).
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
const full = args.includes('--full');
const ALL_WIDTHS = [[360, 780], [390, 844], [768, 1024], [1024, 768], ...(full ? [[1104, 800], [1300, 900]] : []), [1440, 900]];
const only = opt('--width');
const WIDTHS = only ? ALL_WIDTHS.filter(([w]) => w === Number(only)) : ALL_WIDTHS;
const SCREENS = ['today', 'activity', 'plan', 'future', 'settings'];

await mkdir(out, { recursive: true });
const served = opt('--url') ? null : await serveDir(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'));
const base = opt('--url') || `http://127.0.0.1:${served.port}/`;
const origin = new URL(base).origin;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const rows = [];


// --full extras: one fresh context per width with the sample household, then each extra screen in turn.
async function fullPhase() {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        const external = [];
        const warns = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
        page.on('console', (m) => { if (m.type() === 'warning' && /not found/.test(m.text())) warns.push(m.text().slice(0, 120)); });
        page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
        await page.goto(base, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(1500);
        const sample = page.locator('[data-su="sample"]');
        if (await sample.count()) { await sample.first().click(); await page.waitForTimeout(4000); }
        const gotoTab = async (tab) => { await page.locator(`[data-tab-target="${tab}"]:visible`).first().evaluate((el) => el.click()); await page.waitForTimeout(500); };
        const shoot = async (name, setup) => {
            const rec = { w, screen: name, overflowX: null, errors: [], external: [] };
            try {
                await setup();
                await page.waitForTimeout(600);
                const o = await page.evaluate((devW) => ({
                    sw: document.documentElement.scrollWidth, iw: devW,
                    wide: (() => { for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > devW + 1 && getComputedStyle(el).position !== 'fixed') return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''); } return null; })(),
                }), w);
                rec.overflowX = o.sw > o.iw + 1;
                if (rec.overflowX) rec.widest = o.wide;
                await page.screenshot({ path: join(out, `x-${name}-${w}.png`) });
            } catch (e) { rec.errors.push('sweep: ' + String(e).replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300)); }
            rec.errors.push(...errors.splice(0), ...warns.splice(0).map((m) => 'console: ' + m));
            rec.external = [...new Set(external.splice(0))];
            rows.push(rec);
        };
        await shoot('quick-add', async () => { await gotoTab('today'); await page.locator('[data-quick-add]:visible').first().evaluate((el) => el.click()); await page.waitForTimeout(500); });
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
        await shoot('setup', async () => { await page.evaluate(() => document.dispatchEvent(new CustomEvent('ledger:run-setup', { cancelable: true }))); });
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
        await shoot('review', async () => { await gotoTab('plan'); await page.locator('[data-rv="open-link"]').first().evaluate((el) => el.click()); });
        await page.locator('[data-rv="back"]').first().evaluate((el) => el.click()).catch(() => {});
        await page.evaluate(() => {
            const o = JSON.parse(localStorage.getItem('financeTrackerData_v2')); const y = new Date().getFullYear() + 1;
            o.financeData.bucketGoals = [
                { id: 'g-concert', parentId: 'b-smile', name: 'Concert', share: 0, cost: 500, saved: 500, due: `${y}-01-13`, order: 0, done: false },
                { id: 'g-bike', parentId: 'b-smile', name: 'New bike', share: 0, cost: 3000, saved: 0, due: `${y}-03-01`, order: 1, done: false },
                { id: 'g-japan', parentId: 'b-smile', name: 'Japan', share: 0, cost: 7500, saved: 0, due: `${y}-06-01`, order: 2, done: false }];
            localStorage.setItem('financeTrackerData_v2', JSON.stringify(o));
        });
        await page.reload(); await page.waitForTimeout(1500);
        await gotoTab('future');
        await page.locator('[data-fu-new]').first().click(); await page.waitForTimeout(500);
        await shoot('whatif-ask', async () => {});
        await shoot('whatif-change-sheet', async () => { await page.locator('[data-act="starter"]').first().evaluate((el) => el.click()).catch(() => {}); await page.waitForTimeout(500); });
        await page.keyboard.press('Escape'); await page.waitForTimeout(400);
        await shoot('whatif-answer', async () => { await page.locator('[data-act="step"][data-step="answer"]').first().evaluate((el) => el.click()); await page.waitForTimeout(1200); });
        await shoot('whatif-compare', async () => { await page.locator('[data-view="compare"]').first().evaluate((el) => el.click()); await page.waitForTimeout(800); });
        await page.reload(); await page.waitForTimeout(1500);
        for (const palette of ['sunrise', 'bucket', 'eucalypt', 'harbour']) {
            for (const mode of ['light', 'dark']) {
                for (const tab of ['today', 'plan']) {
                    await shoot(`pal-${palette}-${mode}-${tab}`, async () => {
                        await page.evaluate(([p, m]) => { document.documentElement.dataset.palette = p; document.documentElement.dataset.mode = m; }, [palette, mode]);
                        await gotoTab(tab);
                    });
                }
            }
        }
        await ctx.close();
    }
}
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
        if (await sample.count()) { await sample.first().click(); await page.waitForTimeout(4000); }
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
                // At desktop widths the screen must sit in the main column, to the right of the sidebar, and show in the first viewport.
                if (w >= 1024) {
                    const lay = await page.evaluate((vh) => {
                        const side = document.querySelector('.side'); const scr = document.querySelector('.screen.active');
                        if (!side || !scr) return { missing: true };
                        const sr = side.getBoundingClientRect(); const r = scr.getBoundingClientRect();
                        return { left: Math.round(r.left), sideRight: Math.round(sr.right), top: Math.round(r.top), vh };
                    }, h);
                    if (lay.missing) rec.errors.push('layout: no sidebar or no active screen');
                    else if (lay.left < lay.sideRight - 1) rec.errors.push(`layout: main content starts at x=${lay.left}, left of the sidebar edge (${lay.sideRight})`);
                    else if (lay.top >= lay.vh - 100) rec.errors.push(`layout: main content starts at y=${lay.top}, below the first viewport (${lay.vh})`);
                }
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
    if (full) await fullPhase();
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
