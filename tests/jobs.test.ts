/**
 * The job system.
 *
 * The first test here is M2's playable check, run headless: designate rock, paint a
 * stockpile, walk away, and assert the colony did the work. That single assertion
 * exercises work-giving, reservations, pathfinding, mining, item spawning, hauling, and
 * stacking together — the kind of coverage unit tests never reach, and exactly what the
 * sim/render firewall was built to make possible.
 */

import { describe, expect, it } from 'vitest';
import { interrupt } from '../src/sim/ai/think';
import { pos } from '../src/sim/core/position';
import { ItemDef } from '../src/sim/defs/items';
import { Terrain } from '../src/sim/defs/terrain';
import { WorkType } from '../src/sim/defs/workTypes';
import type { Pawn } from '../src/sim/entities/pawn';
import { Simulation } from '../src/sim/simulation';
import { looseItemCount } from '../src/sim/snapshot';
import { Designation } from '../src/sim/world/designations';
import type { World } from '../src/sim/world/world';

/** Flattens a working area so terrain generation can't confuse a behavioural test. */
function clearArea(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  world.reachability.markDirty();
}

function placePawns(world: World, cells: ReadonlyArray<[number, number]>): Pawn[] {
  const pawns = [...world.pawns.values()];
  pawns.forEach((pawn, i) => {
    const cell = cells[i] ?? cells[cells.length - 1];
    pawn.pos = pos(cell[0], cell[1]);
  });
  return pawns;
}

/**
 * A 30x30 flattened yard with two rocks to the east and a stockpile to the west.
 * Colonists start in the middle, so both jobs require walking.
 */
function miningYard(colonists = 2) {
  const sim = new Simulation({ seed: 11, width: 40, height: 40, colonists });
  const world = sim.world;

  clearArea(world, 2, 2, 37, 37);
  world.map.setTerrain(25, 20, Terrain.Rock);
  world.map.setTerrain(25, 21, Terrain.Rock);
  world.reachability.markDirty();

  placePawns(world, [
    [15, 20],
    [15, 21],
    [15, 22],
  ]);

  sim.dispatch({
    type: 'designate',
    action: 'mine',
    area: { x0: 25, y0: 20, x1: 25, y1: 21, z: 0 },
  });
  sim.dispatch({
    type: 'zone',
    action: 'stockpile',
    area: { x0: 8, y0: 20, x1: 9, y1: 21, z: 0 },
  });
  sim.flushCommands();

  return { sim, world };
}

describe('M2 playable check', () => {
  it('mines designated rock and stockpiles the stone with no further input', () => {
    const { sim, world } = miningYard();

    expect(world.designations.count(Designation.Mine)).toBe(2);
    expect(world.zones.stockpileCount).toBe(4);

    sim.run(20000);

    // The rock is gone and left gravel behind.
    expect(world.map.getTerrain(25, 20)).toBe(Terrain.Gravel);
    expect(world.map.getTerrain(25, 21)).toBe(Terrain.Gravel);
    expect(world.designations.count(Designation.Mine)).toBe(0);

    // Both rocks yield 20 stone, and none of it was lost along the way.
    let stone = 0;
    for (const item of world.items.values()) {
      if (item.def === ItemDef.Stone) stone += item.count;
    }
    expect(stone).toBe(40);

    // And all of it ended up where it belongs.
    expect(looseItemCount(world)).toBe(0);
  });

  it('leaves no reservations behind once the work is done', () => {
    // A leaked reservation makes a target permanently untouchable, and nothing in the
    // game will ever tell you why. Worth asserting explicitly.
    const { sim, world } = miningYard();
    sim.run(20000);

    for (const pawn of world.pawns.values()) expect(pawn.job).toBeNull();
    expect(world.reservations.activeCount).toBe(0);
  });

  it('reaches the same result every run', () => {
    const a = miningYard();
    const b = miningYard();
    a.sim.run(6000);
    b.sim.run(6000);

    const describe = (world: World) =>
      [...world.pawns.values()].map((p) => `${p.id}@${p.pos.x},${p.pos.y}:${p.job?.job.kind ?? '-'}`);

    expect(describe(a.world)).toEqual(describe(b.world));
  });
});

describe('reservations', () => {
  it('never lets two colonists claim the same rock', () => {
    const sim = new Simulation({ seed: 11, width: 40, height: 40, colonists: 3 });
    const world = sim.world;
    clearArea(world, 2, 2, 37, 37);
    world.map.setTerrain(25, 20, Terrain.Rock); // Exactly one job to fight over.
    world.reachability.markDirty();
    placePawns(world, [
      [20, 20],
      [21, 20],
      [22, 20],
    ]);

    sim.dispatch({
      type: 'designate',
      action: 'mine',
      area: { x0: 25, y0: 20, x1: 25, y1: 20, z: 0 },
    });
    sim.flushCommands();
    sim.run(120); // Long enough for every pawn to have thought at least twice.

    const miners = [...world.pawns.values()].filter((p) => p.job?.job.kind === 'mine');
    expect(miners).toHaveLength(1);
  });

  it('frees a claim as soon as the job ends, so someone else can take it', () => {
    const sim = new Simulation({ seed: 11, width: 40, height: 40, colonists: 2 });
    const world = sim.world;
    clearArea(world, 2, 2, 37, 37);
    world.map.setTerrain(25, 20, Terrain.Rock);
    world.reachability.markDirty();
    placePawns(world, [
      [20, 20],
      [21, 21],
    ]);

    sim.dispatch({
      type: 'designate',
      action: 'mine',
      area: { x0: 25, y0: 20, x1: 25, y1: 20, z: 0 },
    });
    sim.flushCommands();
    sim.run(120);

    const miner = [...world.pawns.values()].find((p) => p.job?.job.kind === 'mine');
    expect(miner).toBeDefined();

    interrupt(world, miner!, 'test');
    expect(world.reservations.activeCount).toBe(0);

    sim.run(120);
    const replacement = [...world.pawns.values()].find((p) => p.job?.job.kind === 'mine');
    expect(replacement).toBeDefined();
  });
});

describe('preemption (enforcement rule 3)', () => {
  it('a player move order ends the job and releases its claims', () => {
    // One colonist, so `activeCount` reflects exactly the claims we are interrupting.
    const { sim, world } = miningYard(1);
    sim.run(200);

    const worker = [...world.pawns.values()].find((p) => p.job !== null);
    expect(worker).toBeDefined();
    expect(world.reservations.activeCount).toBeGreaterThan(0);

    sim.dispatch({ type: 'moveTo', pawnId: worker!.id, target: pos(12, 30) });
    sim.flushCommands();

    expect(worker!.job).toBeNull();
    expect(world.reservations.activeCount).toBe(0);
  });

  it('drops carried goods instead of destroying them', () => {
    /*
     * A pawn interrupted mid-haul is holding real items. Silently discarding them would
     * leak resources out of the economy every time the player gave an order — a slow,
     * invisible bug that would be very hard to trace back to its cause.
     */
    const { sim, world } = miningYard(1);
    sim.run(20000);

    // Give it something to carry, then catch it in the act.
    world.items.spawn(world.map, ItemDef.Stone, 10, pos(20, 30));
    let carrier: Pawn | undefined;
    for (let i = 0; i < 4000 && !carrier; i++) {
      sim.tick();
      carrier = [...world.pawns.values()].find((p) => p.carryingItemId !== null);
    }
    expect(carrier, 'no colonist ever picked anything up').toBeDefined();

    const totalBefore = totalStone(world);
    interrupt(world, carrier!, 'test');

    expect(carrier!.carryingItemId).toBeNull();
    expect(totalStone(world)).toBe(totalBefore);
    expect(world.reservations.activeCount).toBe(0);
  });

  it('is safe to call on an idle colonist', () => {
    const { sim, world } = miningYard();
    const pawn = [...world.pawns.values()][0];
    expect(() => interrupt(world, pawn, 'test')).not.toThrow();
    expect(pawn.job).toBeNull();
    sim.run(10);
  });
});

describe('work priorities', () => {
  it('does higher-priority work first', () => {
    const { sim, world } = miningYard(1);
    const pawn = [...world.pawns.values()][0];

    // Something to haul, right next to the pawn — and rock far away.
    world.items.spawn(world.map, ItemDef.Stone, 5, pos(15, 21));
    pawn.priorities[WorkType.Mine] = 1;
    pawn.priorities[WorkType.Haul] = 4;

    // Long enough to think and commit, short enough that a haul would still be in
    // progress — otherwise a finished job leaves the pawn idle and the check is moot.
    sim.run(60);
    expect(pawn.job?.job.kind).toBe('mine');
  });

  it('respects the reverse ordering too', () => {
    const { sim, world } = miningYard(1);
    const pawn = [...world.pawns.values()][0];

    world.items.spawn(world.map, ItemDef.Stone, 5, pos(15, 21));
    pawn.priorities[WorkType.Mine] = 4;
    pawn.priorities[WorkType.Haul] = 1;

    sim.run(60);
    expect(pawn.job?.job.kind).toBe('haul');
  });

  it('never assigns work a colonist has switched off', () => {
    const { sim, world } = miningYard(1);
    const pawn = [...world.pawns.values()][0];

    sim.dispatch({
      type: 'setWorkPriority',
      pawnId: pawn.id,
      workType: WorkType.Mine,
      priority: 0,
    });
    sim.flushCommands();
    sim.run(3000);

    expect(pawn.job?.job.kind).not.toBe('mine');
    expect(world.map.getTerrain(25, 20)).toBe(Terrain.Rock); // Nothing got mined.
  });

  it('stops work in progress when its type is switched off', () => {
    const { sim, world } = miningYard(1);
    const pawn = [...world.pawns.values()][0];
    sim.run(200);
    expect(pawn.job?.job.kind).toBe('mine');

    sim.dispatch({
      type: 'setWorkPriority',
      pawnId: pawn.id,
      workType: WorkType.Mine,
      priority: 0,
    });
    sim.flushCommands();

    expect(pawn.job).toBeNull();
    expect(world.reservations.activeCount).toBe(0);
  });
});

describe('designations', () => {
  it('only marks terrain that can actually be mined', () => {
    const { sim, world } = miningYard();
    sim.dispatch({
      type: 'designate',
      action: 'mine',
      area: { x0: 10, y0: 10, x1: 14, y1: 14, z: 0 }, // All flat dirt.
    });
    sim.flushCommands();

    expect(world.designations.count(Designation.Mine)).toBe(2); // Still just the rocks.
  });

  it('cancelling mid-job stops the work cleanly', () => {
    const { sim, world } = miningYard(1);
    sim.run(200);
    const pawn = [...world.pawns.values()][0];
    expect(pawn.job?.job.kind).toBe('mine');

    sim.dispatch({
      type: 'designate',
      action: 'cancel',
      area: { x0: 25, y0: 20, x1: 25, y1: 21, z: 0 },
    });
    sim.flushCommands();
    sim.run(60);

    expect(world.designations.count(Designation.Mine)).toBe(0);
    expect(world.map.getTerrain(25, 20)).toBe(Terrain.Rock);
    expect(world.reservations.activeCount).toBe(0);
  });

  it('refuses to place a stockpile inside solid rock', () => {
    const { sim, world } = miningYard();
    const before = world.zones.stockpileCount;

    sim.dispatch({
      type: 'zone',
      action: 'stockpile',
      area: { x0: 25, y0: 20, x1: 25, y1: 21, z: 0 },
    });
    sim.flushCommands();

    expect(world.zones.stockpileCount).toBe(before);
  });
});

describe('item stacking', () => {
  it('merges into the stack already on a cell', () => {
    const { world } = miningYard();
    world.items.spawn(world.map, ItemDef.Stone, 10, pos(12, 12));
    world.items.spawn(world.map, ItemDef.Stone, 15, pos(12, 12));

    const stack = world.items.stackAt(world.map.idx(12, 12), ItemDef.Stone);
    expect(stack?.count).toBe(25);
  });

  it('spills past the stack limit onto neighbouring cells instead of losing it', () => {
    const { world } = miningYard();
    world.items.spawn(world.map, ItemDef.Stone, 200, pos(12, 12));
    expect(totalStone(world)).toBe(200);

    const onOrigin = world.items.stackAt(world.map.idx(12, 12), ItemDef.Stone);
    expect(onOrigin?.count).toBe(75); // Capped, remainder pushed outward.
  });

  it('keeps different kinds of item separate on one cell', () => {
    const { world } = miningYard();
    world.items.spawn(world.map, ItemDef.Stone, 10, pos(12, 12));
    world.items.spawn(world.map, ItemDef.Scrap, 10, pos(12, 12));

    expect(world.items.at(world.map.idx(12, 12))).toHaveLength(2);
  });
});

function totalStone(world: World): number {
  let total = 0;
  for (const item of world.items.values()) {
    if (item.def === ItemDef.Stone) total += item.count;
  }
  return total;
}
