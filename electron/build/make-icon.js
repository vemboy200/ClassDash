#!/usr/bin/env node
/**
 * Builds electron/build/icon.ico — the Windows app icon — from the 32x32
 * pixel-art icon next to this script (icon-source.png).
 *
 * That's the ROUNDED version of the icon: the same art as the repo root's
 * icon-source.png (which the macOS icon is made from), with the four corners
 * cut in a 3-2-1 pixel step and left transparent, the way a Windows icon is
 * expected to look.
 *
 *     node electron/build/make-icon.js
 *
 * Commit the resulting icon.ico; electron-builder uses it as it is
 * (`win.icon` in electron/package.json). Rerun after the art changes.
 *
 * ── Why this exists ──
 *
 * `win.icon` used to point at a single 1024x1024 PNG, which electron-builder
 * turned into an .ico holding ONE image, 256x256. Windows then shrinks that
 * for every other size it needs (16px title bar, 24px, 32px taskbar, 48px
 * Explorer) with smoothing — and a smoothing shrink is exactly wrong for
 * pixel art: the speed-dashes are one art pixel thick, so at 16px eight
 * separate dashes turned into four half-strength double-height bands, and at
 * 24px they smeared unevenly. So the icon holds one image per size, each
 * made the way pixel art wants:
 *
 *   32, 64, 128, 256   whole-number enlargements of the 32px art (x1 x2 x4
 *                      x8), nearest-neighbour: every art pixel a solid block.
 *   48                 x1.5, nearest-neighbour: crisp, though a dash is 1 or
 *                      2px thick alternately, as 1.5 can't be made even.
 *   16, 24             don't divide into 32 evenly, and eight one-pixel
 *                      dashes can't all survive a shrink to 16 rows anyway.
 *                      The art WITHOUT its dashes is shrunk, and the dashes
 *                      are drawn back on top as crisp 1px lines (see
 *                      DASHES) — at 16px there's room for four, at 24 for
 *                      all eight.
 *
 * ANY SIZE CAN BE HAND-DRAWN INSTEAD. Put a file named icon-16.png,
 * icon-24.png, icon-48.png (or -32/-64/-128/-256) next to this script,
 * exactly that many pixels square, RGBA, and it's used as it is in place of
 * the generated one. The generated 16/24/48 are stand-ins; a hand-drawn one
 * will nearly always be better.
 *
 * No dependencies: it decodes and encodes PNG itself, with zlib.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SOURCE = path.join(__dirname, 'icon-source.png');
const OUTPUT = path.join(__dirname, 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// ── The dashes ──
//
// In the 32px art: eight one-pixel lines, at rows 4, 7, 10 ... 25, alternately
// 10 and 7 pixels long, all ending at column 11 (the tile starts at 13).
// Per size: the output row of each, their lengths, and the last column.
const DASHES = {
  24: { rows: [3, 5, 7, 10, 12, 14, 16, 19], lengths: [7, 5, 7, 5, 7, 5, 7, 5], right: 8 },
  16: { rows: [2, 5, 8, 11],                 lengths: [5, 4, 5, 4],             right: 5 },
};

// ── PNG in, PNG out (8-bit RGBA, not interlaced — all this needs) ──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePng(buf) {
  let p = 8, w, h; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error('needs an 8-bit RGBA, non-interlaced PNG');
    }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * 4, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0, u = y ? out[(y - 1) * stride + x] : 0, c = x >= 4 && y ? out[(y - 1) * stride + x - 4] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c); }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, px: out };
}

function encodePng({ w, h, px }) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── Scaling ──

const blank = (n) => ({ w: n, h: n, px: Buffer.alloc(n * n * 4) });
const getPx = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]]; };
const setPx = (img, x, y, c) => { const i = (y * img.w + x) * 4; img.px[i] = c[0]; img.px[i + 1] = c[1]; img.px[i + 2] = c[2]; img.px[i + 3] = c[3]; };

/** Each output pixel takes the source pixel under its centre. Whole-number
 *  factors give solid blocks; 1.5 gives a mix of 1 and 2 pixel blocks. */
function nearest(src, n) {
  const out = blank(n), f = src.w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) setPx(out, x, y, getPx(src, Math.floor((x + 0.5) * f), Math.floor((y + 0.5) * f)));
  return out;
}

/** Each output pixel is the average of the source pixels it covers. Right
 *  for flat areas; used only on the art with its dashes taken out. Colours
 *  are weighted by alpha, so a transparent pixel (whose colour is meaningless)
 *  contributes nothing to its neighbours' colour, only to how see-through the
 *  result is. */
function boxDown(src, n) {
  const out = blank(n), f = src.w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sum = [0, 0, 0, 0]; let wsum = 0;
    for (let yy = y * f; yy < (y + 1) * f - 1e-9;) {
      const y0 = Math.floor(yy + 1e-9), ye = Math.min(y0 + 1, (y + 1) * f), wy = ye - yy;
      for (let xx = x * f; xx < (x + 1) * f - 1e-9;) {
        const x0 = Math.floor(xx + 1e-9), xe = Math.min(x0 + 1, (x + 1) * f), wgt = wy * (xe - xx), c = getPx(src, x0, y0);
        const al = c[3] / 255;
        sum[0] += c[0] * al * wgt; sum[1] += c[1] * al * wgt; sum[2] += c[2] * al * wgt; sum[3] += c[3] * wgt; wsum += wgt; xx = xe;
      }
      yy = ye;
    }
    // sum[0..2] are colours already multiplied by alpha, so dividing by the
    // total alpha weight (sum[3] / 255) gives back the true average colour.
    const cover = sum[3] / 255;
    setPx(out, x, y, cover > 0
      ? [Math.round(sum[0] / cover), Math.round(sum[1] / cover), Math.round(sum[2] / cover), Math.round(sum[3] / wsum)]
      : [0, 0, 0, 0]);
  }
  return out;
}

/** The most common fully-opaque colour — the icon's background. (Not read from
 *  a fixed pixel: the corners are transparent.) */
function dominantColour(src) {
  const counts = new Map();
  for (let i = 0; i < src.px.length; i += 4) {
    if (src.px[i + 3] !== 255) continue;
    const k = src.px[i] + ',' + src.px[i + 1] + ',' + src.px[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return [...best.split(',').map(Number), 255];
}

/** Snaps every pixel to fully clear or fully solid. Shrinking blends the
 *  rounded corners' edge pixels into half-see-through ones; pixel art wants
 *  the corner to stay a clean step. */
function hardenAlpha(img) {
  for (let i = 3; i < img.px.length; i += 4) {
    if (img.px[i] >= 128) img.px[i] = 255;
    else { img.px[i - 3] = img.px[i - 2] = img.px[i - 1] = img.px[i] = 0; }
  }
  return img;
}

/** The art with its speed-dashes painted over in the background colour: the
 *  white pixels left of the tile (column 12 and below). */
function withoutDashes(src) {
  const out = { w: src.w, h: src.h, px: Buffer.from(src.px) }, bg = dominantColour(src);
  for (let y = 0; y < src.h; y++) for (let x = 0; x <= 12; x++) {
    const c = getPx(src, x, y);
    if (c[0] === 255 && c[1] === 255 && c[2] === 255 && c[3] > 0) setPx(out, x, y, bg);
  }
  return out;
}

function drawDashes(img, spec) {
  spec.rows.forEach((row, k) => {
    for (let x = spec.right - spec.lengths[k] + 1; x <= spec.right; x++) setPx(img, x, row, [255, 255, 255, 255]);
  });
}

function generate(src, n) {
  if (n === 256 || n === 128 || n === 64 || n === 32) return nearest(src, n);
  if (n === 48) return nearest(src, 48);
  const img = hardenAlpha(boxDown(withoutDashes(src), n));
  drawDashes(img, DASHES[n]);
  return img;
}

// ── The .ico: a header, one 16-byte directory entry per image, then the
// images themselves, each stored as a PNG (which Windows has read since
// Vista). A size of 256 is written as 0.

function buildIco(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ n, png }) => {
    const e = Buffer.alloc(16);
    e[0] = n === 256 ? 0 : n; e[1] = n === 256 ? 0 : n;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length; return e;
  });
  return Buffer.concat([head, ...entries, ...images.map(i => i.png)]);
}

/** One image per size: a hand-drawn icon-N.png if there is one, else generated. */
function imagesFor(src) {
  return SIZES.map(n => {
    const file = path.join(__dirname, `icon-${n}.png`);
    if (fs.existsSync(file)) {
      const img = decodePng(fs.readFileSync(file));
      if (img.w !== n || img.h !== n) throw new Error(`${path.basename(file)} is ${img.w}x${img.h}, needs to be ${n}x${n}`);
      return { n, img, handDrawn: true };
    }
    return { n, img: generate(src, n), handDrawn: false };
  });
}

module.exports = { decodePng, encodePng, nearest, boxDown, hardenAlpha, dominantColour, withoutDashes, drawDashes, generate, imagesFor, buildIco, DASHES, SIZES, SOURCE, OUTPUT };

if (require.main === module) {
  const src = decodePng(fs.readFileSync(SOURCE));
  if (src.w !== 32 || src.h !== 32) throw new Error('icon-source.png must be 32x32');
  const images = imagesFor(src);
  fs.writeFileSync(OUTPUT, buildIco(images.map(({ n, img }) => ({ n, png: encodePng(img) }))));
  console.log(`wrote ${path.relative(process.cwd(), OUTPUT)}: ` + images.map(i => `${i.n}${i.handDrawn ? ' (hand-drawn)' : ''}`).join(', '));
}
