/**
 * Turning a finished site into the thing it was going to be.
 *
 * The one place a blueprint becomes real, so the invalidations that must happen are in
 * one place too. Getting these wrong is silent: forget `reachability.markDirty()` and
 * colonists path straight through a new wall's old opening; forget `rooms.markDirty()`
 * and a completed house never counts as indoors.
 */

import { buildableDef } from '../defs/buildables';
import { buildingDef } from '../defs/buildings';
import type { ItemDefId } from '../defs/items';
import { createBuilding } from '../entities/building';
import type { ConstructionSite } from '../entities/constructionSite';
import type { World } from './world';

export function completeConstruction(world: World, site: ConstructionSite): void {
  const def = buildableDef(site.def);
  const index = world.map.idx(site.pos.x, site.pos.y, site.pos.z);

  const result = def.result;
  if (result.kind === 'building') {
    const structure = buildingDef(result.building);
    world.buildings.add((id) => createBuilding(id, result.building, site.pos));
    world.map.setBuildingAt(index, !structure.passable, structure.blocksRoom);
  } else {
    world.map.setTerrainAt(index, result.terrain);
  }

  world.sites.remove(site.id);

  // Both change for the same reason — the shape of the world just changed.
  world.reachability.markDirty();
  world.rooms.markDirty();
}

/**
 * Abandons a site, returning whatever was delivered to the ground.
 *
 * Refunding matters: cancelling a half-supplied wall should give the stone back, or
 * every misclick quietly costs the colony materials it has no way to recover.
 */
export function cancelConstruction(world: World, site: ConstructionSite): void {
  for (let def = 0; def < site.delivered.length; def++) {
    const count = site.delivered[def];
    if (count > 0) world.items.spawn(world.map, def as ItemDefId, count, site.pos);
  }
  world.sites.remove(site.id);
}
