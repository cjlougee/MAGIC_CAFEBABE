/**
 * Beds and bedrolls, every facing, occupied, at night.
 *
 * The first scenarios, and they exist because this is the exact picture that cost twenty
 * tool calls to reach by hand — six of them spent talking colonists out of the bedroll
 * they were already lying in. Four rotations side by side is also the arrangement that
 * catches what a single facing never does: rotations 0 and 2 cover *identical* cells and
 * differ only in which end the pillow is at, so a sleeper laid on the anchor looks
 * perfectly correct until you see the pair together.
 *
 * At night because sleeping colonists are what is being shown, and because a lit scene is
 * the one place the sleeping pose has to hold up against everything else on the tile.
 */

import { pos, type TilePos } from '../sim/core/position';
import { Building, type BuildingId } from '../sim/defs/buildings';
import { ROTATIONS } from '../sim/world/footprint';
import type { Scenario, ScenarioBuilder } from './index';

/** Room for four two-cell structures in a row, and margin around them. */
const SIZE = 28;

/** Far enough apart that neighbouring footprints never touch at any rotation. */
const SPACING = 5;

/**
 * Clear of the landing party.
 *
 * The starting bedrolls are laid around the landing site, which sits near the middle of
 * the map — and they are buildings, so they would refuse these cells rather than yield
 * them. A row along the top keeps the whole span free at every size this scenario uses.
 */
const ROW: TilePos = pos(4, 4);

function sleepingRow(s: ScenarioBuilder, def: BuildingId): void {
  s.flat(SIZE);

  for (const rotation of ROTATIONS) {
    const at = pos(ROW.x + rotation * SPACING, ROW.y, ROW.z);
    s.sleeperIn(s.place(def, at, rotation));
  }

  // Last, so the colonists were posed by hand rather than by an AI that had all night to
  // change its mind about where to lie down.
  s.timeOfDay('night');
}

export const beds: Scenario[] = [
  {
    name: 'beds-all-rotations',
    about: 'Four beds, one per facing, each with a colonist asleep at the head end. Night.',
    build: (s) => sleepingRow(s, Building.Bed),
    frame: { fit: 'contents', zoom: 2 },
  },
  {
    name: 'bedrolls-all-rotations',
    about: 'The same row in bedrolls — what the landing party sleeps on before beds exist.',
    build: (s) => sleepingRow(s, Building.Bedroll),
    frame: { fit: 'contents', zoom: 2 },
  },
];
