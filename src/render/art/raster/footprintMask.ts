/**
 * Where a structure's ink is allowed to be.
 *
 * A sprite frame is a *rectangle*; the ground a structure actually claims is a **rhombus**
 * of tile diamonds inside it, and the corners of the rectangle belong to whatever is drawn
 * next door. So "inside the frame" is a much weaker promise than it sounds, and passing it
 * is exactly what the hearth did while being drawn a whole storey above its own footprint:
 * the frame is `TILE_H + rise` tall, so art placed at the very top of it is inside the
 * frame and standing on nothing.
 *
 * The allowed region is therefore the footprint's diamonds **extruded upward by the
 * structure's own rise** — a solid that stands on the ground it claims and reaches as high
 * as it says it does. Ink outside that is either overhanging a neighbour's tile or
 * floating.
 */

import { HALF_TILE_H, HALF_TILE_W } from '../../constants';
import { footprintCellCentre } from '../../iso';
import type { Mask } from './measure';

/**
 * The mask of a `w × h` footprint rising `rise` pixels, in a frame of the given size.
 *
 * Frame dimensions come from `footprintBounds`, so the two agree by construction — the
 * caller passes what `ArtProvider` states as the texture frame.
 */
export function footprintMask(
  width: number,
  height: number,
  w: number,
  h: number,
  rise: number,
): Mask {
  const ground = footprintGround(width, height, w, h, rise);
  if (rise <= 0) return ground;

  // Extrude upward. A pixel is allowed if the ground is under it within the rise — which
  // is what "this structure stands here and is this tall" means in screen space.
  const allowed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let k = 0; k <= rise; k++) {
        const below = y + k;
        if (below >= height) break;
        if (ground[below * width + x]) {
          allowed[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return allowed;
}

/**
 * Just the ground the structure stands on — the diamonds, without the extrusion.
 *
 * Separate because the contact sheet draws this as an outline underneath each sprite, and
 * an outline of the *extruded* solid would be a silhouette of the answer rather than a
 * picture of the question. Same arithmetic either way, which is the point of it being one
 * function: the sheet cannot disagree with the test about where the footprint is.
 */
export function footprintGround(
  width: number,
  height: number,
  w: number,
  h: number,
  rise: number,
): Mask {
  const ground = new Uint8Array(width * height);

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const c = footprintCellCentre(dx, dy, h, rise);
      // The diamond's own metric: |x| / halfW + |y| / halfH <= 1. Half a pixel of slack,
      // because ink is sampled at pixel centres and a diamond edge that lands exactly on
      // one would otherwise be judged outside the tile it is drawing.
      const x0 = Math.max(0, Math.floor(c.x - HALF_TILE_W));
      const x1 = Math.min(width, Math.ceil(c.x + HALF_TILE_W) + 1);
      const y0 = Math.max(0, Math.floor(c.y - HALF_TILE_H));
      const y1 = Math.min(height, Math.ceil(c.y + HALF_TILE_H) + 1);

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const u = Math.abs(x + 0.5 - c.x) / HALF_TILE_W;
          const v = Math.abs(y + 0.5 - c.y) / HALF_TILE_H;
          if (u + v <= 1 + 0.5 / HALF_TILE_H) ground[y * width + x] = 1;
        }
      }
    }
  }

  return ground;
}
