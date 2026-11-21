// Synthetic .xlsx builder for the D3a tests. Fake data only; no real bank files.
// Runs in Node 22 and in the browser (CompressionStream), so tests.html and the
// Node runner can both generate fixtures at test time. Nothing is committed as bytes.
//
//   import { buildXlsx, buildZip } from '../../tools/make-xlsx.mjs';
//   const bytes = await buildXlsx({ rows: [['Date','Amount'], [{ serial: 45658 }, '-12.50']] });
//
// Cell values: string (shared string, or inline when opts.inline), number,
// { serial, style } (a date: style 1 = built-in numFmt 14, 2 = custom dd/mm/yyyy),
// { text } (string forced inline), null (empty).

import { crc32 } from '../src/import/xlsx.js';

const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = (i) => String.fromCharCode(65 + i);

async function deflateRaw(bytes) {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(bytes);
    w.close();
    const out = [];
    const r = cs.readable.getReader();
    for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        out.push(value);
    }
    return concat(out);
}

function concat(parts) {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

/**
 * Builds a zip. files: [{ name, data: string|Uint8Array, method?: 0|8, flags?: number }].
 * method overrides and flags are written into the headers verbatim (for bad-input tests).
 */
export async function buildZip(files) {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
        const method = f.method === undefined ? 8 : f.method;
        const body = method === 8 ? await deflateRaw(data) : data;
        const flags = f.flags || 0;
        const crc = f.crc === undefined ? crc32(data) : f.crc;
        const lh = new Uint8Array(30 + name.length);
        const l = new DataView(lh.buffer);
        l.setUint32(0, 0x04034b50, true);
        l.setUint16(4, 20, true);
        l.setUint16(6, flags, true);
        l.setUint16(8, method, true);
        l.setUint32(14, crc, true);
        l.setUint32(18, body.length, true);
        l.setUint32(22, data.length, true);
        l.setUint16(26, name.length, true);
        lh.set(name, 30);
        const ch = new Uint8Array(46 + name.length);
        const c = new DataView(ch.buffer);
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, flags, true);
        c.setUint16(10, method, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, body.length, true);
        c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true);
        c.setUint32(42, offset, true);
        ch.set(name, 46);
        locals.push(lh, body);
        central.push(ch);
        offset += lh.length + body.length;
    }
    const cd = concat(central);
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cd.length, true);
    e.setUint32(16, offset, true);
    return concat([...locals, cd, end]);
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * @param {{rows: any[][], inline?: boolean, merges?: string[], method?: 0|8,
 *          date1904?: boolean, files?: Record<string, string|Uint8Array|null>,
 *          sheetPath?: string}} opts  opts.files adds, replaces or (null) removes parts.
 */
export async function buildXlsx(opts) {
    const rows = opts.rows;
    const shared = [];
    const sharedIdx = new Map();
    const sst = (s) => {
        if (!sharedIdx.has(s)) { sharedIdx.set(s, shared.length); shared.push(s); }
        return sharedIdx.get(s);
    };
    let sheetRows = '';
    rows.forEach((row, r) => {
        let cells = '';
        row.forEach((v, c) => {
            const ref = colName(c) + (r + 1);
            if (v === null || v === undefined) return;
            if (typeof v === 'number') cells += `<c r="${ref}"><v>${v}</v></c>`;
            else if (typeof v === 'object' && 'serial' in v) cells += `<c r="${ref}" s="${v.style || 1}"><v>${v.serial}</v></c>`;
            else if (typeof v === 'object' && 'text' in v) cells += `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v.text)}</t></is></c>`;
            else if (opts.inline) cells += `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
            else cells += `<c r="${ref}" t="s"><v>${sst(String(v))}</v></c>`;
        });
        sheetRows += `<row r="${r + 1}">${cells}</row>`;
    });
    const merges = (opts.merges || []).length
        ? `<mergeCells count="${opts.merges.length}">${opts.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
        : '';
    const sheetPath = opts.sheetPath || 'xl/worksheets/sheet1.xml';
    const parts = {
        '[Content_Types].xml': XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
        '_rels/.rels': XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': XML + `<workbook xmlns="${NS}" xmlns:r="${RNS}"><workbookPr${opts.date1904 ? ' date1904="1"' : ''}/><sheets><sheet name="Statement" sheetId="1" r:id="rId7"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="worksheet" Target="${sheetPath.replace(/^xl\//, '')}"/></Relationships>`,
        'xl/styles.xml': XML + `<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
        [sheetPath]: XML + `<worksheet xmlns="${NS}"><sheetData>${sheetRows}</sheetData>${merges}</worksheet>`,
    };
    if (shared.length) {
        parts['xl/sharedStrings.xml'] = XML + `<sst xmlns="${NS}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join('')}</sst>`;
    }
    Object.assign(parts, opts.files || {});
    const files = Object.entries(parts)
        .filter(([, d]) => d !== null)
        .map(([name, data]) => ({ name, data, method: opts.method === undefined ? 8 : opts.method }));
    return buildZip(files);
}
