// Z1 (AT-4, AT-6): built app with the service worker ACTIVE, then offline: import a synthetic statement PDF and
// a synthetic payslip PDF; log every request origin. node tools/z1-offline.mjs [--out dir]
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';
import { buildStatementPdf, buildPayslipPdf } from './accept-fixtures.mjs';

const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'z1-shots');
await mkdir(out, { recursive: true });
const served = await serveDir(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'));
const base = `http://127.0.0.1:${served.port}/`;
const origin = new URL(base).origin;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const log = (k, v) => console.log(k.padEnd(34), v);
const toBuf = (x) => Buffer.from(x);
try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const ext = { cold: [], offline: [] };
    let phase = 'cold'; let count = { cold: 0, offline: 0 };
    page.on('request', (r) => { const u = r.url(); count[phase]++; if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) ext[phase].push(u); });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const sample = page.locator('[data-su="sample"]');
    if (await sample.count()) { await sample.first().click(); await page.waitForTimeout(1200); }
    const swState = await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return { active: reg.active && reg.active.state, scope: reg.scope }; });
    log('sw after first load', JSON.stringify(swState));
    // wait for precache to finish
    await page.waitForTimeout(3000);
    const cacheInfo = await page.evaluate(async () => { const ks = await caches.keys(); const out = []; for (const k of ks) out.push([k, (await (await caches.open(k)).keys()).length]); return out; });
    log('caches', JSON.stringify(cacheInfo));
    log('cold requests', count.cold + ' external: ' + JSON.stringify(ext.cold));
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
    const ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    log('page controlled by sw after reload', ctrl);
    // ---- offline ----
    phase = 'offline'; await ctx.setOffline(true);
    log('navigator.onLine', await page.evaluate(() => navigator.onLine));
    await page.locator('[data-tab-target="activity"]:visible').first().evaluate((el) => el.click());
    await page.locator('#open-pdf-import').click();
    await page.locator('#pdf-import-file').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: toBuf(buildStatementPdf()) });
    await page.waitForFunction(() => { const c = document.getElementById('pdf-import-config'); return c && !c.hidden; }, null, { timeout: 20000 }).catch(() => {});
    const stmt = await page.evaluate(() => ({ configShown: !document.getElementById('pdf-import-config').hidden, note: document.getElementById('pdf-import-detect-note').textContent, previewRows: document.querySelectorAll('#pdf-import-preview tr').length, status: document.getElementById('pdf-import-status').textContent, result: document.getElementById('pdf-import-result').textContent.slice(0, 200) }));
    log('statement import (offline)', JSON.stringify(stmt));
    await page.screenshot({ path: join(out, 'offline-statement.png') });
    await page.keyboard.press('Escape');
    // ---- payslip via the income sheet check panel ----
    let payslip;
    try {
        await page.locator('[data-tab-target="plan"]:visible').first().evaluate((el) => el.click());
        await page.waitForTimeout(500);
        await page.locator('[data-income-open="0"]').first().click();
        await page.waitForTimeout(800);
        await page.locator('.ils-slip').first().waitFor({ state: 'attached' });
        await page.locator('.ils-card input[type=file]').first().setInputFiles({ name: 'payslip.pdf', mimeType: 'application/pdf', buffer: toBuf(buildPayslipPdf()) });
        await page.waitForTimeout(3000);
        payslip = await page.evaluate(() => ({ files: document.querySelectorAll('input[type=file]').length, result: (document.querySelector('.ils-result')||{}).textContent, gross: document.getElementById('ils-slip-gross') && document.getElementById('ils-slip-gross').value, tax: document.getElementById('ils-slip-tax') && document.getElementById('ils-slip-tax').value, net: document.getElementById('ils-slip-net') && document.getElementById('ils-slip-net').value }));
        await page.screenshot({ path: join(out, 'offline-payslip.png') });
    } catch (e) { payslip = 'ERROR ' + String(e).slice(0, 300); }
    log('payslip import (offline)', JSON.stringify(payslip));
    log('offline requests', count.offline + ' external: ' + JSON.stringify(ext.offline));
    log('page errors', JSON.stringify(errs));
    await ctx.setOffline(false);
} finally { await browser.close(); served.close(); }
