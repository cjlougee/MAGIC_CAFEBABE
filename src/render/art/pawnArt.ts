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

  // Arms.
  g.roundRect(CENTRE - 9.5, PAWN_GROUND_Y - 20, 3.5, 11, 1.75).fill({
    color: shade(apparel, -0.18),
  });
  g.roundRect(CENTRE + 6, PAWN_GROUND_Y - 20, 3.5, 11, 1.75).fill({
    color: shade(apparel, -0.18),
  });

  // Head.
  const headY = PAWN_GROUND_Y - 29;
  g.roundRect(CENTRE - 2, PAWN_GROUND_Y - 25, 4, 4, 1.5).fill({ color: shade(skin, -0.15) });
  g.ellipse(CENTRE, headY, 5.5, 6).fill({ color: skin });

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
