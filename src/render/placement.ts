/**
 * Where a sprite goes *relative to a structure*.
 *
 * A sprite's own art can be perfect and still land in the wrong place, and that is a
 * different kind of bug with a different kind of fix — see the placement contracts in
 * `tests/art.test.ts`. This module is the one answer to the handful of questions of the
 * form "given this building, where does that draw".
 *
 * **It exists because two of them disagreed.** `ObjectLayer` placed a sleeping colonist on
 * the ground plane; the contact sheet placed the same colonist relative to the sprite
 * frame, whose top already carries `-rise`. Both were plausible, both were written from
 * the same intent, and they differed by exactly the bed's height — so the review surface
 * showed a colonist lying neatly on a bed while the game drew one lying on the floor
 * underneath it. A picture that disagrees with the game is worse than no picture, because
 * it is trusted.
 */

import { buildingCells, type Building } from '../sim/entities/building';
import type { BuildingId } from '../sim/defs/buildings';
import { footprintOfBuilding, cellsOf, type Rotation } from '../sim/world/footprint';
import type { TilePos } from '../sim/core/position';
import { BUILDING_HEIGHT } from './art/buildingArt';
import { tileToWorld, type Point } from './iso';

/**
 * Where a colonist asleep in a structure is drawn, in world pixels.
 *
 * Two corrections over "the cell the pawn stands on", and the sleeping pose needs both:
 *
 *  - **Along the footprint.** A pawn sleeps at `headCellOf` — one end of a 2×1 — so a
 *    sprite centred on their own cell runs half its length past the head of the bed. The
 *    pose is centred on the *footprint* instead, as `LightingLayer` does for a hearth.
 *  - **Up onto the surface.** A bed stands 11px off the ground. A sleeper anchored at
 *    their own ground line sits on the floor beneath it, head hanging off the end — which
 *    is visible on a bed and nearly invisible on a bedroll's 3px, so it read as "beds are
 *    broken, bedrolls are fine".
 *
 * The pawn itself never moves: `spot` is a job field, saved and hashed, so shifting a
 * colonist to make a picture line up would trade a render bug for a determinism one.
 */
export function sleeperCentre(building: Building): Point {
  return sleeperCentreAt(building.def, building.pos, building.rotation);
}

/** The same, from a def and an anchor — for review surfaces, which have no instance. */
export function sleeperCentreAt(def: BuildingId, anchor: TilePos, rotation: Rotation): Point {
  const cells = cellsOf(anchor, footprintOfBuilding(def), rotation);
  const ground = footprintCentre(cells, anchor.z);
  return { x: ground.x, y: ground.y - (BUILDING_HEIGHT[def] ?? 0) };
}

/**
 * World-pixel centre of a set of footprint cells, on the ground plane.
 *
 * The mean of the cells, which for a 1×1 is exactly `tileToWorld` of that cell — so
 * nothing already centred moves. `tileToWorld` is linear, so a fractional tile is the
 * projection's own answer rather than an approximation of it.
 */
export function footprintCentre(cells: readonly TilePos[], z: number): Point {
  let x = 0;
  let y = 0;
  for (const cell of cells) {
    x += cell.x;
    y += cell.y;
  }
  return tileToWorld(x / cells.length, y / cells.length, z);
}

/** Convenience for callers holding an instance rather than a def. */
export function buildingCentre(building: Building): Point {
  return footprintCentre(buildingCells(building), building.pos.z);
}
