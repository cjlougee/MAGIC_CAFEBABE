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
import { buildingCells, createBuilding } from '../entities/building';
import { siteCells, type ConstructionSite } from '../entities/constructionSite';
import { ledgerContents } from '../entities/materials';
import { Designation } from './designations';
import { buildingAt } from './lookup';
import type { World } from './world';

export function completeConstruction(world: World, site: ConstructionSite): void {
  const def = buildableDef(site.def);
  const index = world.map.idx(site.pos.x, site.pos.y, site.pos.z);

  const result = def.result;
  if (result.kind === 'building') {
    const structure = buildingDef(result.building);
    const building = world.buildings.add((id) =>
      createBuilding(id, result.building, site.pos, site.rotation),
    );
    // Every cell the structure stands on, not just the anchor. A 2×2 hearth that only
    // stamped one cell would be walked through on the other three.
    for (const cell of buildingCells(building)) {
      world.map.setBuildingAt(
        world.map.idx(cell.x, cell.y, cell.z),
        !structure.passable,
        structure.blocksRoom,
      );
    }
  } else {
    // A *surface*, laid over ground that is remembered. Deconstructing the floor later
    // has to put back sand where there was sand, not a default we invented.
    world.map.setSurfaceAt(index, result.terrain);
  }

  world.sites.remove(site.id);

  // Both change for the same reason — the shape of the world just changed. Reachability
  // is told *which* cells, because on a 512² map a blanket invalidation is a 60 ms stall
  // and there are sixteen of them in a hut. Per cell rather than per structure, for the
  // same reason. See ADR 0007.
  for (const cell of siteCells(site)) {
    world.reachability.markDirtyAt(world.map.idx(cell.x, cell.y, cell.z));
  }
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

  const building = buildingAt(world, index);
  // Read before the structure comes down, dropped after — a workbench may be holding
  // ingredients somebody carried across the map, and demolishing a stocked campfire must
  // not quietly eat the colony's dinner. It joins the salvage rather than preceding it so
  // it obeys the same rule: nothing is placed until the cell is free to receive it.
  const stranded = building ? ledgerContents(building.loaded) : [];

  // A multi-tile structure comes down as one thing however many of its cells were
  // marked, and the salvage lands at its anchor rather than wherever the mark was
  // clicked. Refunding per marked cell would let a 2×2 hearth pay out four times.
  const cells = building ? buildingCells(building) : [cellOf(world, index)];
  const pos = cells[0];

  if (building) {
    world.buildings.remove(building.id);
    for (const cell of cells) {
      world.map.setBuildingAt(world.map.idx(cell.x, cell.y, cell.z), false, false);
    }
  } else {
    // Back to the ground it was laid over, which the map remembered for exactly this.
    world.map.setSurfaceAt(index, world.map.naturalTerrainAt(index));
  }

  for (const cell of cells) {
    world.designations.remove(Designation.Deconstruct, world.map.idx(cell.x, cell.y, cell.z));
  }

  for (const salvage of [...refundFor(buildable), ...stranded]) {
    world.items.spawn(world.map, salvage.def, salvage.count, pos);
  }

  for (const cell of cells) {
    world.reachability.markDirtyAt(world.map.idx(cell.x, cell.y, cell.z));
  }
  world.rooms.markDirty();
  return true;
}

function cellOf(world: World, index: number) {
  return { x: world.map.xOf(index), y: world.map.yOf(index), z: world.map.zOf(index) };
}
