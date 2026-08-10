/**
 * Finding what occupies a cell.
 *
 * Linear scans rather than maintained indices. Buildings and construction sites number
 * in the dozens, and a cache that can silently desync from the entity stores is a worse
 * problem than a loop that can't. When either store reaches the thousands, add an index
 * *inside* the store so it cannot drift, rather than beside it.
 */

import type { ItemDefId } from '../defs/items';
import type { Building } from '../entities/building';
import type { ConstructionSite } from '../entities/constructionSite';
import { coversCell, footprintOfBuildable, footprintOfBuilding } from './footprint';
import type { World } from './world';

/**
 * The building standing on this cell, if any.
 *
 * Asks each building whether its *footprint* covers the cell, not whether its anchor is
 * the cell. Converting the index once and comparing coordinates is also cheaper than the
 * `map.idx()` per building this used to do.
 */
export function buildingAt(world: World, cellIndex: number): Building | undefined {
  const x = world.map.xOf(cellIndex);
  const y = world.map.yOf(cellIndex);
  const z = world.map.zOf(cellIndex);

  for (const building of world.buildings.values()) {
    if (coversCell(building.pos, footprintOfBuilding(building.def), building.rotation, x, y, z)) {
      return building;
    }
  }
  return undefined;
}

/** True when any living colonist is standing on, or stepping into, this cell. */
export function pawnOccupies(world: World, cellIndex: number): boolean {
  for (const pawn of world.pawns.values()) {
    if (pawn.dead) continue;
    if (world.map.idx(pawn.pos.x, pawn.pos.y, pawn.pos.z) === cellIndex) return true;
    // Also counts the tile being walked into, or a wall completes in someone's face
    // during the step that would have carried them clear.
    const target = pawn.moveTarget;
    if (target && world.map.idx(target.x, target.y, target.z) === cellIndex) return true;
  }
  return false;
}

export function siteAt(world: World, cellIndex: number): ConstructionSite | undefined {
  const x = world.map.xOf(cellIndex);
  const y = world.map.yOf(cellIndex);
  const z = world.map.zOf(cellIndex);

  for (const site of world.sites.values()) {
    if (coversCell(site.pos, footprintOfBuildable(site.def), site.rotation, x, y, z)) return site;
  }
  return undefined;
}

/**
 * How many of `def` the colony holds, loose on the ground or carried.
 *
 * What a bill's quota is measured against. Counts carried stacks deliberately: a meal in
 * a colonist's hands on the way to a stockpile still exists, and ignoring it would have
 * the kitchen cook a replacement for something nobody had eaten.
 */
export function countHeld(world: World, def: ItemDefId): number {
  let held = 0;
  for (const item of world.items.values()) {
    if (item.def === def) held += item.count;
  }
  return held;
}
