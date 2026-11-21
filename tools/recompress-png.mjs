// P3e: lossless PNG recompressor (no external tools). node tools/recompress-png.mjs <in.png> <out.png>
// Decodes an 8-bit RGBA/RGB PNG, re-filters every row (best of the five filters by sum of absolute values), deflates at level 9,
// keeps the colour chunks (sRGB, gAMA, pHYs), and checks the decoded pixels are byte-identical before writing.
import fs from 'node:fs';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, 'latin1'); data.copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + data.length)), 8 + data.length); return o; };

export function parse(buf) {
    let p = 8; const keep = []; const idat = []; let hdr;
    while (p < buf.length) {
        const n = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8); const data = buf.subarray(p + 8, p + 8 + n);
        if (type === 'IHDR') hdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], ct: data[9], il: data[12], raw: data };
        else if (type === 'IDAT') idat.push(data);
        else if (type !== 'IEND') keep.push([type, data]);
        p += 12 + n;
    }
    return { hdr, keep, idat: Buffer.concat(idat) };
}
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
export function unfilter(data, w, h, bpp) {
    const stride = w * bpp; const out = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        const f = data[y * (stride + 1)]; const src = y * (stride + 1) + 1;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
            const v = data[src + x];
            out[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
        }
    }
    return out;
}
function refilter(px, w, h, bpp) {
    const stride = w * bpp; const out = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
        let best = null, bestSum = Infinity, bestF = 0;
        for (let f = 0; f < 5; f++) {
            const row = Buffer.alloc(stride); let sum = 0;
            for (let x = 0; x < stride; x++) {
                const cur = px[y * stride + x], a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
                const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
                const v = (cur - pred) & 255; row[x] = v; sum += v < 128 ? v : 256 - v;
            }
            if (sum < bestSum) { bestSum = sum; best = row; bestF = f; }
        }
        out[y * (stride + 1)] = bestF; best.copy(out, y * (stride + 1) + 1);
    }
    return out;
}
export function recompress(buf) {
    const { hdr, keep, idat } = parse(buf);
    if (hdr.depth !== 8 || hdr.il !== 0 || (hdr.ct !== 6 && hdr.ct !== 2)) throw new Error('only 8-bit non-interlaced RGB/RGBA');
    const bpp = hdr.ct === 6 ? 4 : 3;
    const px = unfilter(zlib.inflateSync(idat), hdr.w, hdr.h, bpp);
    const z = zlib.deflateSync(refilter(px, hdr.w, hdr.h, bpp), { level: 9, memLevel: 9 });
    const out = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hdr.raw), ...keep.map(([t, d]) => chunk(t, d)), chunk('IDAT', z), chunk('IEND', Buffer.alloc(0))]);
    const again = parse(out); const check = unfilter(zlib.inflateSync(again.idat), hdr.w, hdr.h, bpp);
    if (!check.equals(px)) throw new Error('pixels differ after recompress');
    return out;
}
if (process.argv[2]) {
    const input = fs.readFileSync(process.argv[2]); const out = recompress(input);
    console.log(`${process.argv[2]}: ${input.length} -> ${out.length} bytes`);
    if (process.argv[3]) fs.writeFileSync(process.argv[3], out.length < input.length ? out : input);
}
