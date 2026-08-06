/**
 * Placed structures.
 *
 * Only bedrolls so far. Drawn flat on the ground plane and foreshortened like every
 * other flat mark, so a bedroll reads as lying on the floor rather than standing on it.
 */

import { Graphics } from 'pixi.js';
import { Building, type BuildingId } from '../../sim/defs/buildings';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import { Palette, shade } from './palette';

export const BUILDING_W = TILE_W;
export const BUILDING_H = TILE_H;

const BEDROLL = 0x6f5a48;

function diamond(g: Graphics, cx: number, cy: number, halfW: number, halfH: number): Graphics {
  return g.poly([cx, cy - halfH, cx + halfW, cy, cx, cy + halfH, cx - halfW, cy]);
}

function drawBedroll(g: Graphics): void {
  const cx = HALF_TILE_W;
  const cy = HALF_TILE_H;

  diamond(g, cx, cy, HALF_TILE_W - 6, HALF_TILE_H - 3).fill({ color: BEDROLL });
  diamond(g, cx, cy, HALF_TILE_W - 8, HALF_TILE_H - 4).fill({ color: shade(BEDROLL, 0.12) });
  // A pillow at the head end, so the bedroll has an orientation and doesn't read as a rug.
  diamond(g, cx - 8, cy - 4, 6, 3).fill({ color: shade(Palette.text, -0.25) });
}

export function buildBuildingGraphics(def: BuildingId): Graphics {
  const g = new Graphics();
  switch (def) {
    case Building.Bedroll:
      drawBedroll(g);
      break;
  }
  return g;
}
