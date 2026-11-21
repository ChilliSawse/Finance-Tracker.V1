// In-house XLSX statement reader (FT-R-65). Zero dependencies, offline.
// The zip central directory is parsed by hand; entries are inflated with
// DecompressionStream('deflate-raw'); XML is read with DOMParser.
//
// Security (G6): hard limits on file size, entry count, per-entry and total
// uncompressed size, a zip-bomb ratio guard, a streaming inflate (small input slices, output
// drained as it appears) that cancels at the cap (the zip header's declared size is never trusted), and any
// DOCTYPE or ENTITY declaration is rejected before the XML is parsed, so
// entities can never expand. Nothing is executed and nothing touches the DOM.
//
// readXlsx() resolves to { rows, sheetName } where rows are string arrays like
// parseCsv's (each carries .line = the sheet row number), or rejects with an
// XlsxError. The UI shows one message for every code ("export as CSV").

export const XLSX_LIMITS = Object.freeze({
    maxFileBytes: 15 * 1024 * 1024,
    maxEntries: 200,
    maxEntryBytes: 20 * 1024 * 1024,
    maxTotalBytes: 40 * 1024 * 1024,
    maxRatio: 100, // uncompressed : compressed, applied once an entry passes minRatioBytes
    minRatioBytes: 1024 * 1024,
    maxRows: 100000,
    maxCols: 256,
    maxCells: 1000000,
});

export class XlsxError extends Error {
    /** @param {'corrupt'|'encrypted'|'unsupported'|'too-large'|'unsafe'|'empty'} code */
    constructor(code, message) {
        super(message || code);
        this.name = 'XlsxError';
        this.code = code;
    }
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// ---- CRC32 ----
let crcTable = null;
export function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

// ---- zip ----
function readCentralDirectory(u8, limits) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length >= 8 && dv.getUint32(0, true) === 0xe011cfd0) {
        // OLE2 container: a password-protected workbook (or a legacy .xls)
        throw new XlsxError('encrypted', 'password-protected or legacy workbook');
    }
    if (u8.length < 22) throw new XlsxError('corrupt', 'too short to be a zip');
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new XlsxError('corrupt', 'no zip directory');
    const count = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
        throw new XlsxError('unsupported', 'zip64');
    }
    if (count > limits.maxEntries) throw new XlsxError('too-large', 'too many entries');
    if (cdOffset + cdSize > u8.length) throw new XlsxError('corrupt', 'directory out of range');

    const decoder = new TextDecoder('utf-8');
    const entries = new Map();
    let p = cdOffset;
    let total = 0;
    for (let i = 0; i < count; i++) {
        if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) {
            throw new XlsxError('corrupt', 'bad directory entry');
        }
        const flags = dv.getUint16(p + 8, true);
        const method = dv.getUint16(p + 10, true);
        const crc = dv.getUint32(p + 16, true);
        const csize = dv.getUint32(p + 20, true);
        const usize = dv.getUint32(p + 24, true);
        const nlen = dv.getUint16(p + 28, true);
        const xlen = dv.getUint16(p + 30, true);
        const clen = dv.getUint16(p + 32, true);
        const offset = dv.getUint32(p + 42, true);
        if (p + 46 + nlen > u8.length) throw new XlsxError('corrupt', 'bad entry name');
        const name = decoder.decode(u8.subarray(p + 46, p + 46 + nlen));
        p += 46 + nlen + xlen + clen;

        if (flags & 1 || flags & 0x40) throw new XlsxError('encrypted', 'encrypted entry');
        if (name.endsWith('/')) continue;
        if (method !== 0 && method !== 8) throw new XlsxError('unsupported', 'compression method ' + method);
        if (csize === 0xffffffff || usize === 0xffffffff) throw new XlsxError('unsupported', 'zip64');
        if (usize > limits.maxEntryBytes) throw new XlsxError('too-large', 'entry too large');
        total += usize;
        if (total > limits.maxTotalBytes) throw new XlsxError('too-large', 'archive too large');
        if (usize > limits.minRatioBytes && usize > csize * limits.maxRatio) {
            throw new XlsxError('too-large', 'compression ratio too high');
        }
        if (method === 0 && csize !== usize) throw new XlsxError('corrupt', 'stored size mismatch');
        entries.set(name, { name, method, crc, csize, usize, offset });
    }
    return entries;
}

// Feed size per write. Deflate expands at most ~1032:1, so one slice can add at
// most ~16 MB of buffered output before the reader sees it and can abort.
const INFLATE_SLICE = 16 * 1024;

/**
 * Inflates one entry while counting the output. The input goes in small slices
 * and the output is drained concurrently, so a bomb is cancelled as soon as it
 * passes the cap (or the ratio guard) and never buffers more than about one
 * slice's worth beyond it. (A single big write makes Chromium enqueue the whole
 * output at once, whatever the backpressure.) `stats.fed` reports how many input
 * bytes were written, for tests.
 */
export async function inflateCapped(data, cap, opts = {}) {
    const { maxRatio = Infinity, minRatioBytes = 0, stats = null, slice = INFLATE_SLICE } = opts;
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    let abort = null; // XlsxError once a limit trips
    let fed = 0;
    if (stats) stats.fed = 0;

    const pump = (async () => {
        try {
            for (let o = 0; o < data.length && !abort; o += slice) {
                const part = data.subarray(o, Math.min(o + slice, data.length));
                fed += part.length;
                if (stats) stats.fed = fed;
                await writer.write(part);
            }
            if (!abort) await writer.close();
        } catch (_) { /* the reader side reports the failure */ }
    })();

    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > cap) abort = new XlsxError('too-large', 'entry inflates past its declared size');
            else if (total > minRatioBytes && total > data.length * maxRatio) abort = new XlsxError('too-large', 'compression ratio too high');
            if (abort) {
                chunks.length = 0;
                reader.cancel().catch(() => {});
                writer.abort().catch(() => {});
                break;
            }
            chunks.push(value);
        }
    } catch (_) {
        if (!abort) abort = new XlsxError('corrupt', 'bad deflate data');
    }
    await pump;
    if (abort) throw abort;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

async function extract(u8, entry, limits) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const o = entry.offset;
    if (o + 30 > u8.length || dv.getUint32(o, true) !== 0x04034b50) {
        throw new XlsxError('corrupt', 'bad local header');
    }
    const start = o + 30 + dv.getUint16(o + 26, true) + dv.getUint16(o + 28, true);
    if (start + entry.csize > u8.length) throw new XlsxError('corrupt', 'entry out of range');
    const raw = u8.subarray(start, start + entry.csize);
    const out = entry.method === 0
        ? raw
        : await inflateCapped(raw, Math.min(entry.usize, limits.maxEntryBytes), { maxRatio: limits.maxRatio, minRatioBytes: limits.minRatioBytes });
    if (out.length !== entry.usize) throw new XlsxError('corrupt', 'size mismatch');
    if (crc32(out) !== entry.crc) throw new XlsxError('corrupt', 'checksum mismatch');
    return out;
}

// ---- xml ----
function parseXml(bytes) {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new XlsxError('unsafe', 'DOCTYPE or ENTITY not allowed');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) {
        throw new XlsxError('corrupt', 'bad xml');
    }
    return doc;
}
const all = (node, local) => Array.from(node.getElementsByTagNameNS('*', local));
const kids = (node, local) => Array.from(node.children).filter((c) => c.localName === local);

// text of an <si> or <is>: <t> and <r><t>, never phonetic runs
function richText(node) {
    let s = '';
    for (const c of Array.from(node.children)) {
        if (c.localName === 't') s += c.textContent;
        else if (c.localName === 'r') s += kids(c, 't').map((t) => t.textContent).join('');
    }
    return s;
}

// ---- dates ----
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateFormat(code) {
    const c = String(code).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[dy]/i.test(c);
}

/**
 * Excel serial (1900 system with its leap-year bug, or the 1904 system) to an
 * ISO date. Serial 60 is the non-existent 1900-02-29, returned as that string
 * so the row fails date validation visibly. Null for serial < 1 or absurd values.
 */
export function serialToIso(serial, date1904 = false) {
    if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
    const day = Math.floor(serial);
    if (!date1904 && day === 60) return '1900-02-29';
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, day < 60 ? 31 : 30);
    return new Date(epoch + day * 86400000).toISOString().slice(0, 10);
}

function cleanNumber(text) {
    const n = Number(text);
    if (!Number.isFinite(n)) return text;
    const s = String(parseFloat(n.toPrecision(15)));
    return /e/i.test(s) ? n.toFixed(6).replace(/\.?0+$/, '') : s;
}

function colIndex(ref) {
    const m = /^([A-Za-z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function resolveTarget(target) {
    const t = String(target);
    return t.startsWith('/') ? t.replace(/^\/+/, '') : 'xl/' + t.replace(/^\.\//, '');
}

/**
 * Reads the first worksheet of an .xlsx into rows of strings.
 * @param {ArrayBuffer|Uint8Array} input
 * @param {Partial<typeof XLSX_LIMITS>} [limitOverrides] for tests
 * @returns {Promise<{rows: string[][], sheetName: string}>}
 */
export async function readXlsx(input, limitOverrides = {}) {
    const limits = { ...XLSX_LIMITS, ...limitOverrides };
    try {
        const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (u8.length > limits.maxFileBytes) throw new XlsxError('too-large', 'file too large');
        const entries = readCentralDirectory(u8, limits);
        const read = async (name) => {
            const e = entries.get(name);
            return e ? parseXml(await extract(u8, e, limits)) : null;
        };

        const wb = await read('xl/workbook.xml');
        if (!wb) throw new XlsxError('corrupt', 'not a workbook');
        const sheetEl = all(wb, 'sheet')[0];
        if (!sheetEl) throw new XlsxError('corrupt', 'no worksheets');
        const sheetName = sheetEl.getAttribute('name') || '';
        const date1904 = all(wb, 'workbookPr').some((e) => /^(1|true)$/i.test(e.getAttribute('date1904') || ''));

        let sheetPath = 'xl/worksheets/sheet1.xml';
        const rid = sheetEl.getAttributeNS(REL_NS, 'id');
        const rels = await read('xl/_rels/workbook.xml.rels');
        if (rid && rels) {
            const rel = all(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
            if (rel && rel.getAttribute('Target')) sheetPath = resolveTarget(rel.getAttribute('Target'));
        }
        const sheet = await read(sheetPath);
        if (!sheet) throw new XlsxError('corrupt', 'worksheet missing');

        const sst = await read('xl/sharedStrings.xml');
        const shared = sst ? all(sst, 'si').map(richText) : [];

        // style index -> is a date format
        const dateStyle = [];
        const styles = await read('xl/styles.xml');
        if (styles) {
            const custom = new Map(all(styles, 'numFmt').map((n) => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode') || '']));
            const cellXfs = all(styles, 'cellXfs')[0];
            if (cellXfs) {
                kids(cellXfs, 'xf').forEach((xf, i) => {
                    const id = Number(xf.getAttribute('numFmtId') || 0);
                    dateStyle[i] = custom.has(id) ? isDateFormat(custom.get(id)) : BUILTIN_DATE_IDS.has(id);
                });
            }
        }

        // horizontally merged ranges: their anchors mark banner rows
        const mergeAnchors = new Set();
        for (const m of all(sheet, 'mergeCell')) {
            const [a, b] = String(m.getAttribute('ref') || '').split(':');
            if (a && b && colIndex(a) !== colIndex(b)) mergeAnchors.add(a.toUpperCase());
        }

        const rows = [];
        const banner = [];
        let cellCount = 0;
        let seq = 0;
        let seen = 0;
        for (const rowEl of all(sheet, 'row')) {
            // L4: count the rows actually present (the r= attribute can repeat) and
            // require r to move forward, so neither can dodge the row cap.
            if (++seen > limits.maxRows) throw new XlsxError('too-large', 'too many rows');
            const attr = Number(rowEl.getAttribute('r'));
            seq = attr > seq ? attr : seq + 1;
            if (seq > limits.maxRows) throw new XlsxError('too-large', 'too many rows');
            const cells = [];
            let nonEmpty = 0;
            let anchors = 0;
            let next = 0;
            for (const c of kids(rowEl, 'c')) {
                const ref = c.getAttribute('r');
                const idx = ref ? colIndex(ref) : next;
                next = idx + 1;
                if (idx < 0 || idx >= limits.maxCols) throw new XlsxError('too-large', 'too many columns');
                if (++cellCount > limits.maxCells) throw new XlsxError('too-large', 'too many cells');
                const t = c.getAttribute('t') || 'n';
                const vEl = kids(c, 'v')[0];
                const v = vEl ? vEl.textContent : '';
                let val = '';
                if (t === 's') {
                    const i = Number(v);
                    if (!Number.isInteger(i) || i < 0 || i >= shared.length) throw new XlsxError('corrupt', 'bad shared string index');
                    val = shared[i];
                } else if (t === 'inlineStr') {
                    const is = kids(c, 'is')[0];
                    val = is ? richText(is) : '';
                } else if (t === 'str') {
                    val = v;
                } else if (t === 'b') {
                    val = v === '1' ? 'TRUE' : 'FALSE';
                } else if (t === 'e') {
                    val = '';
                } else if (v !== '') {
                    val = cleanNumber(v.trim());
                    if (dateStyle[Number(c.getAttribute('s') || 0)]) {
                        const iso = serialToIso(Number(v), date1904);
                        if (iso) val = iso;
                    }
                }
                val = val.trim();
                cells[idx] = val;
                if (val !== '') {
                    nonEmpty++;
                    if (ref && mergeAnchors.has(ref.toUpperCase())) anchors++;
                }
            }
            if (!nonEmpty) continue;
            const row = Array.from(cells, (x) => x || '');
            while (row.length && row[row.length - 1] === '') row.pop();
            row.line = seq;
            rows.push(row);
            banner.push(nonEmpty < 2 || anchors === nonEmpty);
        }

        // Drop leading banner rows (titles, merged group headings) so the header
        // is the first row, as detectColumns expects.
        let skip = 0;
        while (skip < rows.length && banner[skip]) skip++;
        const out = rows.slice(skip);
        if (!out.length) throw new XlsxError('empty', 'no data rows');
        return { rows: out, sheetName };
    } catch (err) {
        if (err instanceof XlsxError) throw err;
        throw new XlsxError('corrupt', err && err.message);
    }
}
