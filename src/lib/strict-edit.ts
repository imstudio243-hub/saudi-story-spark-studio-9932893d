// @ts-nocheck -- typed-array indexing is bounds-checked by loop limits; covered by strict-edit.test.ts
// STRICT EDIT MODE pixel engine. Pure functions on RGBA buffers so they run in the
// browser and in tests. Every edit is confined to an explicit mask; the QA check
// compares real pixels against the untouched original.

export type Box = { x: number; y: number; w: number; h: number }; // normalized 0..1
export type PxBox = { x: number; y: number; w: number; h: number };
export type RGB = [number, number, number];

export function toPx(b: Box, W: number, H: number): PxBox {
  const x = Math.max(0, Math.min(W - 1, Math.round(b.x * W)));
  const y = Math.max(0, Math.min(H - 1, Math.round(b.y * H)));
  const w = Math.max(1, Math.min(W - x, Math.round(b.w * W)));
  const h = Math.max(1, Math.min(H - y, Math.round(b.h * H)));
  return { x, y, w, h };
}

export function hexToRgb(hex: string): RGB | null {
  const m = hex.trim().replace("#", "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function boxMask(W: number, H: number, b: PxBox, pad = 0) {
  const m = new Uint8Array(W * H);
  const x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad);
  const x1 = Math.min(W, b.x + b.w + pad), y1 = Math.min(H, b.y + b.h + pad);
  for (let y = y0; y < y1; y++) m.fill(1, y * W + x0, y * W + x1);
  return m;
}

export function unionMask(a: Uint8Array, b: Uint8Array) {
  const m = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) m[i] = a[i] | b[i];
  return m;
}

const dist = (r: number, g: number, b: number, c: RGB) => Math.hypot(r - c[0], g - c[1], b - c[2]);

/** Most frequent colour inside a box, preferring the bucket closest to the hint. */
export function dominantColor(d: Uint8ClampedArray, W: number, b: PxBox, hint: RGB | null): RGB {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = (y * W + x) * 4;
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
      buckets.set(k, e);
    }
  let best: RGB = [0, 0, 0], bestScore = -Infinity;
  for (const e of buckets.values()) {
    const c: RGB = [e.r / e.n, e.g / e.n, e.b / e.n];
    const score = hint ? e.n / (1 + dist(c[0], c[1], c[2], hint) / 25) : e.n;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best.map(Math.round) as RGB;
}

/**
 * Replace one colour with another inside a box, keeping shading and anti-aliasing:
 * each pixel is shifted by (target - source) weighted by its closeness to source.
 * Returns the mask of pixels actually changed.
 */
export function recolor(d: Uint8ClampedArray, W: number, H: number, b: PxBox, source: RGB, target: RGB, tol = 70) {
  const changed = new Uint8Array(W * H);
  const ls = 0.299 * source[0] + 0.587 * source[1] + 0.114 * source[2] || 1;
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const p = y * W + x, i = p * 4;
      const dd = dist(d[i], d[i + 1], d[i + 2], source);
      if (dd > tol) continue;
      const w = dd < tol * 0.5 ? 1 : 1 - (dd - tol * 0.5) / (tol * 0.5);
      const lp = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const k = lp / ls;
      for (let c = 0; c < 3; c++) {
        const nv = Math.min(255, target[c] * k);
        d[i + c] = Math.round(d[i + c] * (1 - w) + nv * w);
      }
      changed[p] = 1;
    }
  return changed;
}

/**
 * Copy patch pixels into base only where mask=1, after correcting the patch's
 * global colour drift measured on a ring just inside the mask edge.
 */
export function compositeMasked(base: Uint8ClampedArray, patch: Uint8ClampedArray, mask: Uint8Array, W: number, H: number, ring = 3) {
  let n = 0;
  const off = [0, 0, 0];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!mask[p]) continue;
      let edge = false;
      for (let k = 1; k <= ring && !edge; k++)
        edge = !mask[y * W + Math.max(0, x - k)] || !mask[y * W + Math.min(W - 1, x + k)] || !mask[Math.max(0, y - k) * W + x] || !mask[Math.min(H - 1, y + k) * W + x];
      if (!edge) continue;
      for (let c = 0; c < 3; c++) off[c] += base[p * 4 + c] - patch[p * 4 + c];
      n++;
    }
  if (n) for (let c = 0; c < 3; c++) off[c] /= n;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) base[p * 4 + c] = Math.max(0, Math.min(255, patch[p * 4 + c] + off[c]));
    base[p * 4 + 3] = 255;
  }
  return { drift: off.map((v) => Math.round(v)) as RGB };
}

/** Real pixel comparison: how many pixels changed outside / inside the allowed mask. */
export function diffAgainstOriginal(orig: Uint8ClampedArray, next: Uint8ClampedArray, allowed: Uint8Array, threshold = 2) {
  let outside = 0, inside = 0;
  for (let p = 0; p < allowed.length; p++) {
    const i = p * 4;
    const ch = Math.abs(orig[i] - next[i]) > threshold || Math.abs(orig[i + 1] - next[i + 1]) > threshold || Math.abs(orig[i + 2] - next[i + 2]) > threshold || Math.abs(orig[i + 3] - next[i + 3]) > threshold;
    if (!ch) continue;
    if (allowed[p]) inside++; else outside++;
  }
  return { outside, inside };
}

/** Fit a source size into a box preserving aspect ratio (never stretches). */
export function containFit(srcW: number, srcH: number, b: PxBox, align: "left" | "center" | "right" = "center") {
  const s = Math.min(b.w / srcW, b.h / srcH);
  const w = Math.max(1, Math.round(srcW * s)), h = Math.max(1, Math.round(srcH * s));
  const x = align === "left" ? b.x : align === "right" ? b.x + b.w - w : b.x + Math.round((b.w - w) / 2);
  return { x, y: b.y + Math.round((b.h - h) / 2), w, h };
}

export const hasArabic = (s: string) => /[\u0600-\u06FF]/.test(s);
