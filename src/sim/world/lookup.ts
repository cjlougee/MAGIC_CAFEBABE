/**
 * Finding what occupies a cell.
 *
 * Linear scans rather than maintained indices. Buildings and construction sites number
 * in the dozens, and a cache that can silently desync from the entity stores is a worse
 * problem than a loop that can't. When either store reaches the thousands, add an index
 * *inside* the store so it cannot drift, rather than beside it.
 */

import type { Building } from '../entities/building';
import type { ConstructionSite } from '../entities/constructionSite';
import type { World } from './world';

export function buildingAt(world: World, cellIndex: number): Building | undefined {
  for (const building of world.buildings.values()) {
    if (world.map.idx(building.pos.x, building.pos.y, building.pos.z) === cellIndex) {
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
  for (const site of world.sites.values()) {
    if (world.map.idx(site.pos.x, site.pos.y, site.pos.z) === cellIndex) return site;
  }
  return undefined;
}
