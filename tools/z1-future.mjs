// Z1 (AT-12, Future cards): the built app with the sample household. node tools/z1-future.mjs [--out dir]
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';

const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'z1-shots');
await mkdir(out, { recursive: true });
const served = await serveDir(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'));
const base = `http://127.0.0.1:${served.port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const log = (k, v) => console.log(k.padEnd(30), typeof v === 'string' ? v : JSON.stringify(v));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
try {
    const W = Number(process.env.W || 1440);
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(base, { waitUntil: 'load' }); await page.waitForTimeout(1500);
    const s = page.locator('[data-su="sample"]'); if (await s.count()) { await s.first().click(); await page.waitForTimeout(1200); }
    await page.locator('[data-tab-target="future"]:visible').first().evaluate((el) => el.click());
    await page.waitForTimeout(1500);
    const cards = await page.evaluate(() => [...document.querySelectorAll('#future section.card, #future .card')].map((c) => ({ cls: c.className, h: (c.querySelector('h2') || {}).textContent, len: c.textContent.length })));
    log('future cards', cards);
    log('future hero text', clean(await page.locator('#future').innerText()).slice(0, 1500));
    const want = { debts: '.fu-debts', help: '.fu-helpcard', tax: '.fu-tax', lose: '.fu-lose' };
    for (const [k, sel] of Object.entries(want)) log('card ' + k, { count: await page.locator('#future ' + sel).count(), text: clean(await page.locator('#future ' + sel).first().innerText().catch(() => '')).slice(0, 260) });
    await page.screenshot({ path: join(out, `future-${W}.png`), fullPage: true });
    // tax-provision card: needs a variable income source (F6.7); flip the freelance source and reload
    await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('financeTrackerData_v2')); const src = o.financeData.incomeSources; (src[1] || src[0]).incomeType = 'variable'; localStorage.setItem('financeTrackerData_v2', JSON.stringify(o)); });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.locator('[data-tab-target="future"]:visible').first().evaluate((el) => el.click()); await page.waitForTimeout(1200);
    log('card tax (variable income)', { count: await page.locator('#future .fu-tax').count(), text: clean(await page.locator('#future .fu-tax').first().innerText().catch(() => '')).slice(0, 300) });
    await page.screenshot({ path: join(out, `future-tax-${W}.png`), fullPage: true });
    log('errors', errs);
} finally { await browser.close(); served.close(); }
