/**
 * Beds that belong to somebody.
 *
 * `Building.owner` has been on the entity, in `serialize.ts` and in `hashWorld()` since M3
 * and nothing ever set it — so this is the first milestone in which any of it means
 * anything, and the interesting cases are all about a claim outliving the thing that made
 * it. A bed held forever by a colonist who died, a claim made by somebody who never
 * arrived, a thought that can only ever fire one way.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../src/sim/core/constants';
import { pos } from '../src/sim/core/position';
import { Buildable } from '../src/sim/defs/buildables';
import { Building, buildingDef } from '../src/sim/defs/buildings';
import { ItemDef } from '../src/sim/defs/items';
import { Need } from '../src/sim/defs/needs';
import { Terrain } from '../src/sim/defs/terrain';
import { Thought } from '../src/sim/defs/thoughts';
import { bedOwner } from '../src/sim/ai/needs';
import { buildingAt } from '../src/sim/world/lookup';
import { Simulation } from '../src/sim/simulation';
import { hashWorld } from '../src/sim/save/hash';
import { deserializeWorld, serializeWorld } from '../src/sim/save/serialize';
import type { Building as PlacedBuilding } from '../src/sim/entities/building';
import type { World } from '../src/sim/world/world';
import type { Pawn } from '../src/sim/entities/pawn';

/** A flat yard, one colonist, and enough materials to raise beds instantly. */
function colony(colonists = 1) {
  const sim = new Simulation({ seed: 991, width: 40, height: 40, colonists });
  const world = sim.world;

  for (const plant of [...world.plants.values()]) world.plants.remove(plant.id);
  for (let y = 2; y <= 37; y++) {
    for (let x = 2; x <= 37; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  world.reachability.markDirty();
  world.rooms.markDirty();

  const site = world.landingSite;
  world.items.spawn(world.map, ItemDef.Stone, 400, pos(site.x - 3, site.y));
  world.items.spawn(world.map, ItemDef.Scrap, 400, pos(site.x - 4, site.y));

  return { sim, world };
}

/** Raises a finished bed at a spot, the way the debug panel and scenarios do. */
function placeBed(sim: Simulation, x: number, y: number): PlacedBuilding {
  sim.dispatch({
    type: 'build',
    buildable: Buildable.Bed,
    area: { x0: x, y0: y, x1: x, y1: y, z: 0 },
    instant: true,
  });
  sim.flushCommands();
  const bed = buildingAt(sim.world, sim.world.map.idx(x, y));
  if (!bed) throw new Error(`no bed at ${x},${y}`);
  return bed;
}

/** Takes every bedroll away, so the only place to sleep is the bed under test. */
function removeBedrolls(world: World): void {
  for (const b of [...world.buildings.values()]) {
    if (b.def === Building.Bedroll) world.buildings.remove(b.id);
  }
}

function exhaust(pawn: Pawn): void {
  pawn.needs[Need.Rest] = 0.05;
  pawn.needs[Need.Hunger] = 1;
}

/**
 * Long enough for a colonist to walk to a bed, sleep, and *wake up*.
 *
 * `REST_PER_SLEEPING_TICK` fills the bar over about a third of a day, and the wake toil
 * is what records the memory — so anything short enough to catch only the claim would
 * leave every thought assertion silently unreached rather than failing.
 */
const A_FULL_NIGHT = TICKS_PER_DAY / 2;

describe('a colonist claims the bed they sleep in', () => {
  it('and the claim is on the bed, not on the job', () => {
    const { sim, world } = colony();
    removeBedrolls(world);
    const bed = placeBed(sim, world.landingSite.x + 3, world.landingSite.y);
    expect(bed.owner).toBeNull();

    const pawn = [...world.pawns.values()][0];
    exhaust(pawn);
    sim.run(A_FULL_NIGHT);

    expect(bed.owner, 'nobody claimed the bed they slept in').toBe(pawn.id);
  });

  it('remembers it in the save, and the hash notices if it does not', () => {
    /*
     * The reason this is worth a test of its own: `owner` was already serialized and
     * already hashed before anything ever wrote to it, so the round-trip has been
     * passing for three milestones while guarding a field that was permanently null.
     */
    const { sim, world } = colony();
    removeBedrolls(world);
    const bed = placeBed(sim, world.landingSite.x + 3, world.landingSite.y);
    const pawn = [...world.pawns.values()][0];
    exhaust(pawn);
    sim.run(A_FULL_NIGHT);
    expect(bed.owner).toBe(pawn.id);

    const restored = deserializeWorld(serializeWorld(world));
    expect(hashWorld(restored)).toBe(hashWorld(world));
    expect([...restored.buildings.values()].find((b) => b.id === bed.id)?.owner).toBe(pawn.id);
  });

  it('does not claim a bedroll, because the party shares those', () => {
    // Both halves of the thought pair have to be reachable. If every bed a colonist
    // touched became theirs, `SleptInBed` would fire once on night one and never again.
    expect(buildingDef(Building.Bedroll).ownable).toBe(false);
    expect(buildingDef(Building.Bed).ownable).toBe(true);

    const { sim, world } = colony();
    const pawn = [...world.pawns.values()][0];
    exhaust(pawn);
    sim.run(A_FULL_NIGHT);

    for (const b of world.buildings.values()) {
      if (b.def === Building.Bedroll) expect(b.owner).toBeNull();
    }
    expect(pawn.memories.some((m) => m.def === Thought.SleptInBed)).toBe(true);
    expect(pawn.memories.some((m) => m.def === Thought.SleptInOwnBed)).toBe(false);
  });

  it('remembers sleeping in a bed of their own', () => {
    const { sim, world } = colony();
    removeBedrolls(world);
    placeBed(sim, world.landingSite.x + 3, world.landingSite.y);

    const pawn = [...world.pawns.values()][0];
    exhaust(pawn);
    sim.run(A_FULL_NIGHT);

    expect(pawn.memories.some((m) => m.def === Thought.SleptInOwnBed)).toBe(true);
    expect(pawn.memories.some((m) => m.def === Thought.SleptInBed)).toBe(false);
  });
});

describe('a claim does not outlive its owner', () => {
  it('a dead colonist stops holding a bed', () => {
    /*
     * Pawns are never removed from the store — death is a flag — so without this the bed
     * of anyone who dies is unusable for the rest of the game, `canReach` says nothing,
     * no alert fires, and the only symptom is a colonist walking past a perfectly good
     * bed to sleep on the floor. The failure mode ADR 0008 is about.
     */
    const { sim, world } = colony(2);
    removeBedrolls(world);
    const bed = placeBed(sim, world.landingSite.x + 3, world.landingSite.y);

    const [first, second] = [...world.pawns.values()];
    bed.owner = first.id;
    expect(bedOwner(world, bed)).toBe(first.id);

    first.dead = true;
    expect(bedOwner(world, bed), 'a corpse still holds the bed').toBeNull();

    exhaust(second);
    sim.run(A_FULL_NIGHT);
    expect(bed.owner, 'the survivor never claimed the freed bed').toBe(second.id);
  });
});

describe('a colonist prefers their own bed to a nearer one', () => {
  it('walks past an unclaimed bed to reach the one that is theirs', () => {
    /*
     * Ownership has to outrank distance or it means nothing: ranked by nearness a
     * colonist takes whichever bed is closest tonight, their claim never comes up again,
     * and the mood bonus fires at random.
     */
    const { sim, world } = colony(2);
    removeBedrolls(world);
    const site = world.landingSite;
    const near = placeBed(sim, site.x + 2, site.y);
    const far = placeBed(sim, site.x + 9, site.y);

    const pawn = [...world.pawns.values()][0];
    far.owner = pawn.id;
    pawn.pos = pos(site.x, site.y);

    exhaust(pawn);
    sim.run(A_FULL_NIGHT);

    expect(far.owner).toBe(pawn.id);
    expect(near.owner, 'the nearer bed was claimed instead of the one already owned').not.toBe(
      pawn.id,
    );
    expect(pawn.memories.some((m) => m.def === Thought.SleptInOwnBed)).toBe(true);
  });
});
