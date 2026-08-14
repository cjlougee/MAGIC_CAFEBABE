/**
 * Parts that more than one model is built from.
 *
 * Small, and the reason it exists is not reuse for its own sake: a bed, a chair, a table
 * and a desk all stand on posts, and four copies of "where do the legs go" is four chances
 * for one of them to inset differently and read as a different piece of furniture from the
 * same room. The same argument `sim/world/footprint.ts` makes about cells.
 */

import type { MaterialId } from '../language';
import type { Solid } from './render';

/**
 * How far furniture holds back from the edge of the cells it stands on.
 *
 * Structures that *tile* — walls, floors — must fill their cell exactly or a run of them
 * shows a grid of gaps. Furniture is the opposite: it needs visible ground around it or a
 * bed placed against a wall reads as part of the wall. An eighth of a tile is enough to
 * separate without looking like it is floating in the middle of the room.
 */
export const MARGIN = 0.12;

/** Posts are square in plan and thin — a leg that reads as a slab is a plinth. */
export const LEG = 0.17;

/**
 * Four posts at the corners of a rectangle, running from the ground up to `top`.
 *
 * Tops are always hidden: a post runs *into* whatever it is holding up, so its top face is
 * never visible on any leg in any rotation. Said here once rather than excused four times
 * in four contracts — the harness named all four of the bed's leg tops on its first bake,
 * and a declaration covering them would have been covering for the model.
 */
export function legsAt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  top: number,
  material: MaterialId,
  label: string,
  thickness: number = LEG,
): Solid[] {
  return [
    [x0, y0],
    [x1 - thickness, y0],
    [x0, y1 - thickness],
    [x1 - thickness, y1 - thickness],
  ].map(([lx, ly], i) => ({
    x0: lx,
    y0: ly,
    z0: 0,
    x1: lx + thickness,
    y1: ly + thickness,
    z1: top,
    material,
    label: `${label} ${i}`,
    hideTop: true,
  }));
}

/**
 * A flat slab spanning a rectangle, `thick` storeys thick, with its **top** at `top`.
 *
 * Measured from the top down rather than the bottom up because that is how furniture is
 * described: a table is 0.55 of a storey high and its top happens to be six pixels thick.
 * Writing it the other way round means recomputing every surface whenever a thickness
 * changes, which is exactly how a mattress ends up floating above its frame.
 */
export function slab(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  top: number,
  thick: number,
  material: MaterialId,
  label: string,
): Solid {
  return { x0, y0, z0: top - thick, x1, y1, z1: top, material, label };
}
