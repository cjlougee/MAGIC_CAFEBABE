/**
 * Procedurally drawn terrain tiles.
 *
 * Every tile is generated once into a texture and cached. Each terrain has several
 * variants so a field doesn't read as a repeating stamp; which variant a given cell
 * uses is a hash of its coordinates, so it is stable across frames, camera moves, and
 * reloads.
 *
 * Two things carry the look:
 *
 *  - **Chunky, low detail.** In a colony sim the player is scanning for state, not
 *    admiring texture. Readable beats intricate.
 *  - **Broad tonal variation, applied elsewhere.** Large areas need light and dark
 *    patches or they read as flat slabs. That is deliberately *not* done here:
 *    variants are picked per cell by hash, so baking tone into them makes neighbours
 *    maximally different and the ground reads as a checkerboard. TerrainLayer applies
 *    it as a low-frequency tint instead, which varies smoothly across space the way
 *    real ground does. The per-variant shift left here is small enough to add life
 *    without showing tile seams.
 */

import { Graphics } from 'pixi.js';
import { Rng } from '../../sim/core/rng';
import { Terrain, type TerrainId } from '../../sim/defs/terrain';
import { TILE_SIZE } from '../constants';
import { Palette, shade } from './palette';

const T = TILE_SIZE;

/**
 * How far a variant may shift its base tone. Kept very small: adjacent cells draw
 * unrelated variants, so anything larger becomes a visible per-tile checkerboard.
 * Broad variation comes from TerrainLayer's tint field.
 */
const TONE_RANGE = 0.025;

const TERRAIN_BASE: Record<TerrainId, number> = {
  [Terrain.DeepWater]: Palette.deepWater,
  [Terrain.ShallowWater]: Palette.shallowWater,
  [Terrain.Sand]: Palette.sand,
  [Terrain.Dirt]: Palette.dirt,
  [Terrain.Grass]: Palette.grass,
  [Terrain.Gravel]: Palette.gravel,
  [Terrain.Rock]: Palette.rock,
  [Terrain.RuinFloor]: Palette.ruinFloor,
  [Terrain.RuinWall]: Palette.ruinWall,
};

/** Scatters `count` small marks of varying tone across the tile. */
function speckle(
  g: Graphics,
  rng: Rng,
  base: number,
  count: number,
  minSize: number,
  maxSize: number,
  spread: number,
): void {
  for (let i = 0; i < count; i++) {
    const size = rng.range(minSize, maxSize + 1);
    const x = rng.int(T - size);
    const y = rng.int(T - size);
    g.rect(x, y, size, size).fill({ color: shade(base, rng.rangeFloat(-spread, spread)) });
  }
}

/** Detail passes, drawn on top of a base fill the caller has already laid down. */
function drawDetail(g: Graphics, id: TerrainId, base: number, rng: Rng): void {
  switch (id) {
    case Terrain.DeepWater: {
      for (let i = 0; i < 3; i++) {
        const w = rng.range(8, T);
        g.rect(rng.int(T - 4), rng.int(T), w, 2).fill({ color: shade(base, 0.08) });
      }
      break;
    }

    case Terrain.ShallowWater: {
      // Horizontal ripples read as water far better than isotropic noise does.
      for (let i = 0; i < 4; i++) {
        const w = rng.range(6, 18);
        g.rect(rng.int(T - w), rng.int(T - 2), w, 2).fill({ color: shade(base, 0.18) });
      }
      break;
    }

    case Terrain.Sand: {
      speckle(g, rng, base, 26, 1, 2, 0.11);
      // A couple of wind ripples to give the dunes direction.
      for (let i = 0; i < 2; i++) {
        const w = rng.range(10, 22);
        g.rect(rng.int(T - w), rng.int(T - 1), w, 1).fill({ color: shade(base, -0.09) });
      }
      break;
    }

    case Terrain.Dirt: {
      speckle(g, rng, base, 16, 2, 4, 0.14);
      break;
    }

    case Terrain.Grass: {
      speckle(g, rng, base, 9, 3, 6, 0.11);
      for (let i = 0; i < 12; i++) {
        const h = rng.range(2, 6);
        g.rect(rng.int(T - 1), rng.int(T - 5), 1, h).fill({
          color: shade(base, rng.rangeFloat(0.12, 0.3)),
        });
      }
      break;
    }

    case Terrain.Gravel: {
      for (let i = 0; i < 18; i++) {
        const size = rng.range(2, 5);
        g.rect(rng.int(T - size), rng.int(T - size), size, size).fill({
          color: shade(base, rng.rangeFloat(-0.2, 0.2)),
        });
      }
      break;
    }

    case Terrain.Rock: {
      // Angular facets suggest fractured stone and give mountains real bulk.
      for (let i = 0; i < 3; i++) {
        const x = rng.int(T - 10);
        const y = rng.int(T - 10);
        const w = rng.range(8, 16);
        const h = rng.range(8, 16);
        g.moveTo(x, y + h)
          .lineTo(x + w * 0.35, y)
          .lineTo(x + w, y + h * 0.5)
          .lineTo(x + w * 0.6, y + h)
          .closePath()
          .fill({ color: shade(base, rng.rangeFloat(-0.18, 0.2)) });
      }
      break;
    }

    case Terrain.RuinFloor: {
      // Panel seams. This is the manufactured-surface cue.
      g.rect(0, 0, T, 1).fill({ color: shade(base, -0.32) });
      g.rect(0, 0, 1, T).fill({ color: shade(base, -0.32) });
      g.rect(0, T - 2, T, 1).fill({ color: shade(base, 0.14) });
      speckle(g, rng, base, 5, 2, 4, 0.1);

      // A dim relic indicator on some plates: the tier you cannot craft, still lit.
      if (rng.chance(0.45)) {
        g.rect(rng.range(6, T - 10), rng.range(6, T - 10), 4, 4).fill({
          color: shade(Palette.relic, -0.45),
        });
      }
      break;
    }

    case Terrain.RuinWall: {
      g.rect(1, 1, T - 2, T - 2).fill({ color: shade(base, 0.11) });
      g.rect(2, 2, T - 4, 3).fill({ color: shade(base, 0.24) });

      // The brightest saturation anywhere in the terrain set, so intact structures
      // pull the eye across the whole map.
      const stripY = rng.range(10, T - 12);
      g.rect(3, stripY, T - 6, 2).fill({ color: Palette.relic });
      g.rect(3, stripY + 2, T - 6, 1).fill({ color: shade(Palette.relic, -0.55) });

      for (const [rx, ry] of [
        [4, 4],
        [T - 7, 4],
        [4, T - 7],
        [T - 7, T - 7],
      ]) {
        g.rect(rx, ry, 2, 2).fill({ color: shade(base, -0.36) });
      }
      break;
    }
  }
}

/**
 * Builds the Graphics for one terrain variant. Seeded per (terrain, variant) so the
 * same variant always draws identically — a texture regenerated after a context loss
 * must match the one it replaces.
 */
export function buildTerrainGraphics(id: TerrainId, variant: number): Graphics {
  const g = new Graphics();
  const rng = new Rng((id + 1) * 7919 + variant * 104729);

  const base = shade(TERRAIN_BASE[id] ?? Palette.danger, rng.rangeFloat(-TONE_RANGE, TONE_RANGE));
  g.rect(0, 0, T, T).fill({ color: base });
  drawDetail(g, id, base, rng);

  return g;
}

/**
 * Which variant a given cell uses. Pure function of position and world seed, so it
 * survives reloads and stays consistent between neighbouring chunks.
 */
export function variantForCell(x: number, y: number, seed: number, variants: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2f) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = h ^ (h >>> 13);
  return (h >>> 0) % variants;
}
