/**
 * Taking it back down.
 *
 * The hole this closes: before deconstruction, a misplaced wall was permanent. Erase
 * cancels a blueprint, but a finished structure had no way out of the world at all.
 *
 * The first test is the one that matters — order a wall, let colonists raise it, mark it,
 * walk away, and come back to open ground and some of the stone. Everything else here
 * pins down a rule that would otherwise fail quietly.
 */

import { describe, expect, it } from 'vitest';
import { interrupt } from '../src/sim/ai/think';
import { pos, type TilePos } from '../src/sim/core/position';
import { Buildable, type BuildableId } from '../src/sim/defs/buildables';
import { Building } from '../src/sim/defs/buildings';
import { ItemDef } from '../src/sim/defs/items';
import { Terrain } from '../src/sim/defs/terrain';
import { WorkType } from '../src/sim/defs/workTypes';
import { createSite } from '../src/sim/entities/constructionSite';
import { migrate } from '../src/sim/save/migrate';
import { hashWorld } from '../src/sim/save/hash';
import { Simulation } from '../src/sim/simulation';
import { completeConstruction } from '../src/sim/world/construction';
import { Designation } from '../src/sim/world/designations';
import { buildingAt } from '../src/sim/world/lookup';
import type { World } from '../src/sim/world/world';

/** A flat, cleared yard with materials to hand. Mirrors the construction tests. */
function yard(colonists = 3) {
  const sim = new Simulation({ seed: 4242, width: 48, height: 48, colonists });
  const world = sim.world;

  // Strip vegetation, or colonists wander off to pick berries and the timings become a
  // fact about the food system rather than about demolition.
  for (const plant of [...world.plants.values()]) world.plants.remove(plant.id);

  for (let y = 2; y <= 45; y++) {
    for (let x = 2; x <= 45; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  world.reachability.markDirty();
  world.rooms.markDirty();

  const origin = world.landingSite;
  world.items.spawn(world.map, ItemDef.Stone, 400, pos(origin.x - 3, origin.y));
  world.items.spawn(world.map, ItemDef.Scrap, 60, pos(origin.x - 4, origin.y));

  return { sim, world, origin };
}

/**
 * Puts a finished structure straight onto the map.
 *
 * The same call the last tick of a construct job makes, so these tests exercise the real
 * completion path without paying for the walk, the delivery and the labour first.
 */
function raise(world: World, buildable: BuildableId, at: TilePos): void {
  const site = world.sites.add((id) => createSite(id, buildable, at));
  completeConstruction(world, site);
}

function markDeconstruct(sim: Simulation, at: TilePos): void {
  sim.dispatch({
    type: 'designate',
    action: 'deconstruct',
    area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: at.z },
  });
  sim.flushCommands();
}

function countItem(world: World, def: number): number {
  let total = 0;
  for (const item of world.items.values()) {
    if (item.def === def) total += item.count;
  }
  return total;
}

describe('the misplaced wall problem', () => {
  it('builds a wall, takes it down again, and leaves open ground', () => {
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    const area = { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 };

    sim.dispatch({ type: 'build', buildable: Buildable.Wall, area });
    sim.flushCommands();
    sim.run(60000);

    // Precondition: there really is a wall in the way.
    expect(buildingAt(world, world.map.idx(at.x, at.y))?.def).toBe(Building.Wall);
    expect(world.map.isPassable(at.x, at.y)).toBe(false);

    markDeconstruct(sim, at);
    sim.run(60000);

    expect(buildingAt(world, world.map.idx(at.x, at.y))).toBeUndefined();
    expect(world.map.isPassable(at.x, at.y)).toBe(true);
    expect(world.designations.count(Designation.Deconstruct)).toBe(0);
    expect(world.reservations.activeCount).toBe(0);
  });

  it('opens a route that the wall had closed', () => {
    // The invalidation that fails silently: without reachability.markDirty(), colonists
    // keep pathing around a wall that is no longer there.
    const { sim, world, origin } = yard(1);
    const gap = pos(origin.x + 6, origin.y);

    // A rock wall from edge to edge with one built cell plugging the only gap. It has to
    // run the *whole* height of the map, not just the cleared yard — leave the top two
    // rows as worldgen made them and colonists simply walk around the end of it.
    for (let y = 0; y < world.map.height; y++) {
      if (y !== gap.y) world.map.setTerrain(gap.x, y, Terrain.Rock);
    }
    raise(world, Buildable.Wall, gap);
    world.reachability.markDirty();

    const west = pos(gap.x - 2, gap.y);
    const east = pos(gap.x + 2, gap.y);
    expect(world.reachability.canReach(west, east)).toBe(false);

    markDeconstruct(sim, gap);
    sim.run(60000);

    expect(world.reachability.canReach(west, east)).toBe(true);
  });
});

describe('salvage', () => {
  it('returns half the stone a wall cost, rounded down', () => {
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    raise(world, Buildable.Wall, at);

    const before = countItem(world, ItemDef.Stone);
    markDeconstruct(sim, at);
    sim.run(60000);

    // 5 stone in, 2 back out. Rounding down matters: rounding up would let a player
    // build and deconstruct in a loop to manufacture materials out of labour.
    expect(countItem(world, ItemDef.Stone)).toBe(before + 2);
  });

  it('returns half a door in the material the door was made of', () => {
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    raise(world, Buildable.Door, at);

    const stone = countItem(world, ItemDef.Stone);
    const scrap = countItem(world, ItemDef.Scrap);
    markDeconstruct(sim, at);
    sim.run(60000);

    expect(countItem(world, ItemDef.Scrap)).toBe(scrap + 3); // 6 scrap in, 3 back.
    expect(countItem(world, ItemDef.Stone)).toBe(stone);
  });
});

describe('floors remember what they were laid on', () => {
  it('gives back sand where there was sand, not a default', () => {
    /*
     * The reason TileMap carries a natural-terrain grid at all. A floor overwrites the
     * surface; without a record of the ground beneath, lifting it would have to invent
     * an answer, and the map would slowly stop matching the world it was generated from.
     */
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    world.map.setTerrain(at.x, at.y, Terrain.Sand);

    raise(world, Buildable.Floor, at);
    expect(world.map.getTerrain(at.x, at.y)).toBe(Terrain.StoneFloor);

    markDeconstruct(sim, at);
    sim.run(60000);

    expect(world.map.getTerrain(at.x, at.y)).toBe(Terrain.Sand);
    expect(countItem(world, ItemDef.Stone)).toBeGreaterThan(0);
  });

  it('does not disturb the ground when a floor is laid', () => {
    const { world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    const index = world.map.idx(at.x, at.y);

    world.map.setTerrain(at.x, at.y, Terrain.Grass);
    raise(world, Buildable.Floor, at);

    expect(world.map.terrainAt(index)).toBe(Terrain.StoneFloor);
    expect(world.map.naturalTerrainAt(index)).toBe(Terrain.Grass);
  });

  it('treats mined-out rock as the new ground, because rock does not come back', () => {
    const { sim, world, origin } = yard(1);
    const at = pos(origin.x + 6, origin.y);
    const index = world.map.idx(at.x, at.y);

    world.map.setTerrain(at.x, at.y, Terrain.Rock);
    world.reachability.markDirty();

    sim.dispatch({
      type: 'designate',
      action: 'mine',
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(60000);

    expect(world.map.terrainAt(index)).toBe(Terrain.Gravel);
    expect(world.map.naturalTerrainAt(index)).toBe(Terrain.Gravel);
  });
});

describe('what may be marked', () => {
  it('refuses natural rock — that is mining, and it has no cost to refund', () => {
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    world.map.setTerrain(at.x, at.y, Terrain.Rock);

    markDeconstruct(sim, at);
    expect(world.designations.count(Designation.Deconstruct)).toBe(0);
  });

  it('refuses open ground', () => {
    const { sim, world, origin } = yard();
    markDeconstruct(sim, pos(origin.x + 6, origin.y));
    expect(world.designations.count(Designation.Deconstruct)).toBe(0);
  });

  it('refuses relic plating, which the colony did not lay', () => {
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    world.map.setTerrain(at.x, at.y, Terrain.RuinFloor);

    markDeconstruct(sim, at);
    expect(world.designations.count(Designation.Deconstruct)).toBe(0);
  });

  it('refuses a bedroll, which arrived with the landing party', () => {
    // The rule is "something a blueprint produced", which settles this without a special
    // case: nothing in the architect menu makes a bedroll, so there is no cost to refund.
    const { sim, world } = yard();
    const bedroll = [...world.buildings.values()].find((b) => b.def === Building.Bedroll);
    expect(bedroll, 'the landing party brought no bedrolls').toBeDefined();

    markDeconstruct(sim, bedroll!.pos);
    expect(world.designations.count(Designation.Deconstruct)).toBe(0);
  });

  it('refuses an unfinished blueprint — that is Erase, and it is instant', () => {
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);

    sim.dispatch({
      type: 'build',
      buildable: Buildable.Wall,
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();

    markDeconstruct(sim, at);
    expect(world.designations.count(Designation.Deconstruct)).toBe(0);
  });
});

describe('erase and deconstruct are different gestures', () => {
  it('clears the mark without touching the wall', () => {
    /*
     * Erase removes *marks*. A standing wall is not a mark, and a drag of Erase across a
     * base to tidy up stockpile zones must never quietly demolish the base.
     */
    const { sim, world, origin } = yard();
    const at = pos(origin.x + 6, origin.y);
    raise(world, Buildable.Wall, at);
    markDeconstruct(sim, at);
    expect(world.designations.count(Designation.Deconstruct)).toBe(1);

    sim.dispatch({
      type: 'designate',
      action: 'cancel',
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(60000);

    expect(world.designations.count(Designation.Deconstruct)).toBe(0);
    expect(buildingAt(world, world.map.idx(at.x, at.y))?.def).toBe(Building.Wall);
  });
});

describe('deconstruction as work', () => {
  it('never lets two colonists claim the same wall', () => {
    const { sim, world, origin } = yard(3);
    const at = pos(origin.x + 8, origin.y);
    raise(world, Buildable.Wall, at);
    markDeconstruct(sim, at);
    sim.run(120); // Long enough for every pawn to have thought at least twice.

    const crews = [...world.pawns.values()].filter((p) => p.job?.job.kind === 'deconstruct');
    expect(crews).toHaveLength(1);
  });

  it('frees the claim the moment the job ends', () => {
    const { sim, world, origin } = yard(2);
    const at = pos(origin.x + 8, origin.y);
    raise(world, Buildable.Wall, at);
    markDeconstruct(sim, at);
    sim.run(120);

    const crew = [...world.pawns.values()].find((p) => p.job?.job.kind === 'deconstruct');
    expect(crew).toBeDefined();

    interrupt(world, crew!, 'test');
    expect(world.reservations.activeCount).toBe(0);

    // And someone picks it straight back up, rather than it being locked forever.
    sim.run(120);
    expect([...world.pawns.values()].some((p) => p.job?.job.kind === 'deconstruct')).toBe(true);
  });

  it('is never assigned to a colonist with Construct switched off', () => {
    const { sim, world, origin } = yard(1);
    const at = pos(origin.x + 8, origin.y);
    raise(world, Buildable.Wall, at);

    const pawn = [...world.pawns.values()][0];
    pawn.priorities[WorkType.Construct] = 0;

    markDeconstruct(sim, at);
    sim.run(30000);

    expect(buildingAt(world, world.map.idx(at.x, at.y))?.def).toBe(Building.Wall);
  });

  it('finishes what it started before tearing anything down', () => {
    // Giver order: a colony with both queued looks like it ignored the build order if it
    // wanders off to demolish first.
    const { sim, world, origin } = yard(1);
    const wall = pos(origin.x + 8, origin.y);
    const blueprint = pos(origin.x + 8, origin.y + 2);

    raise(world, Buildable.Wall, wall);
    world.sites.add((id) => createSite(id, Buildable.Wall, blueprint));
    const site = [...world.sites.values()][0];
    site.delivered[ItemDef.Stone] = 5; // Materials done; only labour remains.

    markDeconstruct(sim, wall);
    sim.run(200);

    const pawn = [...world.pawns.values()][0];
    expect(pawn.job?.job.kind).toBe('construct');
  });
});

describe('a pending demolition survives a save', () => {
  it('round-trips the mark and the ground under a floor', () => {
    const { sim, world, origin } = yard();
    const floor = pos(origin.x + 6, origin.y);
    const wall = pos(origin.x + 8, origin.y);

    world.map.setTerrain(floor.x, floor.y, Terrain.Sand);
    raise(world, Buildable.Floor, floor);
    raise(world, Buildable.Wall, wall);
    markDeconstruct(sim, wall);

    const json = JSON.stringify(sim.save());
    const restored = new Simulation({ seed: 1, width: 8, height: 8, colonists: 1 });
    restored.load(migrate(JSON.parse(json)));

    expect(hashWorld(restored.world)).toBe(hashWorld(world));
    expect(restored.world.designations.count(Designation.Deconstruct)).toBe(1);
    expect(
      restored.world.map.naturalTerrainAt(restored.world.map.idx(floor.x, floor.y)),
    ).toBe(Terrain.Sand);
  });

  it('carries a version 1 save forward, guessing dirt under an old floor', () => {
    /*
     * The first real link in the migration chain. v1 never recorded what a floor covered,
     * so the guess is made once here rather than at every call site forever after — and
     * the guess is what makes lifting an old floor *do* something instead of silently
     * leaving it in place.
     */
    const { sim, world, origin } = yard(1);
    const at = pos(origin.x + 6, origin.y);
    raise(world, Buildable.Floor, at);

    // Roll the save back to the v1 shape: no natural grid, no demolition marks.
    const v1 = JSON.parse(JSON.stringify(sim.save())) as Record<string, unknown>;
    const map = v1.map as Record<string, unknown>;
    delete map.natural;
    delete v1.deconstructDesignations;
    v1.version = 1;

    const restored = new Simulation({ seed: 1, width: 8, height: 8, colonists: 1 });
    restored.load(migrate(v1));

    const index = restored.world.map.idx(at.x, at.y);
    expect(restored.world.map.terrainAt(index)).toBe(Terrain.StoneFloor);
    expect(restored.world.map.naturalTerrainAt(index)).toBe(Terrain.Dirt);
    expect(restored.world.designations.count(Designation.Deconstruct)).toBe(0);

    // Everything not under a floor is untouched.
    const bare = restored.world.map.idx(origin.x, origin.y);
    expect(restored.world.map.naturalTerrainAt(bare)).toBe(world.map.terrainAt(bare));
  });
});
