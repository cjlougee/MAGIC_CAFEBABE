/**
 * Procedurally drawn isometric terrain tiles.
 *
 * Every tile is generated once into a texture and cached. Each terrain has several
 * variants so a field doesn't read as a repeating stamp; which variant a given cell
 * uses is a hash of its coordinates, so it is stable across frames, camera moves, and
 * reloads.
 *
 * Three things carry the look:
 *
 *  - **Solid terrain has height.** Rock and bulkheads draw a top face plus two shaded
 *    side faces. This is the entire reason to be isometric — flat diamonds everywhere
 *    would just be a rotated top-down map, paying the projection's costs for none of
 *    its depth.
 *  - **Ground detail is drawn as diamonds, not squares.** A mark lying flat on the
 *    ground plane is foreshortened the same way the tile is. Squares read as stickers.
 *  - **Broad tonal variation is applied elsewhere.** Variants are picked per cell by
 *    hash, so baking tone into them makes neighbours maximally different and the
 *    ground reads as a checkerboard. TerrainLayer applies it as a low-frequency tint
 *    instead, which varies smoothly across space the way real ground does.
 */

import { Graphics } from 'pixi.js';
import { Rng } from '../../sim/core/rng';
import { Terrain, type TerrainId } from '../../sim/defs/terrain';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import { Palette, shade } from './palette';

/** Small enough not to show tile seams; broad variation is TerrainLayer's tint field. */
const TONE_RANGE = 0.025;

/** Side-face shading. The left face is darker, as though light comes from upper-right. */
const LEFT_FACE_SHADE = -0.3;
const RIGHT_FACE_SHADE = -0.14;

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

/**
 * How far a terrain rises above the ground plane, in world pixels.
 *
 * Deliberately modest. Occlusion is isometric's real cost — anything tall hides what
 * sits behind it — so solid terrain reads as raised without becoming a wall the player
 * has to fight the camera to see past.
 */
const TERRAIN_HEIGHT: Record<TerrainId, number> = {
  [Terrain.DeepWater]: 0,
  [Terrain.ShallowWater]: 0,
  [Terrain.Sand]: 0,
  [Terrain.Dirt]: 0,
  [Terrain.Grass]: 0,
  [Terrain.Gravel]: 0,
  [Terrain.Rock]: 14,
  [Terrain.RuinFloor]: 0,
  [Terrain.RuinWall]: 22,
};

export function terrainHeight(id: TerrainId): number {
  return TERRAIN_HEIGHT[id] ?? 0;
}

// ── Geometry helpers ────────────────────────────────────────────────────────────
// The top face occupies y ∈ [0, TILE_H] of the texture; side faces hang below it, so
// total texture height is TILE_H + height.

function diamond(g: Graphics, cx: number, cy: number, halfW: number, halfH: number): Graphics {
  return g.poly([cx, cy - halfH, cx + halfW, cy, cx, cy + halfH, cx - halfW, cy]);
}

/** Parallelogram down the left side, following the diamond's lower-left edge. */
function leftFace(g: Graphics, top: number, depth: number): Graphics {
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
function rightFace(g: Graphics, top: number, depth: number): Graphics {
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
 * A uniformly distributed point inside the top face.
 *
 * Maps the unit square onto the diamond directly rather than rejection-sampling, so
 * the number of RNG draws per mark is fixed and the art stays reproducible.
 */
function pointOnFace(rng: Rng, inset: number): { x: number; y: number } {
  const a = rng.float();
  const b = rng.float();
  const u = a + b - 1;
  const v = a - b;
  return {
    x: HALF_TILE_W + u * HALF_TILE_W * inset,
    y: HALF_TILE_H + v * HALF_TILE_H * inset,
  };
}

/** Scatters flat marks across the top face, foreshortened to lie on the ground plane. */
function speckle(g: Graphics, rng: Rng, base: number, count: number, size: number, spread: number) {
  for (let i = 0; i < count; i++) {
    const p = pointOnFace(rng, 0.82);
    const w = size * rng.rangeFloat(0.6, 1.4);
    diamond(g, p.x, p.y, w, w / 2).fill({ color: shade(base, rng.rangeFloat(-spread, spread)) });
  }
}

// ── Detail passes ───────────────────────────────────────────────────────────────

function drawTopDetail(g: Graphics, id: TerrainId, base: number, rng: Rng): void {
  switch (id) {
    case Terrain.DeepWater:
      for (let i = 0; i < 4; i++) {
        const p = pointOnFace(rng, 0.6);
        diamond(g, p.x, p.y, rng.rangeFloat(6, 13), 1.5).fill({ color: shade(base, 0.09) });
      }
      break;

    case Terrain.ShallowWater:
      // Ripples run along the tile's own axes, so they read as lying on the surface.
      for (let i = 0; i < 5; i++) {
        const p = pointOnFace(rng, 0.66);
        diamond(g, p.x, p.y, rng.rangeFloat(5, 11), 1.5).fill({ color: shade(base, 0.2) });
      }
      break;

    case Terrain.Sand:
      speckle(g, rng, base, 26, 2, 0.11);
      break;

    case Terrain.Dirt:
      speckle(g, rng, base, 18, 3.5, 0.14);
      break;

    case Terrain.Grass:
      speckle(g, rng, base, 10, 5, 0.1);
      // Blades stand upright, so they stay vertical rather than being foreshortened.
      for (let i = 0; i < 14; i++) {
        const p = pointOnFace(rng, 0.8);
        const h = rng.rangeFloat(2, 5);
        g.rect(p.x, p.y - h, 1, h).fill({ color: shade(base, rng.rangeFloat(0.12, 0.32)) });
      }
      break;

    case Terrain.Gravel:
      for (let i = 0; i < 20; i++) {
        const p = pointOnFace(rng, 0.78);
        const w = rng.rangeFloat(2, 4.5);
        diamond(g, p.x, p.y, w, w / 2).fill({ color: shade(base, rng.rangeFloat(-0.2, 0.2)) });
      }
      break;

    case Terrain.Rock:
      // Facets on the cap suggest fractured stone rather than a smooth plinth.
      for (let i = 0; i < 3; i++) {
        const p = pointOnFace(rng, 0.45);
        const w = rng.rangeFloat(9, 17);
        diamond(g, p.x, p.y, w, w / 2).fill({ color: shade(base, rng.rangeFloat(-0.16, 0.2)) });
      }
      break;

    case Terrain.RuinFloor: {
      // An inset panel outline — the manufactured-surface cue.
      diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 2, HALF_TILE_H - 1).fill({
        color: shade(base, 0.1),
      });
      diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 5, HALF_TILE_H - 2.5).fill({
        color: shade(base, -0.06),
      });
      speckle(g, rng, base, 4, 3, 0.1);

      if (rng.chance(0.45)) {
        const p = pointOnFace(rng, 0.45);
        diamond(g, p.x, p.y, 4, 2).fill({ color: shade(Palette.relic, -0.4) });
      }
      break;
    }

    case Terrain.RuinWall:
      diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 3, HALF_TILE_H - 1.5).fill({
        color: shade(base, 0.16),
      });
      break;
  }
}

/** Detail on the two vertical faces. Only runs for terrain with height. */
function drawSideDetail(g: Graphics, id: TerrainId, base: number, depth: number, rng: Rng): void {
  if (id === Terrain.RuinWall) {
    // The relic strip wraps both faces at a constant height. This is the strongest
    // saturation anywhere in the terrain set, so intact structures pull the eye across
    // the whole map — and on a vertical face it finally reads as a lit panel.
    const y = Math.round(depth * 0.45);
    leftFace(g, y, 3).fill({ color: shade(Palette.relic, -0.28) });
    rightFace(g, y, 3).fill({ color: Palette.relic });
    leftFace(g, y + 3, 1).fill({ color: shade(Palette.relic, -0.65) });
    rightFace(g, y + 3, 1).fill({ color: shade(Palette.relic, -0.55) });
    return;
  }

  if (id === Terrain.Rock) {
    // Vertical striations break up the flat faces so cliffs read as stone.
    for (let i = 0; i < 4; i++) {
      const x = rng.rangeFloat(2, HALF_TILE_W - 3);
      const w = rng.rangeFloat(1.5, 4);
      const skew = (x / HALF_TILE_W) * HALF_TILE_H;
      g.rect(x, HALF_TILE_H + skew, w, depth).fill({
        color: shade(base, LEFT_FACE_SHADE + rng.rangeFloat(-0.06, 0.06)),
      });
      const rx = rng.rangeFloat(HALF_TILE_W + 2, TILE_W - 3);
      const rSkew = ((TILE_W - rx) / HALF_TILE_W) * HALF_TILE_H;
      g.rect(rx, HALF_TILE_H + rSkew, w, depth).fill({
        color: shade(base, RIGHT_FACE_SHADE + rng.rangeFloat(-0.06, 0.06)),
      });
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
  const depth = terrainHeight(id);

  // Sides first: the top face must overdraw their upper edge so the silhouette is clean.
  if (depth > 0) {
    leftFace(g, 0, depth).fill({ color: shade(base, LEFT_FACE_SHADE) });
    rightFace(g, 0, depth).fill({ color: shade(base, RIGHT_FACE_SHADE) });
    drawSideDetail(g, id, base, depth, rng);
  }

  diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W, HALF_TILE_H).fill({ color: base });
  drawTopDetail(g, id, base, rng);

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
