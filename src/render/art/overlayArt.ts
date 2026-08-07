/**
 * Overlay markers — the player's intentions, drawn on the ground.
 *
 * These are the only sprites that are deliberately *not* part of the world's fiction.
 * They read as UI painted onto the map, so they use flat saturated colour and hard
 * geometry rather than the textured, shaded language of terrain.
 */

import { Graphics } from 'pixi.js';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import { Palette } from './palette';

function diamondPath(g: Graphics, inset: number): Graphics {
  const w = HALF_TILE_W - inset;
  const h = HALF_TILE_H - inset / 2;
  return g.poly([
    HALF_TILE_W,
    HALF_TILE_H - h,
    HALF_TILE_W + w,
    HALF_TILE_H,
    HALF_TILE_W,
    HALF_TILE_H + h,
    HALF_TILE_W - w,
    HALF_TILE_H,
  ]);
}

/** Translucent fill marking a stockpile cell. */
export function buildStockpileGraphics(): Graphics {
  const g = new Graphics();
  diamondPath(g, 1).fill({ color: Palette.gold, alpha: 0.16 });
  diamondPath(g, 1).stroke({ width: 1, color: Palette.gold, alpha: 0.5 });
  return g;
}

/** Corner brackets marking a cell designated for mining. */
export function buildMineMarkerGraphics(): Graphics {
  const g = new Graphics();
  const colour = Palette.hazard;

  diamondPath(g, 3).stroke({ width: 2, color: colour, alpha: 0.9 });

  // A cross through the middle, so the mark survives being drawn over dark rock.
  g.moveTo(HALF_TILE_W - 7, HALF_TILE_H - 3.5)
    .lineTo(HALF_TILE_W + 7, HALF_TILE_H + 3.5)
    .stroke({ width: 2, color: colour });
  g.moveTo(HALF_TILE_W + 7, HALF_TILE_H - 3.5)
    .lineTo(HALF_TILE_W - 7, HALF_TILE_H + 3.5)
    .stroke({ width: 2, color: colour });

  return g;
}

/**
 * A bar struck through a cell marked for demolition.
 *
 * Deliberately not the mine marker's diagonal cross: both mean "colonists, remove this",
 * and the player needs to tell at a glance which of their walls is coming down and which
 * rock is being cut. Different glyph, different colour — red for undoing your own work,
 * orange for cutting the landscape.
 */
export function buildDeconstructMarkerGraphics(): Graphics {
  const g = new Graphics();
  const colour = Palette.danger;

  diamondPath(g, 3).stroke({ width: 2, color: colour, alpha: 0.9 });

  g.moveTo(HALF_TILE_W - 9, HALF_TILE_H)
    .lineTo(HALF_TILE_W + 9, HALF_TILE_H)
    .stroke({ width: 3, color: colour });

  return g;
}

/** Outline shown under the cursor while dragging out an area. */
export function buildPreviewGraphics(): Graphics {
  const g = new Graphics();
  diamondPath(g, 2).fill({ color: Palette.text, alpha: 0.12 });
  diamondPath(g, 2).stroke({ width: 1, color: Palette.text, alpha: 0.65 });
  return g;
}

/** Texture footprint, so callers can position these like any other tile sprite. */
export const OVERLAY_W = TILE_W;
export const OVERLAY_H = TILE_H;
