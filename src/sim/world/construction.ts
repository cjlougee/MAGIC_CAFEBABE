/**
 * Turning a finished site into the thing it was going to be.
 *
 * The one place a blueprint becomes real, so the invalidations that must happen are in
 * one place too. Getting these wrong is silent: forget `reachability.markDirty()` and
 * colonists path straight through a new wall's old opening; forget `rooms.markDirty()`
 * and a completed house never counts as indoors.
 */

import {
  buildableDef,
  buildableProducing,
  buildableProducingTerrain,
  refundFor,
  type BuildableId,
} from '../defs/buildables';
import { buildingDef } from '../defs/buildings';
import type { ItemDefId } from '../defs/items';
import { createBuilding } from '../entities/building';
import type { ConstructionSite } from '../entities/constructionSite';
import { Designation } from './designations';
import { buildingAt } from './lookup';
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
    // A *surface*, laid over ground that is remembered. Deconstructing the floor later
    // has to put back sand where there was sand, not a default we invented.
    world.map.setSurfaceAt(index, result.terrain);
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

/** Which blueprint produced whatever stands on this cell, if the colony built it. */
export function builtHere(world: World, index: number): BuildableId | undefined {
  const building = buildingAt(world, index);
  if (building) return buildableProducing(building.def);
  return buildableProducingTerrain(world.map.terrainAt(index));
}

/**
 * Takes a finished structure back down, salvaging part of what it cost.
 *
 * The exact inverse of `completeConstruction`, and deliberately its neighbour: the two
 * are the only places the built shape of the world changes, so the invalidations they
 * owe live side by side where a reader can see one is missing.
 *
 * The structure comes down *before* the salvage is dropped. A wall's own cell isn't
 * storable while the wall is standing, so refunding first would spill the stone onto a
 * neighbour for no reason — or into a river, if the wall happened to be on a bank.
 *
 * Returns false when there is nothing here the colony built.
 */
export function deconstruct(world: World, index: number): boolean {
  const buildable = builtHere(world, index);
  if (buildable === undefined) return false;

  const pos = { x: world.map.xOf(index), y: world.map.yOf(index), z: world.map.zOf(index) };

  const building = buildingAt(world, index);
  if (building) {
    world.buildings.remove(building.id);
    world.map.setBuildingAt(index, false, false);
  } else {
    // Back to the ground it was laid over, which the map remembered for exactly this.
    world.map.setSurfaceAt(index, world.map.naturalTerrainAt(index));
  }

  world.designations.remove(Designation.Deconstruct, index);

  for (const salvage of refundFor(buildable)) {
    world.items.spawn(world.map, salvage.def, salvage.count, pos);
  }

  world.reachability.markDirty();
  world.rooms.markDirty();
  return true;
}
