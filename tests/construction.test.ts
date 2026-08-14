/**
 * M4's playable check, headless: **draw a house, walk away, come back to a room.**
 *
 * Exercises the full chain in one assertion — blueprints, material delivery under Haul,
 * construction under Build, walls changing passability, and the flood fill deciding the
 * result counts as indoors.
 */

import { describe, expect, it } from 'vitest';
import { pos } from '../src/sim/core/position';
import { Buildable } from '../src/sim/defs/buildables';
import { Building } from '../src/sim/defs/buildings';
import { ItemDef } from '../src/sim/defs/items';
import { Terrain } from '../src/sim/defs/terrain';
import { WorkType } from '../src/sim/defs/workTypes';
import { buildingAt, siteAt } from '../src/sim/world/lookup';
import { Simulation } from '../src/sim/simulation';
import type { World } from '../src/sim/world/world';

/** A flat, cleared yard with plenty of stone and scrap already stockpiled. */
function buildSite(colonists = 3) {
  const sim = new Simulation({ seed: 4242, width: 48, height: 48, colonists });
  const world = sim.world;

  // Strip vegetation so colonists build instead of wandering off to pick berries.
  for (const plant of [...world.plants.values()]) world.plants.remove(plant.id);

  for (let y = 2; y <= 45; y++) {
    for (let x = 2; x <= 45; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  world.reachability.markDirty();
  world.rooms.markDirty();

  const site = world.landingSite;
  world.items.spawn(world.map, ItemDef.Stone, 400, pos(site.x - 3, site.y));
  world.items.spawn(world.map, ItemDef.Scrap, 60, pos(site.x - 4, site.y));

  return { sim, world, origin: site };
}

/** Orders a 5x5 hut with a door in one wall. Returns the interior cell. */
function orderHut(sim: Simulation, x0: number, y0: number) {
  const x1 = x0 + 4;
  const y1 = y0 + 4;

  // Four walls, ordered as four one-cell-thick strips.
  for (const area of [
    { x0, y0, x1, y1: y0, z: 0 },
    { x0, y0: y1, x1, y1, z: 0 },
    { x0, y0, x1: x0, y1, z: 0 },
    { x0: x1, y0, x1, y1, z: 0 },
  ]) {
    sim.dispatch({ type: 'build', buildable: Buildable.Wall, area });
  }
  sim.flushCommands();

  // Replace one wall cell with a door: erase, then order the door.
  const doorX = x0 + 2;
  sim.dispatch({
    type: 'designate',
    action: 'cancel',
    area: { x0: doorX, y0, x1: doorX, y1: y0, z: 0 },
  });
  sim.dispatch({
    type: 'build',
    buildable: Buildable.Door,
    area: { x0: doorX, y0, x1: doorX, y1: y0, z: 0 },
  });
  sim.flushCommands();

  return { interior: pos(x0 + 2, y0 + 2), doorAt: pos(doorX, y0) };
}

describe('M4 playable check', () => {
  it('builds an ordered hut and the inside counts as a room', () => {
    const { sim, world, origin } = buildSite();
    const { interior, doorAt } = orderHut(sim, origin.x + 6, origin.y - 2);

    expect(world.sites.size).toBe(16); // 5x5 perimeter is 16 cells.
    expect(world.rooms.isIndoors(interior)).toBe(false); // Nothing built yet.

    sim.run(120000);

    // Every blueprint became a structure.
    expect(world.sites.size).toBe(0);
    const doorIndex = world.map.idx(doorAt.x, doorAt.y, doorAt.z);
    expect(buildingAt(world, doorIndex)?.def).toBe(Building.Door);

    // And the enclosure is real.
    expect(world.rooms.isIndoors(interior)).toBe(true);
    expect(world.rooms.enclosedCount).toBeGreaterThan(0);
  });

  it('consumes the materials it was quoted', () => {
    const { sim, world, origin } = buildSite();
    const stoneBefore = countItem(world, ItemDef.Stone);
    orderHut(sim, origin.x + 6, origin.y - 2);
    sim.run(120000);

    // 15 walls at 5 stone each. Anything else means materials leaked or duplicated.
    expect(stoneBefore - countItem(world, ItemDef.Stone)).toBe(15 * 5);
  });

  it('leaves no reservations behind', () => {
    const { sim, world, origin } = buildSite();
    orderHut(sim, origin.x + 6, origin.y - 2);
    sim.run(120000);
    expect(world.reservations.activeCount).toBe(0);
  });
});

describe('walls change the world', () => {
  it('makes a completed wall impassable', () => {
    const { sim, world, origin } = buildSite();
    const at = pos(origin.x + 6, origin.y);

    expect(world.map.isPassable(at.x, at.y)).toBe(true);
    sim.dispatch({
      type: 'build',
      buildable: Buildable.Wall,
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(60000);

    expect(world.map.isPassable(at.x, at.y)).toBe(false);
  });

  it('leaves a blueprint walkable while it is still going up', () => {
    // A half-drawn house must not be a cage. Colonists have to cross the line of a
    // planned wall to build the far side of it.
    const { sim, world, origin } = buildSite();
    const at = pos(origin.x + 6, origin.y);

    sim.dispatch({
      type: 'build',
      buildable: Buildable.Wall,
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();

    expect(siteAt(world, world.map.idx(at.x, at.y))).toBeDefined();
    expect(world.map.isPassable(at.x, at.y)).toBe(true);
  });

  it('lets colonists through a door', () => {
    const { sim, world, origin } = buildSite();
    const at = pos(origin.x + 6, origin.y);

    sim.dispatch({
      type: 'build',
      buildable: Buildable.Door,
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(60000);

    expect(buildingAt(world, world.map.idx(at.x, at.y))?.def).toBe(Building.Door);
    // Walkable, and still a room boundary — that combination is the whole point.
    expect(world.map.isPassable(at.x, at.y)).toBe(true);
    expect(world.map.sealsRoomAt(world.map.idx(at.x, at.y))).toBe(true);
  });
});

describe('nobody gets walled in', () => {
  /*
   * Regression cover for the nastiest bug this system has had.
   *
   * Delivery used to walk *onto* a site to drop materials. If another colonist finished
   * that wall in the same moment, the deliverer was sealed inside it — and a pawn on an
   * impassable cell has no reachability component, so `canReach` returned false for
   * every target and they idled forever with no visible cause. Seven of sixteen walls
   * silently never got built.
   */
  it('waits rather than completing a wall on top of someone', () => {
    const { sim, world, origin } = buildSite(1);
    const at = pos(origin.x + 6, origin.y);
    const index = world.map.idx(at.x, at.y);

    sim.dispatch({
      type: 'build',
      buildable: Buildable.Wall,
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();

    const site = siteAt(world, index)!;
    site.delivered[ItemDef.Stone] = 5; // Materials done; only labour remains.

    // Park a colonist on the cell and hold them there.
    const pawn = [...world.pawns.values()][0];
    for (let i = 0; i < 4000; i++) {
      pawn.pos = at;
      pawn.moveTarget = null;
      sim.tick();
    }

    // Still a site, and the colonist is still standing on open ground.
    expect(world.sites.size).toBe(1);
    expect(world.map.isPassable(at.x, at.y)).toBe(true);
  });

  it('frees a colonist who somehow ends up inside a wall', () => {
    // Backstop for the same failure arriving by any other route.
    const { sim, world, origin } = buildSite(1);
    const at = pos(origin.x + 6, origin.y);

    world.map.setBuildingAt(world.map.idx(at.x, at.y), true, true);
    world.reachability.markDirty();

    const pawn = [...world.pawns.values()][0];
    pawn.pos = at;
    sim.run(5);

    expect(world.map.isPassable(pawn.pos.x, pawn.pos.y)).toBe(true);
    expect(world.reachability.canReach(pawn.pos, origin)).toBe(true);
  });
});

describe('rooms', () => {
  it('does not count open ground as indoors, however far from the edge', () => {
    const { world, origin } = buildSite();
    expect(world.rooms.isIndoors(origin)).toBe(false);
  });

  it('does not count a natural hollow as a room', () => {
    /*
     * Enclosure alone is not shelter. Terrain closes off plenty of pockets — a clearing
     * ringed by rock, a lagoon ringed by deep water — and counting those would hand
     * colonists the "slept under a roof" bonus for bedding down in a hole, which is
     * exactly the reward that is supposed to make building a hut worth doing.
     */
    const { world, origin } = buildSite();
    const cx = origin.x + 10;
    const cy = origin.y + 6;

    // Ring of solid rock with one open cell in the middle.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        world.map.setTerrain(cx + dx, cy + dy, Terrain.Rock);
      }
    }
    world.reachability.markDirty();
    world.rooms.markDirty();

    // Genuinely sealed, and genuinely not a room.
    expect(world.map.isPassable(cx, cy)).toBe(true);
    expect(world.rooms.isIndoors(pos(cx, cy))).toBe(false);
    expect(world.rooms.enclosedCount).toBe(0);
  });

  it('counts a hollow once a colonist walls the gap', () => {
    // The flip side: closing a natural alcove with one built wall *does* make a room.
    const { world, origin } = buildSite();
    const cx = origin.x + 14;
    const cy = origin.y + 6;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (dx === 0 && dy === -1) continue; // Leave a gap to the north.
        world.map.setTerrain(cx + dx, cy + dy, Terrain.Rock);
      }
    }
    world.map.setBuildingAt(world.map.idx(cx, cy - 1), true, true);
    world.reachability.markDirty();
    world.rooms.markDirty();

    expect(world.rooms.isIndoors(pos(cx, cy))).toBe(true);
  });

  it('needs the enclosure to be complete', () => {
    // A wall with a hole in it is a fence, not a room.
    const { sim, world, origin } = buildSite();
    const { interior } = orderHut(sim, origin.x + 6, origin.y - 2);

    // Cancel one wall cell before anything is built, leaving a permanent gap.
    const gapX = origin.x + 10;
    sim.dispatch({
      type: 'designate',
      action: 'cancel',
      area: { x0: gapX, y0: origin.y, x1: gapX, y1: origin.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(120000);

    expect(world.rooms.isIndoors(interior)).toBe(false);
  });
});

describe('blueprints', () => {
  it('refuses to stack a second blueprint on an existing one', () => {
    const { sim, world, origin } = buildSite();
    const area = { x0: origin.x + 6, y0: origin.y, x1: origin.x + 6, y1: origin.y, z: 0 };

    sim.dispatch({ type: 'build', buildable: Buildable.Wall, area });
    sim.dispatch({ type: 'build', buildable: Buildable.Wall, area });
    sim.flushCommands();

    expect(world.sites.size).toBe(1);
  });

  it('refunds delivered materials when cancelled', () => {
    /*
     * Cancelling a half-supplied wall must give the stone back, or every misclick
     * quietly costs the colony materials with no way to recover them.
     */
    const { sim, world, origin } = buildSite();
    const at = pos(origin.x + 6, origin.y);
    const area = { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 };

    sim.dispatch({ type: 'build', buildable: Buildable.Wall, area });
    sim.flushCommands();

    // Let the delivery land, but interrupt before the wall goes up.
    const site = siteAt(world, world.map.idx(at.x, at.y))!;
    site.delivered[ItemDef.Stone] = 5;

    const before = countItem(world, ItemDef.Stone);
    sim.dispatch({ type: 'designate', action: 'cancel', area });
    sim.flushCommands();

    expect(world.sites.size).toBe(0);
    expect(countItem(world, ItemDef.Stone)).toBe(before + 5);
  });

  it('refuses to lay a surface over one the colony already laid', () => {
    /*
     * **`naturalTerrain` remembers exactly one layer down.** `setSurfaceAt` lays a floor
     * over ground and leaves `naturalTerrain` holding what was underneath, so lifting the
     * floor gives back sand where there was sand. A *second* surface has nowhere to record
     * what it covered — so carpet over a stone floor would deconstruct straight back to
     * grass, quietly destroying a floor the player paid stone and labour for.
     *
     * Sneaks up in exactly the way the M15 landing-site bug did: every part is correct and
     * the composition is not. Nothing on screen would ever have said so.
     */
    const { sim, world, origin } = buildSite();
    const at = pos(origin.x + 6, origin.y);
    const area = { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 };
    const index = world.map.idx(at.x, at.y);
    const natural = world.map.naturalTerrainAt(index);

    sim.dispatch({ type: 'build', buildable: Buildable.Floor, area, instant: true });
    sim.flushCommands();
    expect(world.map.terrainAt(index)).toBe(Terrain.StoneFloor);

    sim.dispatch({ type: 'build', buildable: Buildable.Carpet, area });
    sim.flushCommands();

    expect(world.sites.size, 'carpet may not be laid over a built floor').toBe(0);
    // And the ground the floor was laid over is still the ground it was laid over.
    expect(world.map.naturalTerrainAt(index)).toBe(natural);
  });

  it('lays a surface on natural ground, and gives that ground back', () => {
    // The other half: the rule must refuse *stacking*, not laying.
    const { sim, world, origin } = buildSite();
    const at = pos(origin.x + 7, origin.y);
    const area = { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 };
    const index = world.map.idx(at.x, at.y);
    const natural = world.map.naturalTerrainAt(index);

    sim.dispatch({ type: 'build', buildable: Buildable.Carpet, area, instant: true });
    sim.flushCommands();
    expect(world.map.terrainAt(index)).toBe(Terrain.Carpet);

    sim.dispatch({ type: 'designate', action: 'deconstruct', area });
    sim.flushCommands();
    sim.run(30000);

    expect(world.map.terrainAt(index)).toBe(natural);
  });

  it('is never assigned to a colonist with Build switched off', () => {
    const { sim, world, origin } = buildSite(1);
    const pawn = [...world.pawns.values()][0];
    pawn.priorities[WorkType.Construct] = 0;

    sim.dispatch({
      type: 'build',
      buildable: Buildable.Wall,
      area: { x0: origin.x + 6, y0: origin.y, x1: origin.x + 6, y1: origin.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(30000);

    // Materials may well have been delivered — that is Haul's job, not Build's.
    expect(world.sites.size).toBe(1);
  });
});

function countItem(world: World, def: number): number {
  let total = 0;
  for (const item of world.items.values()) {
    if (item.def === def) total += item.count;
  }
  return total;
}
