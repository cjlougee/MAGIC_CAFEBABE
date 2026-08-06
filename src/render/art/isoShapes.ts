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
 */
export const LEFT_FACE_SHADE = -0.3;
export const RIGHT_FACE_SHADE = -0.14;
