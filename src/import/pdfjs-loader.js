// PDF.js on-demand loader. The library is a CDN dynamic import — never a
// bundled dependency — mirroring the pwa.js 'virtual:pwa-register' pattern:
// import() at use-time, failure degrades gracefully. The CSP meta in
// index.html whitelists cdn.jsdelivr.net in script-src for exactly this.
//
// Worker note: browsers refuse cross-origin Worker construction, so PDF.js
// falls back to its "fake worker" (a dynamic import of the worker module on
// the main thread — also covered by the CSP entry). Main-thread parsing is
// fine for statement-sized PDFs.

const PDFJS_VERSION = '4.10.38';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let pdfjsPromise = null;

/** Resolves to the pdfjs module (cached after the first load). */
export function loadPdfJs() {
    if (!pdfjsPromise) {
        // @vite-ignore keeps Vite from trying to resolve/bundle the CDN URL.
        pdfjsPromise = import(/* @vite-ignore */ `${CDN_BASE}/pdf.min.mjs`)
            .then((pdfjs) => {
                pdfjs.GlobalWorkerOptions.workerSrc = `${CDN_BASE}/pdf.worker.min.mjs`;
                return pdfjs;
            })
            .catch((err) => {
                pdfjsPromise = null; // allow a retry once the network is back
                throw err;
            });
    }
    return pdfjsPromise;
}

/**
 * Open a PDF from an ArrayBuffer. Throws pdf.js's typed exceptions
 * (PasswordException / InvalidPDFException) for the caller to translate.
 */
export async function openPdfDocument(pdfjs, data) {
    // isEvalSupported: false — the app's CSP has no 'unsafe-eval'.
    return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

/**
 * Extract positioned text lines from every page.
 * Returns one array per page; each line is { y, text, items:[{x, str}] } with
 * lines ordered top→bottom and items left→right. Positions let bank parsers
 * assign amounts to debit/credit columns by x when statements print unsigned
 * figures.
 * @param {object} pdf - PDFDocumentProxy
 * @param {(page:number, total:number) => void} [onPage] - progress callback
 */
export async function extractPagesLines(pdf, onPage) {
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        if (onPage) onPage(p, pdf.numPages);
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const rows = [];
        for (const item of content.items) {
            if (!item.str || !item.str.trim()) continue;
            const x = item.transform[4];
            const y = item.transform[5];
            // Merge into an existing line when the baselines are near-equal.
            let row = rows.find(r => Math.abs(r.y - y) <= 2.5);
            if (!row) { row = { y, items: [] }; rows.push(row); }
            row.items.push({ x, str: item.str });
        }
        rows.sort((a, b) => b.y - a.y); // PDF y grows upward → top of page first
        const lines = rows.map(r => {
            r.items.sort((a, b) => a.x - b.x);
            return {
                y: r.y,
                items: r.items,
                text: r.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim(),
            };
        }).filter(l => l.text !== '');
        pages.push(lines);
    }
    return pages;
}
