/**
 * Procedurally drawn colonists.
 *
 * Pawns are drawn front-on rather than in four isometric facings. That is a deliberate
 * first pass: readability of *who* and *what state* matters far more in a colony sim
 * than which way someone is turned, and four facings is four times the art for a
 * detail the player rarely reads. Horizontal mirroring gives left/right for free;
 * proper facings can come with combat, where direction actually carries information.
 *
 * A pawn is built from layers — shadow, legs, torso, head, hair — each taking its
 * colour from an index the simulation rolled. sim/ owns *who* a colonist is; this file
 * owns what that looks like.
 */

import { Graphics } from 'pixi.js';
import type { PawnAppearance } from '../../sim/entities/pawn';
import type { Rotation } from '../../sim/world/footprint';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import { isoCapsule, LIT_SHIFT, SHADED_SHIFT } from './isoShapes';
import { Palette, PawnPalette, shade } from './palette';

/** Sprite box. Roughly a third of a tile wide, so pawns read as people on the grid. */
export const PAWN_W = 26;
export const PAWN_H = 44;

/**
 * Distance from the top of the sprite to the pawn's feet.
 *
 * Positioning uses this rather than the sprite's centre so a pawn's contact point sits
 * exactly on the tile centre — otherwise pawns appear to float above or sink into the
 * ground as their sprite height changes.
 */
export const PAWN_GROUND_Y = 40;

const CENTRE = PAWN_W / 2;



function drawHair(g: Graphics, style: number, colour: number, headY: number): void {
  const dark = shade(colour, -0.25);

  switch (style % 5) {
    case 0: // Cropped cap.
      g.ellipse(CENTRE, headY - 1, 6.5, 5.5).fill({ color: colour });
      g.rect(CENTRE - 6.5, headY - 1, 13, 2).fill({ color: colour });
      break;

    case 1: // Cap with a fringe over one eye.
      g.ellipse(CENTRE, headY - 1, 6.5, 5.5).fill({ color: colour });
      g.rect(CENTRE - 6.5, headY - 1, 8, 4).fill({ color: colour });
      break;

    case 2: // Long, falling past the jaw.
      g.ellipse(CENTRE, headY - 1, 7, 6).fill({ color: colour });
      g.rect(CENTRE - 7, headY - 1, 2.5, 10).fill({ color: dark });
      g.rect(CENTRE + 4.5, headY - 1, 2.5, 10).fill({ color: dark });
      break;

    case 3: // Crest.
      g.rect(CENTRE - 1.5, headY - 8, 3, 7).fill({ color: colour });
      g.ellipse(CENTRE, headY, 6.5, 4).fill({ color: dark });
      break;

    default: // Shaved.
      g.ellipse(CENTRE, headY - 2, 5.5, 3).fill({ color: shade(colour, -0.4) });
      break;
  }
}

export function buildPawnGraphics(appearance: PawnAppearance): Graphics {
  const g = new Graphics();

  const skin = PawnPalette.skin[appearance.skinTone % PawnPalette.skin.length];
  const hair = PawnPalette.hair[appearance.hairColour % PawnPalette.hair.length];
  const apparel = PawnPalette.apparel[appearance.apparelColour % PawnPalette.apparel.length];

  // Shadow, foreshortened to the ground plane like every other flat mark.
  g.ellipse(CENTRE, PAWN_GROUND_Y, 8, 4).fill({ color: Palette.void, alpha: 0.35 });

  // Boots.
  g.rect(CENTRE - 5, PAWN_GROUND_Y - 7, 4, 7).fill({ color: shade(apparel, -0.5) });
  g.rect(CENTRE + 1, PAWN_GROUND_Y - 7, 4, 7).fill({ color: shade(apparel, -0.5) });

  // Torso, tapered by stacking two rounded rects so it reads as a body not a box.
  g.roundRect(CENTRE - 7, PAWN_GROUND_Y - 22, 14, 16, 4).fill({ color: apparel });
  g.roundRect(CENTRE - 7.5, PAWN_GROUND_Y - 22, 15, 5, 3).fill({ color: shade(apparel, 0.14) });
  // Lit edge down the sunward side, shadow down the other. The pawn is not built from
  // isometric faces, but it is lit by the same sun as everything that is — see
  // LEFT_FACE_SHADE / RIGHT_FACE_SHADE in isoShapes. Colonists were previously shaded
  // symmetrically, which is what made them read as flat tokens on a lit map.
  g.roundRect(CENTRE + 4.5, PAWN_GROUND_Y - 21, 2.5, 14, 1.25).fill({
    color: shade(apparel, LIT_SHIFT),
  });
  g.roundRect(CENTRE - 7, PAWN_GROUND_Y - 21, 2, 14, 1).fill({ color: shade(apparel, SHADED_SHIFT) });

  // Arms, lit by side rather than as a matched pair.
  g.roundRect(CENTRE - 9.5, PAWN_GROUND_Y - 20, 3.5, 11, 1.75).fill({
    color: shade(apparel, -0.3),
  });
  g.roundRect(CENTRE + 6, PAWN_GROUND_Y - 20, 3.5, 11, 1.75).fill({
    color: shade(apparel, -0.05),
  });

  // Head.
  const headY = PAWN_GROUND_Y - 29;
  g.roundRect(CENTRE - 2, PAWN_GROUND_Y - 25, 4, 4, 1.5).fill({ color: shade(skin, -0.15) });
  g.ellipse(CENTRE, headY, 5.5, 6).fill({ color: skin });
  // A crescent, not a full pass: drawn slightly up-and-right and then cut back by the
  // skin tone, so the highlight survives only along the sunward rim.
  g.ellipse(CENTRE + 1, headY - 1, 5, 5.4).fill({ color: shade(skin, LIT_SHIFT) });
  g.ellipse(CENTRE - 0.5, headY - 0.4, 4.8, 5.2).fill({ color: skin });

  drawHair(g, appearance.hairStyle, hair, headY);

  // Eyes last, so hair never covers them — a pawn you can't read the face of reads as
  // a prop rather than a person.
  g.rect(CENTRE - 2.5, headY, 1.5, 2).fill({ color: Palette.ink });
  g.rect(CENTRE + 1, headY, 1.5, 2).fill({ color: Palette.ink });

  return g;
}

/** Cache key covering every field that changes how a pawn is drawn. */
export function appearanceKey(appearance: PawnAppearance): string {
  return `pawn:${appearance.skinTone}:${appearance.hairStyle}:${appearance.hairColour}:${appearance.apparelColour}`;
}

// ── Asleep ──────────────────────────────────────────────────────────────────────
//
// A standing sprite laid on a bed was the single most-reported wrong thing on screen:
// colonists stood bolt upright on their bedrolls all night. The fix is render-only —
// `asleep` has been on the pawn and in the save since M3.

/** Frame for the sleeping sprite. A tile wide, because a person lying down is about that. */
export const PAWN_ASLEEP_W = TILE_W;
export const PAWN_ASLEEP_H = TILE_H + 12;

/** Where the ground plane sits inside that frame, so the body lies *on* the bed. */
export const PAWN_ASLEEP_GROUND_Y = PAWN_ASLEEP_H - HALF_TILE_H;

/**
 * A colonist asleep, lying along one of the two isometric axes.
 *
 * Deliberately **not** the standing pose rotated. Rotating pixel art sampled
 * nearest-neighbour shreds it, and a rotated front-on figure reads as a person who has
 * fallen over rather than one who is asleep. It is also not a full anatomical lying pose:
 * most of a sleeping person is under a blanket, so the sprite is a blanket capsule with a
 * head at one end — which is both simpler and a *better* read, because the blanket is the
 * thing that says "asleep" rather than "unconscious".
 *
 * `rotation` is the bed's, so the body lies along the bed rather than across it, and the
 * head lands on the same end as the pillow. Sleeping rough passes 0 and lies down anyway.
 */
export function buildSleepingPawnGraphics(
  appearance: PawnAppearance,
  rotation: Rotation,
): Graphics {
  const g = new Graphics();

  const skin = PawnPalette.skin[appearance.skinTone % PawnPalette.skin.length];
  const hair = PawnPalette.hair[appearance.hairColour % PawnPalette.hair.length];
  const apparel = PawnPalette.apparel[appearance.apparelColour % PawnPalette.apparel.length];

  const cx = PAWN_ASLEEP_W / 2;
  const cy = PAWN_ASLEEP_GROUND_Y - 3;

  /*
   * A person is roughly a tile long, and the capsule already adds its own half-extents at
   * both ends — so the two body points sit *close together*, not a tile apart.
   *
   * The first pass had them 0.62 of a tile each way on top of a 9px capsule, which came
   * out six times longer than it was wide. On the sprite sheet it read as a plank with a
   * head stuck on one end, and at play zoom it would have read as nothing at all. The
   * correction overshot the other way and covered barely half the bedroll — a person on a
   * bed takes up most of it — so the body is long *and* thick rather than either alone.
   */
  const HALF_SPAN = 0.4;
  const along =
    rotation % 2 === 0
      ? { x: HALF_TILE_W * HALF_SPAN, y: HALF_TILE_H * HALF_SPAN }
      : { x: -HALF_TILE_W * HALF_SPAN, y: HALF_TILE_H * HALF_SPAN };
  // Rotations 0 and 1 put the head at the near end of the footprint, 2 and 3 at the far
  // end — the same rule the pillow follows, so the two cannot disagree.
  const sign = rotation < 2 ? -1 : 1;
  const head = { x: cx + along.x * sign, y: cy + along.y * sign };
  const feet = { x: cx - along.x * sign, y: cy - along.y * sign };

  // The blanket, one mass with the sun on it rather than modelled limbs. Keeps the
  // colonist's own apparel hue, muted — it is how you tell who is in which bed, and a
  // blanket at full apparel saturation reads as a stick of confectionery.
  const blanket = shade(apparel, -0.18);
  isoCapsule(g, head, feet, 15, 8).fill({ color: shade(blanket, SHADED_SHIFT) });
  isoCapsule(g, head, feet, 13.5, 7).fill({ color: blanket });
  isoCapsule(
    g,
    { x: head.x + 2, y: head.y - 1.2 },
    { x: feet.x + 2, y: feet.y - 1.2 },
    10,
    5,
  ).fill({ color: shade(blanket, LIT_SHIFT) });

  /*
   * Head resting *on* the blanket's end, overlapping it.
   *
   * The capsule's end is a *diagonal* edge between its west and north vertices, not a
   * point on the centre line — so an offset measured along the body overshoots that edge
   * long before it reaches the silhouette's tip, and the head floats free at the corner.
   * Twice now. A third of the body length, barely lifted, puts it on the bedding with the
   * shoulders under it.
   */
  const hx = head.x + (head.x - feet.x) * 0.32;
  const hy = head.y + (head.y - feet.y) * 0.32 - 1;
  g.ellipse(hx, hy, 5.2, 4.4).fill({ color: shade(hair, -0.2) });
  g.ellipse(hx + 0.6, hy + 0.9, 4.2, 3.5).fill({ color: skin });
  g.ellipse(hx + 1.1, hy + 0.3, 3.8, 3.1).fill({ color: shade(skin, LIT_SHIFT) });
  g.ellipse(hx + 0.2, hy + 0.9, 3.6, 3).fill({ color: skin });

  // Eyes closed — two short strokes, not two dots. This is the entire difference between
  // "asleep" and "lying down staring at the ceiling".
  g.rect(hx - 1.6, hy + 0.9, 1.5, 0.9).fill({ color: shade(skin, -0.55) });
  g.rect(hx + 1.2, hy + 0.9, 1.5, 0.9).fill({ color: shade(skin, -0.55) });

  return g;
}

/** Cache key for the sleeping sprite. Rotation is part of it — four poses, not one. */
export function sleepingKey(appearance: PawnAppearance, rotation: Rotation): string {
  return `${appearanceKey(appearance)}:asleep:${rotation}`;
}
