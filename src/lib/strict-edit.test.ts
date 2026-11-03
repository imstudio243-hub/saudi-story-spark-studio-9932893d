import { describe, expect, it } from "vitest";
import { boxMask, compositeMasked, containFit, diffAgainstOriginal, recolor, toPx } from "./strict-edit";

function solid(W: number, H: number, rgb: [number, number, number]) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) d.set([...rgb, 255], p * 4);
  return d;
}

describe("strict edit engine", () => {
  it("recolor changes only the targeted colour inside the box", () => {
    const W = 20, H = 20;
    const d = solid(W, H, [255, 255, 255]);
    for (let y = 5; y < 10; y++) for (let x = 5; x < 15; x++) d.set([30, 80, 220, 255], (y * W + x) * 4); // blue button
    const orig = d.slice();
    const box = { x: 3, y: 3, w: 14, h: 9 };
    recolor(d, W, H, box, [30, 80, 220], [212, 175, 55]);
    const allowed = boxMask(W, H, box);
    const r = diffAgainstOriginal(orig, d, allowed);
    expect(r.outside).toBe(0);
    expect(r.inside).toBe(50); // exactly the 10x5 button pixels; the white around it is untouched
  });

  it("masked composite never touches pixels outside the mask", () => {
    const W = 10, H = 10;
    const base = solid(W, H, [10, 20, 30]);
    const orig = base.slice();
    const patch = solid(W, H, [200, 0, 0]);
    const mask = boxMask(W, H, { x: 2, y: 2, w: 4, h: 4 });
    compositeMasked(base, patch, mask, W, H, 0);
    expect(diffAgainstOriginal(orig, base, mask).outside).toBe(0);
  });

  it("QA detects a change outside the allowed area", () => {
    const W = 4, H = 4;
    const a = solid(W, H, [0, 0, 0]);
    const b = a.slice();
    b[0] = 255;
    expect(diffAgainstOriginal(a, b, new Uint8Array(16)).outside).toBe(1);
  });

  it("logos keep their aspect ratio when fitted", () => {
    const f = containFit(400, 100, { x: 0, y: 0, w: 100, h: 100 });
    expect(f.w / f.h).toBe(4);
  });

  it("converts normalized boxes to pixel boxes inside the image", () => {
    expect(toPx({ x: 0.5, y: 0.5, w: 0.8, h: 0.8 }, 100, 100)).toEqual({ x: 50, y: 50, w: 50, h: 50 });
  });
});
