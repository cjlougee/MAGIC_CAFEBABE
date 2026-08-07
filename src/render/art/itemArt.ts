/**
 * Item piles.
 *
 * Drawn as a few chunks clustered on the ground rather than a single blob, so a stack
 * reads as *stuff* at a glance and stays legible when several sit side by side. Counts
 * live in the HUD; trying to render numbers on a tile would fight the pixel art and
 * lose.
 */

import { Graphics } from 'pixi.js';
import { Rng } from '../../sim/core/rng';
import { ItemDef, type ItemDefId } from '../../sim/defs/items';
import { Palette, shade } from './palette';

export const ITEM_W = 26;
export const ITEM_H = 20;

/** Distance from the top of the sprite to where the pile rests on the ground. */
export const ITEM_GROUND_Y = 15;

const CENTRE = ITEM_W / 2;

const ITEM_BASE: Record<ItemDefId, number> = {
  [ItemDef.Stone]: 0x8c8781,
  [ItemDef.Scrap]: 0x6d7b82,
  [ItemDef.RawFood]: 0x8e5f6b,
  // Warmer and lighter than the raw berries it came from, so a full larder reads as
  // cooked at a glance rather than as more of the same.
  [ItemDef.Meal]: 0xc79a5c,
};

function chunk(g: Graphics, x: number, y: number, size: number, colour: number): void {
  // Foreshortened like everything else lying flat on the ground plane.
  g.poly([x, y - size / 2, x + size, y, x, y + size / 2, x - size, y]).fill({ color: colour });
}

export function buildItemGraphics(def: ItemDefId): Graphics {
  const g = new Graphics();
  const rng = new Rng((def + 1) * 60013);
  const base = ITEM_BASE[def] ?? Palette.danger;

  g.ellipse(CENTRE, ITEM_GROUND_Y + 1, 9, 4).fill({ color: Palette.void, alpha: 0.3 });

  for (let i = 0; i < 5; i++) {
    const x = CENTRE + rng.rangeFloat(-6, 6);
    const y = ITEM_GROUND_Y - rng.rangeFloat(0, 6);
    chunk(g, x, y, rng.rangeFloat(2.5, 4.5), shade(base, rng.rangeFloat(-0.2, 0.2)));
  }

  // Scrap carries a dim relic glint — the first hint of the tier you can't craft.
  if (def === ItemDef.Scrap) {
    chunk(g, CENTRE + 1, ITEM_GROUND_Y - 4, 2, shade(Palette.relic, -0.3));
  }

  // Berries read as rounder and brighter than mineral piles, so food is findable at a
  // glance in a stockpile full of grey.
  if (def === ItemDef.RawFood) {
    for (let i = 0; i < 3; i++) {
      const x = CENTRE + rng.rangeFloat(-4, 4);
      const y = ITEM_GROUND_Y - rng.rangeFloat(1, 5);
      g.circle(x, y, rng.rangeFloat(1.4, 2.2)).fill({ color: shade(base, 0.28) });
    }
  }

  // A meal is a stacked, squared-off portion rather than a scatter — prepared food
  // should not read as another heap of loose material.
  if (def === ItemDef.Meal) {
    chunk(g, CENTRE, ITEM_GROUND_Y - 4, 5, shade(base, 0.18));
    chunk(g, CENTRE, ITEM_GROUND_Y - 7, 3.5, shade(base, 0.34));
  }

  return g;
}
