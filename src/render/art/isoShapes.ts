/**
 * The three shapes everything isometric is made of.
 *
 * A tile-sized top face and the two side faces that drop from its lower edges. Terrain
 * and buildings both draw from these, and they must agree exactly — a wall whose faces
 * are a pixel off the terrain's would show a seam along every join.
 *
 * Textures are laid out with the top face at y ∈ [0, TILE_H] and the sides hanging
 * below, so total texture height is `TILE_H + height`.
 */

import type { Graphics } from 'pixi.js';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import { FACE } from './language';

/** A flat diamond centred at (cx, cy). */
export function diamond(
  g: Graphics,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): Graphics {
  return g.poly([cx, cy - halfH, cx + halfW, cy, cx, cy + halfH, cx - halfW, cy]);
}

/** The tile's top face, filling the texture's upper band. */
export function topFace(g: Graphics): Graphics {
  return diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W, HALF_TILE_H);
}

/** Parallelogram down the left side, following the diamond's lower-left edge. */
export function leftFace(g: Graphics, top: number, depth: number): Graphics {
  return g.poly([
    0,
    HALF_TILE_H + top,
    HALF_TILE_W,
    TILE_H + top,
    HALF_TILE_W,
    TILE_H + top + depth,
    0,
    HALF_TILE_H + top + depth,
  ]);
}

/** Parallelogram down the right side, following the diamond's lower-right edge. */
export function rightFace(g: Graphics, top: number, depth: number): Graphics {
  return g.poly([
    HALF_TILE_W,
    TILE_H + top,
    TILE_W,
    HALF_TILE_H + top,
    TILE_W,
    HALF_TILE_H + top + depth,
    HALF_TILE_W,
    TILE_H + top + depth,
  ]);
}

/**
 * Side shading, as though light comes from the upper right.
 *
 * Shared so every raised thing in the game is lit from the same direction — the
 * cheapest way to make procedurally generated art look like one art style.
 *
 * **The numbers now live in `language.ts`**, with the rest of the style stated as figures
 * rather than prose. They are re-exported here under the names terrain and buildings have
 * always imported, because a stone wall has to butt against a rock face without a lighting
 * mismatch: these move for everyone or for no one.
 */
export const LEFT_FACE_SHADE = FACE.left;
export const RIGHT_FACE_SHADE = FACE.right;

/**
 * The same sun, for things that are not built from isometric faces.
 *
 * Pawns, item piles and plants are drawn from ellipses and rectangles, not from top and
 * side faces — but they stand in the same world and must be lit from the same place.
 * Sharing the *direction* rather than the geometry is what makes procedurally drawn art
 * look like one art style instead of a collection of separate ideas.
 *
 * **Only for discrete objects.** Anything that tiles must get its form from face shading
 * and mottling instead: a lit edge on every rock would draw a bright line between
 * adjacent rocks in the same mass, which is a seam grid over the whole mountain and
 * exactly what docs/decisions/0002-isometric-projection.md exists to prevent.
 */
export { LIT_SHIFT, SHADED_SHIFT } from './language';

/**
 * A thin band just inside a diamond's sunward (upper-right) edge.
 *
 * The safe way to light something that tiles. A highlight drawn on the tile's *own* edge
 * would meet its neighbour's edge and draw a bright line down every join — a grid across
 * a wall run or a rock face. Applied to an already-inset shape, such as a wall's cap,
 * the highlight is separated from the next tile by unlit border on both sides, so it
 * gives the surface a direction without ever touching a seam.
 *
 * `thickness` is a fraction of the shape's radius, not a pixel count, so it scales with
 * whatever it is drawn on.
 */
export function sunwardBand(
  g: Graphics,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  thickness: number,
): Graphics {
  const inner = 1 - thickness;
  const topX = cx;
  const topY = cy - halfH;
  const rightX = cx + halfW;
  const rightY = cy;

  return g.poly([
    topX,
    topY,
    rightX,
    rightY,
    cx + (rightX - cx) * inner,
    cy + (rightY - cy) * inner,
    cx + (topX - cx) * inner,
    cy + (topY - cy) * inner,
  ]);
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The outline of two adjacent tile diamonds merged into one long shape.
 *
 * A 2×1 object is not a rectangle on screen, it is a stretched hexagon, and which way it
 * leans depends on which screen diagonal the footprint runs along. Drawing two separate
 * diamonds instead leaves a visible waist where they meet.
 */
export function isoCapsule(g: Graphics, p: Point, q: Point, rw: number, rh: number): Graphics {
  // Ordered by screen depth first, so the shape does not depend on which end was named
  // first. Rotations 2 and 3 hand over the head *second*, and branching on the raw
  // argument order drew a self-intersecting bow-tie for exactly those two facings —
  // which is invisible at play zoom and unmissable on the sprite sheet.
  const [a, b] = p.y <= q.y ? [p, q] : [q, p];

  const points =
    b.x > a.x
      ? [a.x - rw, a.y, a.x, a.y - rh, b.x, b.y - rh, b.x + rw, b.y, b.x, b.y + rh, a.x, a.y + rh]
      : [a.x, a.y - rh, a.x + rw, a.y, b.x + rw, b.y, b.x, b.y + rh, b.x - rw, b.y, a.x - rw, a.y];
  return g.poly(points);
}

export function shifted(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy };
}

