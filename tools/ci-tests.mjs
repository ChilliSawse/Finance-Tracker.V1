// D4 / FT-R-100: the deploy gate. Builds nothing: serves the existing dist/, opens tests.html in
// headless Chromium and exits non-zero unless #summary reads "All N tests passed." (also on a
// uncaught page error, a missing build or a timeout).
//   npm run build && npm run test:ci
// CI installs the browser with `npx playwright-core install --with-deps chromium`.
// Locally, CHROMIUM_PATH may point at an installed chrome/chromium executable.

import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), process.argv[2] || 'dist');
const TIMEOUT_MS = Number(process.env.CI_TESTS_TIMEOUT_MS || 180000);

function fail(msg) {
    console.error('CI TESTS FAILED: ' + msg);
    process.exitCode = 1;
}

try {
    await stat(join(root, 'tests.html'));
} catch (_) {
    fail(`${root} has no tests.html (run npm run build first)`);
    process.exit(1);
}

const { port, close: closeServer } = await serveDir(root);

let browser;
try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/tests.html`, { timeout: 30000 });

    const deadline = Date.now() + TIMEOUT_MS;
    let last = '';
    let stableSince = Date.now();
    for (;;) {
        const text = await page.evaluate(() => document.getElementById('summary').textContent.trim());
        if (text !== last) { last = text; stableSince = Date.now(); }
        if (text !== 'Running…' && Date.now() - stableSince > 1500) break; // finished and not changing
        if (Date.now() > deadline) { fail(`timed out after ${TIMEOUT_MS} ms; #summary reads "${text}"`); break; }
        await page.waitForTimeout(250);
    }
    const cls = await page.evaluate(() => document.getElementById('summary').className);
    const failedRows = await page.evaluate(() => [...document.querySelectorAll('#results tr.fail')].slice(0, 20)
        .map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 300)));
    console.log(`#summary: ${last} (class "${cls}")`);
    if (!process.exitCode) {
        if (cls !== 'pass' || !/^✓ All \d+ tests passed\.$/.test(last)) {
            fail('the suite did not pass');
            for (const r of failedRows) console.error('  ' + r);
        }
        if (pageErrors.length) fail('page errors: ' + pageErrors.join(' | '));
    }
    if (!process.exitCode) console.log('CI tests OK');
} catch (err) {
    fail(String(err && err.stack ? err.stack : err));
} finally {
    if (browser) await browser.close();
    closeServer();
}
