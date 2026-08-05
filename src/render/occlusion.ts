/**
 * Working out which raised tiles are hiding a colonist.
 *
 * This is isometric's standing cost. A pawn standing behind a cliff or a bulkhead is
 * correctly drawn *behind* it and therefore invisible — technically right, and useless
 * to the player. Top-down games never have this problem; we bought it along with the
 * depth, so we pay it back by fading whatever is in the way.
 *
 * Kept as pure functions over screen boxes so the rule is testable without a renderer.
 */

import type { TileMap } from '../sim/world/tilemap';
import { terrainHeight } from './art/terrainArt';
import { PAWN_GROUND_Y, PAWN_H, PAWN_W } from './art/pawnArt';
import { HALF_TILE_H, HALF_TILE_W } from './constants';
import { tileToWorld } from './iso';

/**
 * How far to search around a pawn, in tiles.
 *
 * Only tiles nearer the viewer can cover a pawn, and a tile's sprite never extends
 * below its own footprint — it only reaches upward by its height. So the search is
 * small and bounded; the box test below rejects the rest exactly.
 */
const SEARCH_RADIUS = 3;

export interface ScreenBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** The box a pawn's sprite occupies, in world pixels. */
export function pawnBox(worldX: number, worldY: number): ScreenBox {
  return {
    x0: worldX - PAWN_W / 2,
    x1: worldX + PAWN_W / 2,
    y0: worldY - PAWN_GROUND_Y,
    y1: worldY - PAWN_GROUND_Y + PAWN_H,
  };
}

/** The box a tile's sprite occupies, including the height it rises by. */
export function tileBox(worldX: number, worldY: number, height: number): ScreenBox {
  return {
    x0: worldX - HALF_TILE_W,
    x1: worldX + HALF_TILE_W,
    y0: worldY - HALF_TILE_H - height,
    y1: worldY + HALF_TILE_H,
  };
}

export interface OccludableSubject {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Fills `out` with the map indices of raised tiles covering any of `subjects`.
 *
 * A tile qualifies only when it is *nearer the viewer* than the subject — greater
 * `x + y` — because a tile behind the pawn is drawn first and cannot cover it. Without
 * that check we would fade the cliff a pawn is standing in front of, which looks like
 * a rendering bug.
 */
export function collectOccluders(
  map: TileMap,
  subjects: Iterable<OccludableSubject>,
  out: Set<number>,
): void {
  out.clear();

  for (const subject of subjects) {
    const world = tileToWorld(subject.x, subject.y, subject.z);
    const box = pawnBox(world.x, world.y);
    const subjectDepth = subject.x + subject.y;

    const baseX = Math.round(subject.x);
    const baseY = Math.round(subject.y);

    for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
      for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
        const tx = baseX + dx;
        const ty = baseY + dy;
        if (tx + ty <= subjectDepth) continue;
        if (!map.inBounds(tx, ty, subject.z)) continue;

        const index = map.idx(tx, ty, subject.z);
        const height = terrainHeight(map.terrainAt(index));
        if (height === 0) continue;

        const tileWorld = tileToWorld(tx, ty, subject.z);
        if (overlaps(box, tileBox(tileWorld.x, tileWorld.y, height))) {
          out.add(index);
        }
      }
    }
  }
}
