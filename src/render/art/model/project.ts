/**
 * Tile space to sprite frame, and the quarter turns in between.
 *
 * The model layer's whole claim is that a sprite should describe **the object**, not its
 * picture: a bed is a frame 0.46 storeys up on four posts, not a list of screen-pixel
 * polygons. That claim only pays if the conversion from object to picture lives in one
 * place and is right — which is this file.
 *
 * Two things come free the moment it does, and both were bugs before:
 *
 *  - **Rotation.** Turning a model is turning its coordinates, so four facings are the
 *    same shape seen four ways rather than four drawings that have to be kept agreeing.
 *    The bow-tie capsule was two of four facings drawn by a different code path.
 *  - **Footprint containment.** A solid inside the footprint's tile range cannot project
 *    outside the footprint's diamonds. The hearth drawn a storey above its own footprint
 *    is not expressible here.
 */

import { HALF_TILE_H, HALF_TILE_W, LEVEL_HEIGHT } from '../../constants';
import type { Footprint } from '../../../sim/defs/buildings';
import type { Rotation } from '../../../sim/world/footprint';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A point in the footprint's own space.
 *
 * `x` and `y` are in **tiles**, running 0..w and 0..h across the unrotated footprint.
 * `z` is in **storeys**, so 1.0 is `LEVEL_HEIGHT` — see `language.ts` on why heights are
 * proportions and not pixel counts.
 */
export interface TileSpace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Turns a point through `rotation` quarter turns clockwise within a `w × h` footprint.
 *
 * **This has to agree with `sim/world/footprint.ts` exactly**, and the check that it does
 * is `headCellOf`: rotations 0 and 1 put the facing end at the anchor, 2 and 3 at the far
 * corner. If the art turned one way and the simulation the other, a colonist would sleep
 * with their head at the foot of the bed and every measurement would still pass.
 */
export function rotatePoint(p: TileSpace, footprint: Footprint, rotation: Rotation): TileSpace {
  const { w, h } = footprint;
  switch (rotation) {
    case 1:
      return { x: h - p.y, y: p.x, z: p.z };
    case 2:
      return { x: w - p.x, y: h - p.y, z: p.z };
    case 3:
      return { x: p.y, y: w - p.x, z: p.z };
    default:
      return p;
  }
}

/**
 * A projector for one sprite frame.
 *
 * `h` is the **rotated** footprint height, which is what decides how far right the frame's
 * leftmost point pushes the origin; `rise` is the frame's own headroom in pixels. Both
 * come from `footprintBounds`, so the frame the art draws into and the frame the layer
 * positions are the same frame by construction.
 */
export function projector(rotatedHeight: number, rise: number) {
  return (p: TileSpace): Point => ({
    x: (p.x - p.y + rotatedHeight) * HALF_TILE_W,
    y: (p.x + p.y) * HALF_TILE_H + rise - p.z * LEVEL_HEIGHT,
  });
}

export type Projector = ReturnType<typeof projector>;
