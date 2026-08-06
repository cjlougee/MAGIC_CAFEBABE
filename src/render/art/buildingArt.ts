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
  rightFace,
  RIGHT_FACE_SHADE,
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
};

const BEDROLL = 0x6f5a48;

function drawBedroll(g: Graphics): void {
  const cx = HALF_TILE_W;
  const cy = HALF_TILE_H;

  diamond(g, cx, cy, HALF_TILE_W - 6, HALF_TILE_H - 3).fill({ color: BEDROLL });
  diamond(g, cx, cy, HALF_TILE_W - 8, HALF_TILE_H - 4).fill({ color: shade(BEDROLL, 0.12) });
  // A pillow at the head end, so the bedroll has an orientation and doesn't read as a rug.
  diamond(g, cx - 8, cy - 4, 6, 3).fill({ color: shade(Palette.text, -0.25) });
}

function drawRaised(g: Graphics, base: number, height: number, cap: number): void {
  // Sides first: the top face must overdraw their upper edge for a clean silhouette.
  leftFace(g, 0, height).fill({ color: shade(base, LEFT_FACE_SHADE) });
  rightFace(g, 0, height).fill({ color: shade(base, RIGHT_FACE_SHADE) });
  topFace(g).fill({ color: base });
  diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 4, HALF_TILE_H - 2).fill({ color: cap });
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
