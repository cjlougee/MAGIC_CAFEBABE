/**
 * Placed structures.
 *
 * Bedrolls lie flat on the ground plane; walls and doors rise from it using the same
 * face geometry as raised terrain, so a stone wall butts against a rock face without a
 * seam or a lighting mismatch.
 */

import { Graphics } from 'pixi.js';
import { Building, type BuildingId } from '../../sim/defs/buildings';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import {
  diamond,
  leftFace,
  LEFT_FACE_SHADE,
  LIT_SHIFT,
  rightFace,
  RIGHT_FACE_SHADE,
  SHADED_SHIFT,
  sunwardBand,
  topFace,
} from './isoShapes';
import { Palette, shade } from './palette';

export const BUILDING_W = TILE_W;
export const BUILDING_H = TILE_H;

/** How far each structure rises off the ground, in world pixels. */
export const BUILDING_HEIGHT: Record<BuildingId, number> = {
  [Building.Bedroll]: 0,
  [Building.Wall]: 22,
  // Shorter than a wall so a doorway reads as a gap in the run, not another wall.
  [Building.Door]: 16,
  // Tall enough for a flame to read as a flame, short enough not to occlude the
  // colonists standing around it — which is exactly what you want to watch.
  [Building.Campfire]: 14,
};

/**
 * The colour each emitter casts, for the lighting layer to tint its glow with.
 *
 * Here rather than in `sim/defs/buildings.ts` because it is a *colour*: how far a fire
 * lights is content, what colour it burns is art direction. Anything absent simply never
 * lights, which `lightRadius` already decides.
 */
export const BUILDING_LIGHT: Partial<Record<BuildingId, number>> = {
  [Building.Campfire]: Palette.firelight,
};

const BEDROLL = 0x6f5a48;

function drawBedroll(g: Graphics): void {
  const cx = HALF_TILE_W;
  const cy = HALF_TILE_H;

  diamond(g, cx, cy, HALF_TILE_W - 6, HALF_TILE_H - 3).fill({
    color: shade(BEDROLL, SHADED_SHIFT * 0.5),
  });
  diamond(g, cx, cy, HALF_TILE_W - 8, HALF_TILE_H - 4).fill({ color: shade(BEDROLL, 0.12) });
  // A bedroll is discrete rather than tiled, so it can take the highlight on its own
  // edge — nothing abuts it to draw a line against.
  sunwardBand(g, cx, cy, HALF_TILE_W - 6, HALF_TILE_H - 3, 0.22).fill({
    color: shade(BEDROLL, LIT_SHIFT),
  });
  // A pillow at the head end, so the bedroll has an orientation and doesn't read as a rug.
  diamond(g, cx - 8, cy - 4, 6, 3).fill({ color: shade(Palette.text, -0.25) });
  diamond(g, cx - 8, cy - 5, 5, 2.2).fill({ color: shade(Palette.text, -0.1) });
}

function drawRaised(g: Graphics, base: number, height: number, cap: number): void {
  // Sides first: the top face must overdraw their upper edge for a clean silhouette.
  leftFace(g, 0, height).fill({ color: shade(base, LEFT_FACE_SHADE) });
  rightFace(g, 0, height).fill({ color: shade(base, RIGHT_FACE_SHADE) });
  topFace(g).fill({ color: base });

  const capW = HALF_TILE_W - 4;
  const capH = HALF_TILE_H - 2;
  diamond(g, HALF_TILE_W, HALF_TILE_H, capW, capH).fill({ color: cap });
  // Drawn on the *cap*, which is already inset, so a run of walls never gets a lit line
  // down the joins between segments. See sunwardBand.
  sunwardBand(g, HALF_TILE_W, HALF_TILE_H, capW, capH, 0.26).fill({
    color: shade(cap, LIT_SHIFT),
  });
}

function drawWall(g: Graphics): void {
  const base = Palette.wall;
  drawRaised(g, base, BUILDING_HEIGHT[Building.Wall], shade(base, 0.1));

  // Coursing on the faces, so a long run reads as masonry rather than a solid slab.
  for (let i = 1; i <= 2; i++) {
    const y = Math.round((BUILDING_HEIGHT[Building.Wall] * i) / 3);
    leftFace(g, y, 1).fill({ color: shade(base, LEFT_FACE_SHADE - 0.1) });
    rightFace(g, y, 1).fill({ color: shade(base, RIGHT_FACE_SHADE - 0.1) });
  }
}

function drawDoor(g: Graphics): void {
  const height = BUILDING_HEIGHT[Building.Door];
  const base = 0x5d5148;
  drawRaised(g, base, height, shade(base, 0.14));

  // A relic-lit strip: doors are built from scrap, and this is where that shows.
  const y = Math.round(height * 0.4);
  leftFace(g, y, 3).fill({ color: shade(Palette.relic, -0.35) });
  rightFace(g, y, 3).fill({ color: shade(Palette.relic, -0.12) });
}

/** One tongue of flame: a leaning spike, widest at its base. */
function flame(g: Graphics, x: number, base: number, halfW: number, tall: number, lean: number, colour: number): void {
  g.poly([
    x - halfW, base,
    x + halfW, base,
    x + halfW * 0.4 + lean * 0.5, base - tall * 0.55,
    x + lean, base - tall,
    x - halfW * 0.5 + lean * 0.5, base - tall * 0.5,
  ]).fill({ color: colour });
}

/**
 * A ring of stones with a fire in it.
 *
 * Drawn back-to-front — far stones, pit, logs, flame, near stones — so the near stones
 * overlap the flame and it sits *inside* the ring rather than on top of it. The ring
 * fills most of the tile, because a campfire that reads as a small dot in a large square
 * looks like a bug rather than a hearth.
 *
 * Everything is measured from the ground plane, which for a raised building sits `height`
 * pixels below the texture's top face. Getting that wrong is what put the first version
 * in the corner of its tile.
 */
function drawCampfire(g: Graphics): void {
  const height = BUILDING_HEIGHT[Building.Campfire];
  const cx = HALF_TILE_W;
  const cy = HALF_TILE_H + height;

  const ringW = HALF_TILE_W - 5;
  const ringH = HALF_TILE_H - 3;
  const stone = Palette.gravel;

  const stones: { x: number; y: number; front: boolean }[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.3;
    stones.push({
      x: cx + Math.cos(angle) * ringW,
      y: cy + Math.sin(angle) * ringH,
      front: Math.sin(angle) > 0,
    });
  }

  for (const s of stones) {
    if (s.front) continue;
    diamond(g, s.x, s.y - 2, 5, 2.6).fill({ color: shade(stone, -0.22) });
  }

  // Ash bed, then embers glowing through it.
  diamond(g, cx, cy, ringW - 4, ringH - 2).fill({ color: shade(Palette.void, 0.3) });
  diamond(g, cx, cy, ringW - 9, ringH - 5).fill({ color: shade(Palette.hazard, -0.55) });

  // Two crossed logs. Nothing says "campfire" faster than a pair of sticks.
  const log = shade(Palette.dirt, -0.15);
  g.poly([cx - 15, cy + 1, cx + 12, cy - 6, cx + 14, cy - 3, cx - 13, cy + 4]).fill({ color: log });
  g.poly([cx - 12, cy - 6, cx + 15, cy + 1, cx + 13, cy + 4, cx - 14, cy - 3]).fill({
    color: shade(log, 0.12),
  });

  // Three tongues, hottest and brightest at the core, leaning slightly apart so the
  // silhouette isn't a symmetrical cone.
  flame(g, cx - 5, cy - 3, 5, height * 0.75, -2, shade(Palette.hazard, -0.2));
  flame(g, cx + 5, cy - 3, 5, height * 0.85, 2, shade(Palette.hazard, -0.1));
  flame(g, cx, cy - 2, 7, height * 1.25, 0, Palette.hazard);
  flame(g, cx, cy - 2, 4, height * 0.95, 0, shade(Palette.gold, 0.05));
  flame(g, cx, cy - 1, 2, height * 0.6, 0, shade(Palette.gold, 0.45));

  for (const s of stones) {
    if (!s.front) continue;
    diamond(g, s.x, s.y - 2, 5, 2.6).fill({ color: stone });
    diamond(g, s.x, s.y - 3.5, 4, 2).fill({ color: shade(stone, 0.14) });
  }
}

export function buildBuildingGraphics(def: BuildingId): Graphics {
  const g = new Graphics();
  switch (def) {
    case Building.Bedroll:
      drawBedroll(g);
      break;
    case Building.Wall:
      drawWall(g);
      break;
    case Building.Door:
      drawDoor(g);
      break;
    case Building.Campfire:
      drawCampfire(g);
      break;
  }
  return g;
}

/**
 * A blueprint, or a part-built frame.
 *
 * Drawn as an outline that fills in as work progresses, so the player can read how far
 * along a site is without selecting it.
 */
export function buildSiteGraphics(stage: number): Graphics {
  const g = new Graphics();
  const filled = stage / (SITE_STAGES - 1);

  diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 3, HALF_TILE_H - 1.5).fill({
    color: Palette.energy,
    alpha: 0.1 + filled * 0.28,
  });
  diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 3, HALF_TILE_H - 1.5).stroke({
    width: 1,
    color: Palette.energy,
    alpha: 0.75,
  });

  // A small riser once materials are in, so "waiting for stone" and "being built" look
  // different at a glance.
  if (filled > 0.5) {
    const height = Math.round(6 * filled);
    leftFace(g, 0, height).fill({ color: Palette.energy, alpha: 0.22 });
    rightFace(g, 0, height).fill({ color: Palette.energy, alpha: 0.32 });
  }

  return g;
}

export const SITE_STAGES = 4;

export function siteStageFor(progress: number): number {
  return Math.min(SITE_STAGES - 1, Math.floor(progress * SITE_STAGES));
}
