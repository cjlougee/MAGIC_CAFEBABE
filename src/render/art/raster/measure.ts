/**
 * The measurements the art harness asserts on.
 *
 * M10 and M11 shipped seven art bugs. **Six were measurements, not judgements** — a
 * self-intersecting polygon, ink a whole storey above its own footprint, a pose six times
 * longer than it was wide, a body covering half its bed, a head outside the blanket
 * silhouette twice, and a lock bar with two visible pixels. Every one of those is a
 * number this file can produce.
 *
 * The seventh was "the shading is an awkward line, hard to tell what it is supposed to
 * be", and no function here will ever have anything to say about it. That is the division
 * of labour: measure everything measurable so the only thing left to look at is taste.
 */

import type { DrawList } from './drawList';
import { rasterize, type Raster } from './raster';

/** Inclusive-exclusive box of everything with any alpha at all. `null` for an empty frame. */
export interface InkBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly width: number;
  readonly height: number;
}

/** A per-pixel 0/1 map. The form every containment question is answered in. */
export type Mask = Uint8Array;

/** Pixels with any alpha. */
export function inkMask(raster: Raster, threshold = 0): Mask {
  const mask = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < mask.length; i++) {
    if (raster.rgba[i * 4 + 3] > threshold) mask[i] = 1;
  }
  return mask;
}

export function maskBounds(mask: Mask, width: number): InkBox | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = (i / width) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }

  if (x1 < x0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, width: x1 + 1 - x0, height: y1 + 1 - y0 };
}

export function inkBounds(raster: Raster): InkBox | null {
  return maskBounds(inkMask(raster), raster.width);
}

export function countMask(mask: Mask): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

/**
 * How many pixels each mark ended up owning.
 *
 * The lock bar was drawn behind the near jamb and survived as **two visible pixels** — a
 * lock the player has to remember rather than read. Nothing about that is invisible to a
 * test; it just needed someone to count. Zero is the degenerate case of the same measure,
 * and a legitimate one: the bed's two far legs are meant to be hidden, because you cannot
 * see the far legs of a bed either.
 */
export function visibleCounts(raster: Raster, markCount: number): number[] {
  const counts = new Array<number>(markCount).fill(0);
  for (const o of raster.owner) {
    if (o >= 0) counts[o]++;
  }
  return counts;
}

/**
 * The silhouette of a slice of the draw list.
 *
 * Answering "is the head on the blanket" needs the blanket's *whole* shape, not the part
 * of it still showing once the head is on top — the owner map cannot say, because the
 * head took those pixels. So the slice is rasterized on its own. The head floated off the
 * blanket's corner twice in M10 for want of exactly this.
 */
export function silhouette(list: DrawList, width: number, height: number): Mask {
  return inkMask(rasterize(list, width, height));
}

/** Pixels set in `inner` but not in `outer`. The unit of every containment failure. */
export function outside(inner: Mask, outer: Mask): number {
  let n = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] && !outer[i]) n++;
  }
  return n;
}

/** Every distinct opaque-ish colour, as `0xRRGGBB`. */
export function distinctColours(raster: Raster): Set<number> {
  const seen = new Set<number>();
  for (let i = 0; i < raster.owner.length; i++) {
    if (raster.rgba[i * 4 + 3] === 0) continue;
    seen.add((raster.rgba[i * 4] << 16) | (raster.rgba[i * 4 + 1] << 8) | raster.rgba[i * 4 + 2]);
  }
  return seen;
}

/** Whether two rasters are pixel-identical. Rotations that must differ, and must not. */
export function samePixels(a: Raster, b: Raster): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.rgba.length; i++) {
    if (a.rgba[i] !== b.rgba[i]) return false;
  }
  return true;
}

/**
 * A coarse ASCII view, brightest tone first.
 *
 * For failure messages. A test that says the ink box is wrong tells you *that* something
 * moved; twenty lines of ASCII tell you *what* moved, without a dev server, a browser or
 * a screenshot — which is the entire economy this harness is arguing for.
 */
export function ascii(raster: Raster, step = 2): string {
  const lum = (i: number): number =>
    0.3 * raster.rgba[i * 4] + 0.6 * raster.rgba[i * 4 + 1] + 0.1 * raster.rgba[i * 4 + 2];

  const tones = [...new Set(
    [...raster.owner.keys()].filter((i) => raster.rgba[i * 4 + 3] > 0).map((i) => Math.round(lum(i))),
  )].sort((a, b) => b - a);

  const ramp = '@#%*+=~-:.';
  let out = '';
  for (let y = 0; y < raster.height; y += step) {
    for (let x = 0; x < raster.width; x += step) {
      const i = y * raster.width + x;
      out += raster.rgba[i * 4 + 3] === 0
        ? ' '
        : ramp[Math.min(ramp.length - 1, tones.indexOf(Math.round(lum(i))))];
    }
    out += '\n';
  }
  return out;
}
