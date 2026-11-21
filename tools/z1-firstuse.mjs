// P3b: first-use binding on the built app. Run after `npm run build`.
//   node tools/z1-firstuse.mjs [--out dir]    (CHROMIUM_PATH points at a local chrome)
// Checks, each with a screenshot: first run opens Setup; Explore with sample data works; Import statement opens the
// file chooser and the flow wires once; the payslip upload sheet opens; Settings opens and builds once;
// Settings > Run setup again opens Setup after a lazy load. Exits 1 on any failure or page error.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';

const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'z1-firstuse-shots');
await mkdir(out, { recursive: true });
const served = await serveDir(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'));
const base = `http://127.0.0.1:${served.port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); };
const errs = [];

async function fresh(init) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    const chunks = [];
    page.on('request', (r) => { const m = r.url().match(/\/assets\/([a-z-]+)-[\w-]+\.js$/i); if (m) chunks.push(m[1]); });
    if (init) await page.addInitScript(init);
    await page.goto(base);
    await page.waitForTimeout(1200);
    return { ctx, page, chunks };
}
const tab = (page, name) => page.locator(`[data-tab-target="${name}"]:visible`).first().evaluate((el) => el.click());

try {
    // 1 + 2: a new user
    {
        const { ctx, page, chunks } = await fresh();
        check('first run: Setup welcome is open', await page.locator('[data-su="sample"]').count() === 1 && await page.evaluate(() => document.body.classList.contains('has-setup')));
        await page.screenshot({ path: join(out, '1-first-run-setup.png') });
        await page.locator('[data-su="sample"]').click();
        await page.waitForTimeout(4000);
        check('Explore with sample data: Setup closes', await page.evaluate(() => !document.body.classList.contains('has-setup')));
        check('Explore with sample data: the sample household is loaded', await page.evaluate(() => localStorage.getItem('ft-sample-data') === '1'));
        await page.screenshot({ path: join(out, '2-sample-loaded.png') });
        check('boot did not load import or settings chunks', !chunks.some((c) => ['import-ui', 'pdf-ui', 'settings-screen'].includes(c)), chunks.join(','));
        await ctx.close();
    }
    // 3: Import statement (returning user, with the sample household)
    {
        const { ctx, page, chunks } = await fresh();
        await page.locator('[data-su="sample"]').click();
        await page.waitForTimeout(4000);
        await page.reload(); await page.waitForTimeout(1200);
        await tab(page, 'activity'); await page.waitForTimeout(800);
        const before = chunks.filter((c) => c === 'import-ui').length;
        const csv = join(out, 'sample-import.csv');
        await writeFile(csv, 'Date,Description,Amount\n2026-11-01,Test coffee,-4.50\n2026-11-02,Test lunch,-12.00\n');
        for (let i = 1; i <= 2; i++) {
            const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#open-import').click()]);
            check(`Import statement click ${i} opens the file chooser`, !!chooser);
            await chooser.setFiles(csv);
            await page.waitForTimeout(1200);
            check(`import window opens after choosing a file (${i})`, await page.evaluate(() => !document.getElementById('import-modal').hidden));
            if (i === 1) await page.screenshot({ path: join(out, '3-import-opened.png') });
            await page.evaluate(() => document.querySelector('#import-modal .modal-close').click());
            await page.waitForTimeout(300);
        }
        const loads = chunks.filter((c) => c === 'import-ui').length - before;
        check('the import flow chunk loaded once', loads === 1, String(loads));
        check('one import modal open handler (modal opened, not toggled twice)', await page.evaluate(() => document.getElementById('import-modal').hidden));
        // 4: payslip upload sheet
        await tab(page, 'plan'); await page.waitForTimeout(800);
        await page.locator('[data-income-open]').first().click();
        await page.waitForTimeout(800);
        check('payslip upload input is in the income sheet', await page.locator('.sheet-layer input[type="file"]').count() >= 1);
        await page.screenshot({ path: join(out, '4-payslip-sheet.png') });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        // 5: Settings
        const sBefore = chunks.filter((c) => c === 'settings-screen').length;
        for (let i = 1; i <= 2; i++) {
            await page.locator('[data-open-settings]:visible').first().click();
            await page.waitForTimeout(900);
            check(`Settings opens (${i})`, await page.evaluate(() => document.getElementById('settings-root').classList.contains('active')));
            if (i === 1) await page.screenshot({ path: join(out, '5-settings.png') });
        }
        check('Settings built once', await page.locator('#settings-title').count() === 1 && chunks.filter((c) => c === 'settings-screen').length - sBefore === 1);
        // 6: Run setup again
        await page.locator('[data-s-act="setup"]').first().click();
        await page.waitForTimeout(1500);
        check('Settings > Run setup again opens Setup', await page.evaluate(() => document.body.classList.contains('has-setup')));
        await page.screenshot({ path: join(out, '6-run-setup-again.png') });
        await ctx.close();
    }
    check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
    await browser.close();
    served.close();
}
process.exit(results.every(Boolean) && errs.length === 0 ? 0 : 1);
