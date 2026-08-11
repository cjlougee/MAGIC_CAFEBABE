/**
 * Draw list to pixels, in plain TypeScript.
 *
 * No GPU, no canvas, no DOM. That is what lets a sprite be asserted on in vitest, baked
 * to a PNG from a node script, and drawn by the game, all from one definition.
 *
 * Alongside the colour buffer it keeps an **owner** map: which mark last covered each
 * pixel. Every occlusion question in the harness is a query on that map — a mark that
 * owns no pixel at all drew something nobody can see, which is precisely the bug that
 * put the door's lock bar behind its own near jamb and left two visible pixels of it.
 */

import type { DrawList, Mark } from './drawList';

export interface Raster {
  readonly width: number;
  readonly height: number;
  /** Straight (not premultiplied) RGBA, row-major. */
  readonly rgba: Uint8ClampedArray;
  /**
   * Index of the last mark to cover each pixel, or -1 for bare frame.
   *
   * "Last to cover" rather than "last to be visible in": a translucent mark takes
   * ownership from the opaque one beneath it. That costs nothing for the question the
   * harness actually asks — *did this mark end up anywhere at all* — because a mark
   * hidden under something translucent still owns its other pixels.
   */
  readonly owner: Int32Array;
}

/** Composites a draw list into a frame anchored at (0, 0), as `ArtProvider` states it. */
export function rasterize(list: DrawList, width: number, height: number): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const owner = new Int32Array(width * height).fill(-1);

  for (let k = 0; k < list.length; k++) {
    paint(list[k], k, rgba, owner, width, height);
  }

  return { width, height, rgba, owner };
}

function paint(
  mark: Mark,
  index: number,
  rgba: Uint8ClampedArray,
  owner: Int32Array,
  width: number,
  height: number,
): void {
  const b = mark.coverage.bounds;
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(width, Math.ceil(b.x + b.width));
  const y1 = Math.min(height, Math.ceil(b.y + b.height));

  const flat = typeof mark.paint === 'number' ? mark.paint : -1;
  const alpha = mark.alpha;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Pixel centres, not corners. Sampling at the corner shifts every shape half a
      // pixel up and left, which is invisible on one sprite and a systematic half-pixel
      // error the moment two sprites have to abut — see ADR 0002 on why seams matter.
      if (!mark.coverage.covers(x + 0.5, y + 0.5)) continue;

      const colour = flat >= 0 ? flat : (mark.paint as (x: number, y: number) => number)(x, y);
      const p = (y * width + x) * 4;

      if (alpha >= 1) {
        rgba[p] = (colour >> 16) & 0xff;
        rgba[p + 1] = (colour >> 8) & 0xff;
        rgba[p + 2] = colour & 0xff;
        rgba[p + 3] = 255;
      } else {
        const dstA = rgba[p + 3] / 255;
        const outA = alpha + dstA * (1 - alpha);
        // Source-over on straight alpha. Guarded because a translucent mark on bare
        // frame divides by its own alpha, and outA is only zero when both are.
        const blend = (src: number, dst: number): number =>
          outA === 0 ? 0 : (src * alpha + dst * dstA * (1 - alpha)) / outA;

        rgba[p] = blend((colour >> 16) & 0xff, rgba[p]);
        rgba[p + 1] = blend((colour >> 8) & 0xff, rgba[p + 1]);
        rgba[p + 2] = blend(colour & 0xff, rgba[p + 2]);
        rgba[p + 3] = outA * 255;
      }

      owner[y * width + x] = index;
    }
  }
}
