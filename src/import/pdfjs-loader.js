// PDF.js on-demand loader. The library is bundled (pdfjs-dist, pinned exact) but
// split into its own lazy chunk: import() at use-time, so it costs nothing at boot
// and failure still degrades gracefully, mirroring the pwa.js pattern. The worker
// is a hashed same-origin asset (?url), precached by the service worker, so PDF
// import works offline and no request ever leaves the origin (CSP worker-src 'self').
// Not covered: the wasm image decoders (JPX/JBIG2) for image-heavy PDFs; text
// statements and payslips do not need them.

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Hard limits: a huge or page-bombed PDF must fail early with a clear message
// instead of freezing the tab.
export const PDF_LIMITS = Object.freeze({
    maxFileBytes: 25 * 1024 * 1024,
    maxPages: 200,
});

export class PdfLimitError extends Error {
    /** @param {'too-large'|'too-many-pages'} code */
    constructor(code) {
        super(code);
        this.name = 'PdfLimitError';
        this.code = code;
    }
}

let pdfjsPromise = null;

/** Resolves to the pdfjs module (cached after the first load). */
export function loadPdfJs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist/build/pdf.min.mjs')
            .then((pdfjs) => {
                pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
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
    const task = pdfjs.getDocument({ data, isEvalSupported: false });
    const pdf = await task.promise;
    // pdf.js 6.x dropped PDFDocumentProxy.destroy(); it lives on the loading task.
    // Callers (pdf-ui.js) still call pdf.destroy(), so bridge it here.
    if (typeof pdf.destroy !== 'function') pdf.destroy = () => task.destroy();
    return pdf;
}

/**
 * Groups text items into lines by baseline: sort top to bottom, then one sweep
 * (O(n log n)); an item joins the current line while its baseline is within
 * 2.5 units of the line's first item.
 * @param {Array<{str:string, transform:number[]}>} items
 * @returns {Array<{y:number, items:Array<{x:number,str:string}>}>} top line first
 */
export function groupRows(items) {
    const pts = [];
    for (const item of items) {
        if (!item.str || !item.str.trim()) continue;
        pts.push({ x: item.transform[4], y: item.transform[5], str: item.str });
    }
    pts.sort((a, b) => b.y - a.y); // PDF y grows upward, so top of page first
    const rows = [];
    let row = null;
    for (const p of pts) {
        if (!row || Math.abs(row.y - p.y) > 2.5) { row = { y: p.y, items: [] }; rows.push(row); }
        row.items.push({ x: p.x, str: p.str });
    }
    return rows;
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
    if (pdf.numPages > PDF_LIMITS.maxPages) throw new PdfLimitError('too-many-pages');
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        if (onPage) onPage(p, pdf.numPages);
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const rows = groupRows(content.items);
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
