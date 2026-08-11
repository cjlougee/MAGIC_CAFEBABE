/**
 * Structures described as objects rather than as pictures.
 *
 * The first two conversions, and deliberately the two that share a footprint and an axis:
 * between them a bedroll and a bed exercise rotation, footprint containment, occluded
 * marks and the sleeping pose that lies on top of both. If the model layer is wrong, it is
 * wrong here.
 *
 * Read a model as a sentence about the thing. A bed is *a frame a fifth of a storey up on
 * four posts, with a mattress inset on it and a pillow at the head end.* That is the whole
 * source; where the legs land in screen pixels at rotation 3 is the renderer's problem, not
 * the author's — which is exactly the problem the hand-drawn version had to solve four
 * times and got wrong twice.
 *
 * **Heights are storeys.** `rise / LEVEL_HEIGHT` is the ceiling: a solid above it projects
 * off the top of the frame, which the harness fails on rather than silently cropping.
 */

import { Building } from '../../../sim/defs/buildings';
import { HEIGHT } from '../language';
import type { Solid } from './render';

/**
 * How far the furniture holds back from the edge of the cells it stands on.
 *
 * Structures that *tile* — walls, floors — must fill their cell exactly or a run of them
 * shows a grid of gaps. Furniture is the opposite: it needs visible ground around it or a
 * bed placed against a wall reads as part of the wall. An eighth of a tile is enough to
 * separate without looking like it is floating in the middle of the room.
 */
const MARGIN = 0.12;

/** Posts are square in plan and thin — a leg that reads as a slab is a plinth. */
const LEG = 0.17;

/**
 * A bed: four posts, a slab frame, a mattress, a pillow.
 *
 * The legs are the whole point of the sprite. A bedroll and a bed cover the same two cells
 * and lie at the same angle, so without something that says *made of parts* the upgrade the
 * colony spent scrap and labour on looks like a bedroll drawn slightly paler.
 *
 * Written head-end-first at low `x`, which is where rotation 0 and 1 put the facing cell —
 * see `headCellOf`. The renderer turns the whole model, so the pillow follows the facing
 * without anything here knowing which way round it ended up.
 */
export function bedModel(): Solid[] {
  const top = HEIGHT.bed;
  const frameTop = top * 0.72;
  const frameBottom = frameTop - 0.13;
  const mattressTop = top * 0.9;

  const x0 = MARGIN;
  const x1 = 2 - MARGIN;
  const y0 = MARGIN;
  const y1 = 1 - MARGIN;

  const legs: Solid[] = [
    [x0, y0], [x1 - LEG, y0], [x0, y1 - LEG], [x1 - LEG, y1 - LEG],
  ].map(([lx, ly], i) => ({
    x0: lx, y0: ly, z0: 0,
    x1: lx + LEG, y1: ly + LEG, z1: frameBottom + 0.04,
    material: 'wood' as const,
    label: `bed leg ${i}`,
    // A post runs *into* the frame above it, so its top face is never visible on any of
    // the four legs in any of the four rotations. Said here rather than excused in the
    // contract: the harness named all four leg tops on the first bake, and a declaration
    // covering them would have been covering for the model instead of describing it.
    hideTop: true,
  }));

  return [
    // Legs first, so the frame lands on top of them. The far pair end up entirely behind
    // it, which is correct — you cannot see the far legs of a bed either.
    ...legs,
    // A slab, not a block: its thickness is a fraction of the height it stands at, and
    // that gap is where the legs show. Extruding the full height would bury them.
    // Wood, matching the legs, not the mattress: a frame the same tone as its bedding
    // makes the whole bed read as one tan mass and throws away the parts.
    { x0, y0, z0: frameBottom, x1, y1, z1: frameTop, material: 'wood', label: 'bed frame' },
    // Inset so the frame reads as a rail around it.
    {
      x0: x0 + 0.09, y0: y0 + 0.09, z0: frameTop - 0.02,
      x1: x1 - 0.09, y1: y1 - 0.09, z1: mattressTop,
      material: 'cloth', label: 'mattress',
    },
    // The accent that says which end you sleep at, and the only thing distinguishing
    // rotation 0 from rotation 2.
    {
      x0: x0 + 0.14, y0: y0 + 0.17, z0: mattressTop - 0.01,
      x1: x0 + 0.62, y1: y1 - 0.17, z1: top,
      material: 'linen', label: 'pillow',
    },
  ];
}

/**
 * A bedroll: a roll of canvas on the ground, with a pillow.
 *
 * The contrast with the bed is the only thing telling the player the upgrade was worth
 * building, so this stays deliberately poor — no frame, no legs, no lift. What it gains
 * over the old flat capsule is *thickness*: a bedroll with no height at all reads as a
 * stain on the floor, and it is bedding, which is the one thing it has to say.
 */
export function bedrollModel(): Solid[] {
  const top = HEIGHT.flat + 0.1;

  const x0 = MARGIN + 0.04;
  const x1 = 2 - MARGIN - 0.04;
  const y0 = MARGIN + 0.02;
  const y1 = 1 - MARGIN - 0.02;

  return [
    { x0, y0, z0: 0, x1, y1, z1: top * 0.72, material: 'canvas', label: 'roll' },
    // The bedding turned back at the head end, which is what a bedroll actually looks like
    // and what stops it reading as a plank.
    {
      x0: x0 + 0.5, y0: y0 + 0.05, z0: top * 0.6,
      x1, y1: y1 - 0.05, z1: top * 0.86,
      material: 'cloth', label: 'blanket',
    },
    {
      x0: x0 + 0.1, y0: y0 + 0.15, z0: top * 0.6,
      x1: x0 + 0.52, y1: y1 - 0.15, z1: top,
      material: 'linen', label: 'pillow',
    },
  ];
}

/** Which structures are drawn from a model. Everything else stays on the vector path. */
export const MODELLED = {
  [Building.Bed]: bedModel,
  [Building.Bedroll]: bedrollModel,
} as const;

export type ModelledBuilding = keyof typeof MODELLED;

export function isModelled(def: number): def is ModelledBuilding {
  return def in MODELLED;
}
