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

import { GROUND_LEVEL } from '../sim/core/position';
import { HALF_TILE_H, HALF_TILE_W, LEVEL_HEIGHT } from './constants';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Centre of a tile's ground diamond, in world pixels.
 *
 * Higher levels sit further up the screen. With z at GROUND_LEVEL this is exactly the
 * flat projection, so taking z costs nothing today and saves revisiting every call
 * site when levels land.
 */
export function tileToWorld(tileX: number, tileY: number, tileZ: number = GROUND_LEVEL): Point {
  return {
    x: (tileX - tileY) * HALF_TILE_W,
    y: (tileX + tileY) * HALF_TILE_H - tileZ * LEVEL_HEIGHT,
  };
}

/**
 * Inverse of tileToWorld, for a *known* level. Returns fractional tile coordinates.
 *
 * Picking needs a level because a single screen point sits over one tile per level —
 * which is exactly the ambiguity a cross-section view resolves by deciding which level
 * the player is currently looking at.
 */
export function worldToTile(
  worldX: number,
  worldY: number,
  tileZ: number = GROUND_LEVEL,
): Point {
  const a = worldX / HALF_TILE_W;
  const b = (worldY + tileZ * LEVEL_HEIGHT) / HALF_TILE_H;
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

export interface FootprintBounds {
  /** Top-left of the sprite frame, in world pixels. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The screen box a `w × h` block of tiles occupies, plus whatever it rises by.
 *
 * A footprint is a rhombus on screen, not a rectangle of tiles, so its bounding box is
 * driven by the diagonals: the leftmost point is the far-`y` corner, the rightmost the
 * far-`x` one, which is why both dimensions come out as `(w + h)` half-tiles rather than
 * `w` or `h` alone.
 *
 * **At `w = h = 1` this reduces exactly to `TILE_W × TILE_H` at the offsets single-tile
 * sprites already used.** That equivalence is the check that the generalisation is right,
 * and it is asserted in `tests/iso.test.ts` — every existing sprite must land where it
 * always did, or the whole map shifts by half a tile and nothing says why.
 */
export function footprintBounds(
  anchorX: number,
  anchorY: number,
  w: number,
  h: number,
  anchorZ: number = GROUND_LEVEL,
  rise: number = 0,
): FootprintBounds {
  // Leftmost tile centre is the one with the largest y; topmost is the anchor itself.
  const left = tileToWorld(anchorX, anchorY + h - 1, anchorZ).x - HALF_TILE_W;
  const top = tileToWorld(anchorX, anchorY, anchorZ).y - HALF_TILE_H - rise;

  return {
    left,
    top,
    width: (w + h) * HALF_TILE_W,
    height: (w + h) * HALF_TILE_H + rise,
  };
}

/**
 * Ground centre of footprint cell `(dx, dy)`, in the sprite frame's own pixels.
 *
 * The inside-out companion to `footprintBounds`: that gives the box a footprint occupies
 * on screen, this gives where each of its cells sits *within* that box. `h` is the
 * **rotated** height of the footprint, which is what decides how far right the frame's
 * leftmost point pushes the anchor.
 *
 * **At `dx = dy = 0, h = 1` this is `(HALF_TILE_W, HALF_TILE_H + rise)`** — exactly where
 * single-tile art has always drawn, which is the check that the generalisation is right.
 *
 * Here rather than in `buildingArt.ts`, where it began, because a second copy of the
 * projection is the one thing ADR 0002 asks the codebase not to have: the art needs it to
 * place a hearth's pit, and the harness needs it to say where the ink is allowed to be. If
 * those two ever disagreed, the test would certify the bug.
 */
export function footprintCellCentre(dx: number, dy: number, h: number, rise = 0): Point {
  return {
    x: (dx - dy + h) * HALF_TILE_W,
    y: (dx + dy + 1) * HALF_TILE_H + rise,
  };
}

/**
 * Painter's-algorithm depth *within a level*. Larger draws later (nearer the viewer).
 *
 * Row-major iteration (y outer, x inner) already produces a valid draw order: the only
 * tiles whose sprites can overlap tile (x, y) are (x+1, y) and (x, y+1), and both come
 * later in that iteration. Tiles sharing a depth are exactly TILE_W apart horizontally,
 * so they abut without overlapping.
 *
 * **Levels sort above this, not within it.** When the map gains levels the loop becomes
 * `for z { for y { for x } }` — everything on level z draws before anything on z+1,
 * because a higher level is unconditionally nearer the viewer. That keeps this function
 * a within-level comparison and avoids inventing a combined key that would depend on
 * map size.
 */
export function tileDepth(tileX: number, tileY: number): number {
  return tileX + tileY;
}
