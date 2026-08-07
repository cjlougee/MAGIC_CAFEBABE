/**
 * Berry bushes.
 *
 * Drawn in three stages rather than continuously scaled, so ripeness is readable as a
 * *state* from across the map instead of a size the player has to judge. A colonist
 * should be able to see at a glance which bushes are worth walking to.
 */

import { Graphics } from 'pixi.js';
import { Rng } from '../../sim/core/rng';
import { LIT_SHIFT, SHADED_SHIFT } from './isoShapes';
import { Palette, shade } from './palette';

export const PLANT_W = 30;
export const PLANT_H = 30;
/** Distance from the top of the sprite to where the plant meets the ground. */
export const PLANT_GROUND_Y = 25;

const CENTRE = PLANT_W / 2;

/** Bare, growing, ripe. */
export const PLANT_STAGES = 3;

const LEAF = 0x4a6b3c;
const BERRY = 0xa8425c;

export function buildPlantGraphics(stage: number): Graphics {
  const g = new Graphics();
  const rng = new Rng(9001 + stage * 131);

  g.ellipse(CENTRE, PLANT_GROUND_Y, 6, 2.5).fill({ color: Palette.void, alpha: 0.25 });

  // Sized to read against the grass texture it sits on. Smaller looked correct in
  // isolation and vanished completely at normal zoom, which is the only zoom that
  // matters — a food source the player can't spot isn't a food source.
  const size = 0.85 + stage * 0.3;
  const clumps = 4 + stage;

  for (let i = 0; i < clumps; i++) {
    const x = CENTRE + rng.rangeFloat(-5, 5);
    const y = PLANT_GROUND_Y - 4 - rng.rangeFloat(0, 7) * size;
    const w = 4.4 * size;
    const h = 3.4 * size;
    const tone = shade(LEAF, rng.rangeFloat(-0.12, 0.12));

    g.ellipse(x, y, w, h).fill({ color: shade(tone, SHADED_SHIFT * 0.6) });
    // A crescent, not a second full clump: the lit ellipse is nudged up and right and
    // then cut back by the base tone, leaving light only along the sunward rim. The
    // same trick the pawn's head uses, because a bush and a face are the same problem —
    // a rounded mass that needs a direction.
    g.ellipse(x + w * 0.16, y - h * 0.22, w * 0.92, h * 0.92).fill({
      color: shade(tone, LIT_SHIFT),
    });
    g.ellipse(x - w * 0.1, y + h * 0.12, w * 0.84, h * 0.84).fill({ color: tone });
  }

  // Only a ripe bush shows fruit, which is the whole point of the staging.
  if (stage >= PLANT_STAGES - 1) {
    for (let i = 0; i < 7; i++) {
      const x = CENTRE + rng.rangeFloat(-5.5, 5.5);
      const y = PLANT_GROUND_Y - 5 - rng.rangeFloat(0, 8);
      const tone = shade(BERRY, rng.rangeFloat(-0.08, 0.16));
      g.circle(x, y, 1.9).fill({ color: shade(tone, SHADED_SHIFT * 0.5) });
      // A single specular pip. Berries are the one thing here small enough that a
      // crescent would be mush, so the highlight is a dot in the sunward corner.
      g.circle(x + 0.5, y - 0.5, 1).fill({ color: shade(tone, LIT_SHIFT * 1.4) });
    }
  }

  return g;
}

/** Which stage texture a ripeness value maps to. */
export function stageFor(ripeness: number): number {
  if (ripeness >= 1) return PLANT_STAGES - 1;
  return ripeness < 0.5 ? 0 : 1;
}
