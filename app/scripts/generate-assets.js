#!/usr/bin/env node
/**
 * Generates the VibeXStudio launcher/splash icons referenced by app.json.
 *
 * The repo is kept 100% text (no binary files committed), so these PNGs are
 * produced locally on `npm install` (postinstall) and always overwritten —
 * the artwork's source of truth is this script. To ship custom artwork,
 * replace the files and remove `patch-package &&`-style regeneration by
 * deleting the postinstall hook.
 *
 * The mark: a lightning bolt on the brand's violet→cyan NOIR diagonal
 * gradient, 2x supersampled for smooth edges. No dependencies — minimal RGBA
 * PNGs via node's zlib.
 */
const { deflateSync } = require('node:zlib');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, dirname } = require('node:path');

// Brand (keep in sync with src/constants/theme.ts — NOIR dark palette).
const GRAD_START = [0xa8, 0x9b, 0xff]; // violet
const GRAD_END = [0x5e, 0xc2, 0xff]; // cyan
const NAVY = [0x0b, 0x08, 0x06]; // warm near-black (NOIR ink)
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function png(size, pixelAt) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[row + 1 + x * 4] = r;
      raw[row + 2 + x * 4] = g;
      raw[row + 3 + x * 4] = b;
      raw[row + 4 + x * 4] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Lightning bolt polygon, normalized 0..1 coordinates. */
const BOLT = [
  [0.585, 0.1],
  [0.27, 0.55],
  [0.46, 0.55],
  [0.415, 0.9],
  [0.73, 0.45],
  [0.54, 0.45],
];

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Renders the brand mark at `size`, 2x supersampled.
 *  - bg: 'gradient' | 'navy' | 'transparent'
 *  - fg: bolt color ('white' | 'gradient' | 'navy'), or null for no bolt
 *  - boltScale: bolt size relative to the canvas (adaptive icons need ~0.6)
 *  - rounding: corner radius fraction (0 = square / full bleed)
 */
function renderMark(size, { bg, fg, boltScale = 1, rounding = 0 }) {
  const SS = 2;
  const big = size * SS;
  const radius = Math.floor(big * rounding);

  const sample = (x, y) => {
    const u = x / big;
    const v = y / big;
    // Rounded-corner mask.
    if (radius > 0) {
      const dx = Math.max(radius - x, x - (big - radius), 0);
      const dy = Math.max(radius - y, y - (big - radius), 0);
      if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];
    }
    // Bolt test in bolt-local coordinates (centered, scaled).
    const bu = (u - 0.5) / boltScale + 0.5;
    const bv = (v - 0.5) / boltScale + 0.5;
    const inBolt = fg && bu >= 0 && bu <= 1 && bv >= 0 && bv <= 1 && pointInPolygon(bu, bv, BOLT);
    const t = (u + v) / 2;
    if (inBolt) {
      const c = fg === 'white' ? WHITE : fg === 'navy' ? NAVY : lerp3(GRAD_START, GRAD_END, t);
      return [...c, 255];
    }
    if (bg === 'gradient') return [...lerp3(GRAD_START, GRAD_END, t), 255];
    if (bg === 'navy') return [...NAVY, 255];
    return [0, 0, 0, 0];
  };

  return png(size, (x, y) => {
    // Average the 2x2 supersample block.
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = sample(x * SS + sx, y * SS + sy);
        r += pr * pa;
        g += pg * pa;
        b += pb * pa;
        a += pa;
      }
    }
    if (a === 0) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / (SS * SS))];
  });
}

const { existsSync } = require('node:fs');

const root = join(__dirname, '..');
const targets = [
  // Android adaptive: navy bg layer + gradient-bolt foreground (safe zone ~66%).
  ['assets/images/android-icon-background.png', renderMark(432, { bg: 'navy', fg: null })],
  ['assets/images/android-icon-foreground.png', renderMark(432, { bg: 'transparent', fg: 'gradient', boltScale: 0.62 })],
  ['assets/images/android-icon-monochrome.png', renderMark(432, { bg: 'transparent', fg: 'white', boltScale: 0.62 })],
];

for (const [rel, data] of targets) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

// The iOS icon, splash, and favicon are real artwork (the neon "VibeX" sign,
// installed 2026-06 — also mirrored into ios/.../Images.xcassets). Never
// overwrite them; only generate placeholders on a fresh clone where the
// binaries are absent so the build still works.
const fallbacks = [
  ['assets/images/icon.png', () => renderMark(1024, { bg: 'gradient', fg: 'navy', boltScale: 0.92 })],
  ['assets/images/splash-icon.png', () => renderMark(512, { bg: 'transparent', fg: 'gradient', boltScale: 0.9 })],
  ['assets/images/favicon.png', () => renderMark(48, { bg: 'gradient', fg: 'navy', boltScale: 0.92, rounding: 0.2 })],
];
for (const [rel, make] of fallbacks) {
  const path = join(root, rel);
  if (!existsSync(path)) writeFileSync(path, make());
}
console.log('Generated VibeXStudio brand icons in assets/images/.');
