// PDF.js on-demand loader. The library is bundled (pdfjs-dist, pinned exact) but
// split into its own lazy chunk: import() at use-time, so it costs nothing at boot
// and failure still degrades gracefully, mirroring the pwa.js pattern. The worker
// is a hashed same-origin asset (?url), precached by the service worker, so PDF
// import works offline and no request ever leaves the origin (CSP worker-src 'self').
// Not covered: the wasm image decoders (JPX/JBIG2) for image-heavy PDFs; text
// statements and payslips do not need them.

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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
