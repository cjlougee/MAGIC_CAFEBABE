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
import { HALF_TILE_H, HALF_TILE_W, TILE_W } from '../constants';
import {
  diamond,
  leftFace,
  LEFT_FACE_SHADE,
  rightFace,
  RIGHT_FACE_SHADE,
  topFace,
} from './isoShapes';
import { Palette, shade } from './palette';

/** Small enough not to show tile seams; broad variation is TerrainLayer's tint field. */
const TONE_RANGE = 0.025;

/**
 * The one answer to "what colour is this terrain".
 *
 * Exported because the minimap needs the same answer, and a second table would drift —
 * a map whose colours disagree with the world it depicts is worse than no map.
 */
export function terrainColour(id: TerrainId): number {
  return TERRAIN_BASE[id];
}

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
  [Terrain.StoneFloor]: Palette.stoneFloor,
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
  [Terrain.StoneFloor]: 0,
};

export function terrainHeight(id: TerrainId): number {
  return TERRAIN_HEIGHT[id] ?? 0;
}

// Geometry comes from isoShapes.ts, shared with buildings so a stone wall butts
// against a rock face without a seam or a lighting mismatch.

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

/**
 * Scatters flat marks across the top face, foreshortened to lie on the ground plane.
 *
 * **Marks must not escape the diamond.** The texture is cropped to the Graphics' bounds,
 * and anything painted in a bounding-box corner lands outside the tile it belongs to and
 * over the neighbour drawn there. Both this and `mottle` stay inside by construction:
 * measured in the diamond's own metric — x over `HALF_TILE_W` plus y over `HALF_TILE_H` —
 * a mark of half-width `w` placed at inset `i` reaches `i + w / HALF_TILE_W`, so keeping
 * that under 1 is the whole rule.
 */
function speckle(g: Graphics, rng: Rng, base: number, count: number, size: number, spread: number) {
  for (let i = 0; i < count; i++) {
    const p = pointOnFace(rng, 0.82);
    const w = size * rng.rangeFloat(0.6, 1.4);
    diamond(g, p.x, p.y, w, w / 2).fill({ color: shade(base, rng.rangeFloat(-spread, spread)) });
  }
}

/**
 * Broad, low-contrast patches. What stops a field of tiles reading as one flat colour.
 *
 * Speckle alone cannot do this: at any sensible zoom a 2px mark is below the resolution
 * the eye integrates over, so a hundred of them average back to exactly the base colour
 * and a sand plain looks like poured plastic. Variation has to exist at a scale you can
 * actually see — a third of a tile — and it has to be *weak*, or the ground turns into
 * camouflage. Fine speckle then goes on top for the texture you see close up.
 */
function mottle(g: Graphics, rng: Rng, base: number, count: number, size: number, spread: number) {
  for (let i = 0; i < count; i++) {
    const p = pointOnFace(rng, 0.5);
    const w = size * rng.rangeFloat(0.7, 1.25);
    diamond(g, p.x, p.y, w, w / 2).fill({ color: shade(base, rng.rangeFloat(-spread, spread)) });
  }
}

/**
 * Grass, as a few clumps rather than a field of loose strands.
 *
 * Fourteen single-pixel blades scattered evenly across a tile is the right *amount* of
 * detail and the wrong *distribution*. Zoomed out each blade collapses to one stray
 * pixel with nothing near it, and a screen of them reads as static or falling rain —
 * noise, not vegetation. Clumping the same marks into three tufts gives the eye
 * something the size of an object to latch onto, and the gaps between tufts do as much
 * work as the tufts themselves.
 *
 * Blades are the only marks in the terrain set that stand *up* rather than lying flat,
 * so they are also the only ones that can escape the top of the tile. Their base inset
 * is kept low enough that even the tallest cannot reach y = 0.
 */
function drawTufts(g: Graphics, rng: Rng, base: number): void {
  const TUFTS = 4;
  const PER_TUFT = 5;

  for (let t = 0; t < TUFTS; t++) {
    // 0.62 rather than 0.82: a tuft is wider than a blade, and this keeps the whole
    // clump clear of the tile edge where a neighbour's grass begins.
    const origin = pointOnFace(rng, 0.62);

    for (let i = 0; i < PER_TUFT; i++) {
      const dx = rng.rangeFloat(-3, 3);
      // Blades further from the clump's centre are shorter, so a tuft has a silhouette
      // instead of being a bundle of equal sticks.
      const falloff = 1 - Math.abs(dx) / 5;
      const h = rng.rangeFloat(3, 6) * falloff;
      if (h < 1) continue;

      // Toned down from the old +0.12..+0.32: bright strands are what made the noise
      // read as sparkle rather than as grass.
      const tone = shade(base, rng.rangeFloat(0.1, 0.26));
      g.rect(origin.x + dx, origin.y - h, 1, h).fill({ color: tone });
    }
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
      // The flattest terrain in the game and the one that covers the most ground, so it
      // needs the mid-scale variation most.
      mottle(g, rng, base, 5, 12, 0.05);
      speckle(g, rng, base, 26, 2, 0.13);
      break;

    case Terrain.Dirt:
      mottle(g, rng, base, 5, 12, 0.065);
      speckle(g, rng, base, 18, 3.5, 0.16);
      break;

    case Terrain.Grass:
      mottle(g, rng, base, 4, 12, 0.055);
      speckle(g, rng, base, 10, 5, 0.1);
      drawTufts(g, rng, base);
      break;

    case Terrain.Gravel:
      mottle(g, rng, base, 4, 11, 0.06);
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

    case Terrain.StoneFloor:
      // Four cut slabs. Regular where relic plating is panelled and dirt is speckled,
      // so a laid floor reads as deliberate human work at a glance.
      for (const [ox, oy] of [
        [-0.5, 0],
        [0.5, 0],
        [0, -0.5],
        [0, 0.5],
      ]) {
        diamond(
          g,
          HALF_TILE_W + ox * HALF_TILE_W * 0.52,
          HALF_TILE_H + oy * HALF_TILE_H * 0.52,
          HALF_TILE_W * 0.24,
          HALF_TILE_H * 0.24,
        ).fill({ color: shade(base, rng.rangeFloat(-0.07, 0.09)) });
      }
      break;
  }
}

/** Detail on the two vertical faces. Only runs for terrain with height. */
function drawSideDetail(g: Graphics, id: TerrainId, base: number, depth: number, rng: Rng): void {
  if (id === Terrain.RuinWall) {
    // The relic strip wraps both faces at a constant height, and is still the most
    // saturated thing in the terrain set — intact structures should pull the eye across
    // the map. But *dim*: these are weathered panels that have stood in the open for
    // centuries and merely failed to go out. Run at full saturation they read as
    // maintained, and nobody has maintained anything here in a very long time.
    const y = Math.round(depth * 0.45);
    leftFace(g, y, 3).fill({ color: shade(Palette.relic, -0.48) });
    rightFace(g, y, 3).fill({ color: shade(Palette.relic, -0.24) });
    leftFace(g, y + 3, 1).fill({ color: shade(Palette.relic, -0.72) });
    rightFace(g, y + 3, 1).fill({ color: shade(Palette.relic, -0.62) });
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

  topFace(g).fill({ color: base });
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
