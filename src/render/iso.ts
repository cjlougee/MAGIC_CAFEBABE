/**
 * The isometric projection, isolated into pure functions.
 *
 * Everything that converts between tile space and screen space goes through here, so
 * there is exactly one definition of the projection and it is unit-testable without a
 * renderer. The simulation never calls any of it — sim/ works in tiles and has no
 * concept of a screen.
 *
 * World pixels are the projected space at zoom 1. The camera scales that; these
 * functions never know about zoom.
 *
 *      (0,0)          Screen layout of tile (x, y):
 *        ╱╲             +x runs down-right, +y runs down-left,
 *      ╱    ╲           so screen depth is (x + y).
 *      ╲    ╱
 *        ╲╱
 */

import { HALF_TILE_H, HALF_TILE_W } from './constants';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Centre of a tile's ground diamond, in world pixels. */
export function tileToWorld(tileX: number, tileY: number): Point {
  return {
    x: (tileX - tileY) * HALF_TILE_W,
    y: (tileX + tileY) * HALF_TILE_H,
  };
}

/** Inverse of tileToWorld. Returns fractional tile coordinates. */
export function worldToTile(worldX: number, worldY: number): Point {
  const a = worldX / HALF_TILE_W;
  const b = worldY / HALF_TILE_H;
  return {
    x: (a + b) / 2,
    y: (b - a) / 2,
  };
}

/**
 * Converts a *direction* in world pixels into a direction in tiles.
 *
 * Separate from worldToTile because the projection is linear: deltas need the same
 * transform without any origin offset. This is what makes dragging and WASD move the
 * view the way the screen suggests rather than along the tile axes, which in an
 * isometric view feel diagonal and wrong.
 */
export function worldDeltaToTile(dx: number, dy: number): Point {
  return worldToTile(dx, dy);
}

/**
 * Painter's-algorithm depth. Larger draws later (nearer the viewer).
 *
 * Row-major iteration (y outer, x inner) already produces a valid draw order: the only
 * tiles whose sprites can overlap tile (x, y) are (x+1, y) and (x, y+1), and both come
 * later in that iteration. Tiles sharing a depth are exactly TILE_W apart horizontally,
 * so they abut without overlapping.
 */
export function tileDepth(tileX: number, tileY: number): number {
  return tileX + tileY;
}
