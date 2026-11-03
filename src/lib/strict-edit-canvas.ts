// Browser-only canvas helpers for STRICT EDIT MODE (import only from client code paths).
import type { PxBox } from "./strict-edit";

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("المتصفح لا يدعم التحرير على اللوحة");
  return { c, ctx };
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("تعذر تحميل الصورة"));
    im.src = src;
  });
}

export function fileToDataUrl(f: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("تعذر قراءة الملف"));
    r.readAsDataURL(f);
  });
}

/** SVGs without width/height render at 0x0 or get stretched; give them their viewBox size. */
export async function loadLogo(dataUrl: string) {
  if (!dataUrl.startsWith("data:image/svg+xml")) return loadImage(dataUrl);
  const b64 = dataUrl.split(",")[1] ?? "";
  let svg = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const vb = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) {
    const scale = 1000 / Math.max(+vb[1]!, +vb[2]!);
    const w = Math.round(+vb[1]! * scale), h = Math.round(+vb[2]! * scale);
    svg = svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => `<svg${attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "")} width="${w}" height="${h}">`);
  }
  return loadImage(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`);
}

export function pixels(src: CanvasImageSource, w: number, h: number) {
  const { ctx } = canvas(w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function imageDataToBlob(d: ImageData) {
  const { c, ctx } = canvas(d.width, d.height);
  ctx.putImageData(d, 0, 0);
  return new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("تعذر التصدير"))), "image/png"));
}

export function downscaleJpeg(d: ImageData, max = 1280) {
  const s = Math.min(1, max / Math.max(d.width, d.height));
  const { c: src, ctx: sctx } = canvas(d.width, d.height);
  sctx.putImageData(d, 0, 0);
  const { c, ctx } = canvas(Math.round(d.width * s), Math.round(d.height * s));
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

/** Region (padded) around a box, used as inpaint context. */
export function contextRegion(b: PxBox, W: number, H: number) {
  const pad = Math.max(32, Math.round(Math.max(b.w, b.h) * 0.35));
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(W, b.x + b.w + pad) - x, h: Math.min(H, b.y + b.h + pad) - y };
}
