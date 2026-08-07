/**
 * Save, load, and the week-long regression test that closes Slice 1.
 *
 * The round-trip tests all rest on one idea: **serialize, deserialize, and the world
 * hash must be identical.** That single comparison covers every field at once, which is
 * why `hashWorld` and `serializeWorld` have to be kept in step — a field missing from
 * both passes silently, and the doc comments on each say so.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../src/sim/core/constants';
import { pos } from '../src/sim/core/position';
import { Buildable } from '../src/sim/defs/buildables';
import { ItemDef } from '../src/sim/defs/items';
import { Need } from '../src/sim/defs/needs';
import { Terrain } from '../src/sim/defs/terrain';
import { migrate, SaveVersionError } from '../src/sim/save/migrate';
import { decodeRle, encodeRle, SAVE_VERSION } from '../src/sim/save/serialize';
import { hashWorld } from '../src/sim/save/hash';
import { Simulation } from '../src/sim/simulation';

const SEVEN_DAYS = TICKS_PER_DAY * 7;

function colony(seed = 20260806) {
  return new Simulation({ seed, width: 80, height: 80, colonists: 3 });
}

/** Round-trips through JSON, so nothing survives on a shared object reference. */
function reload(sim: Simulation): Simulation {
  const json = JSON.stringify(sim.save());
  const restored = new Simulation({ seed: 1, width: 8, height: 8, colonists: 1 });
  restored.load(migrate(JSON.parse(json)));
  return restored;
}

describe('run-length encoding', () => {
  it('round-trips a grid exactly', () => {
    const data = new Uint8Array(500);
    for (let i = 0; i < data.length; i++) data[i] = i < 200 ? 3 : i % 5;
    expect([...decodeRle(encodeRle(data), data.length)]).toEqual([...data]);
  });

  it('collapses long runs, which is the whole point', () => {
    const flat = new Uint8Array(10000).fill(7);
    expect(encodeRle(flat)).toEqual([7, 10000]);
  });

  it('handles an empty grid', () => {
    expect(encodeRle(new Uint8Array(0))).toEqual([]);
  });
});

describe('save round-trip', () => {
  it('restores a fresh colony byte-identically', () => {
    const sim = colony();
    expect(hashWorld(reload(sim).world)).toBe(hashWorld(sim.world));
  });

  it('restores a colony that has been living for two days', () => {
    const sim = colony();
    sim.run(TICKS_PER_DAY * 2);
    expect(hashWorld(reload(sim).world)).toBe(hashWorld(sim.world));
  });

  it('restores work in progress — jobs, carried goods, and claims', () => {
    const sim = colony();
    const world = sim.world;

    for (let y = 10; y <= 30; y++) {
      for (let x = 10; x <= 30; x++) world.map.setTerrain(x, y, Terrain.Dirt);
    }
    world.map.setTerrain(20, 20, Terrain.Rock);
    world.reachability.markDirty();
    world.items.spawn(world.map, ItemDef.Stone, 60, pos(15, 15));

    sim.dispatch({
      type: 'designate',
      action: 'mine',
      area: { x0: 20, y0: 20, x1: 20, y1: 20, z: 0 },
    });
    sim.dispatch({
      type: 'zone',
      action: 'stockpile',
      area: { x0: 12, y0: 12, x1: 13, y1: 13, z: 0 },
    });
    sim.dispatch({
      type: 'build',
      buildable: Buildable.Wall,
      area: { x0: 18, y0: 18, x1: 18, y1: 18, z: 0 },
    });
    sim.flushCommands();
    sim.run(400); // Long enough that colonists are mid-job.

    const busy = [...world.pawns.values()].some((pawn) => pawn.job !== null);
    expect(busy, 'nobody was working; the test proves nothing').toBe(true);
    expect(world.reservations.activeCount).toBeGreaterThan(0);

    expect(hashWorld(reload(sim).world)).toBe(hashWorld(sim.world));
  });

  it('keeps simulating identically after a reload', () => {
    // The stronger claim: a restored world isn't merely equal, it *behaves* the same.
    const original = colony();
    original.run(TICKS_PER_DAY);

    const restored = reload(original);
    original.run(5000);
    restored.run(5000);

    expect(hashWorld(restored.world)).toBe(hashWorld(original.world));
  });

  it('rebuilds derived indices rather than trusting the file', () => {
    const sim = colony();
    sim.run(2000);
    const restored = reload(sim);

    const pawn = [...restored.world.pawns.values()][0];
    expect(restored.world.reachability.canReach(pawn.pos, pawn.pos)).toBe(true);
    // Walk costs are derived from terrain on load, never stored.
    for (let i = 0; i < restored.world.map.size; i++) {
      expect(restored.world.map.walkCost[i]).toBe(sim.world.map.walkCost[i]);
    }
  });
});

describe('migration', () => {
  it('accepts a save at the current version', () => {
    const save = colony().save();
    expect(migrate(JSON.parse(JSON.stringify(save))).version).toBe(SAVE_VERSION);
  });

  it('refuses a save from a newer build rather than guessing', () => {
    const save = { ...colony().save(), version: SAVE_VERSION + 1 };
    expect(() => migrate(save)).toThrow(SaveVersionError);
  });

  it('refuses anything that is not a versioned save', () => {
    expect(() => migrate(null)).toThrow(SaveVersionError);
    expect(() => migrate({ nope: true })).toThrow(SaveVersionError);
  });
});

describe('a colony left alone for a week', () => {
  /*
   * The regression test that closes Slice 1.
   *
   * 420,000 ticks of needs, mood, plant growth, harvesting, eating, sleeping,
   * pathfinding, reservations and job scheduling — and it asserts the only thing that
   * actually matters: the colony is still there. Nothing but the sim/render firewall
   * makes a test like this possible.
   */
  it('is still alive after seven days', () => {
    const sim = colony();
    sim.run(SEVEN_DAYS);

    const survivors = [...sim.world.pawns.values()].filter((pawn) => !pawn.dead);
    expect(survivors).toHaveLength(3);
    for (const pawn of survivors) {
      expect(pawn.health, `${pawn.name} was hurt`).toBeGreaterThan(0.99);
      expect(pawn.needs[Need.Hunger], `${pawn.name} is starving`).toBeGreaterThan(0);
    }
  });

  it('has not leaked reservations over a week of work', () => {
    const sim = colony();
    sim.run(SEVEN_DAYS);
    // A single leaked claim compounds over hundreds of thousands of ticks.
    const living = [...sim.world.pawns.values()].filter((pawn) => !pawn.dead).length;
    expect(sim.world.reservations.activeCount).toBeLessThanOrEqual(living * 3);
  });

  it('reaches the same week whichever way it is run', () => {
    const straight = colony();
    straight.run(SEVEN_DAYS);

    // Saved and reloaded halfway, then run to the same point.
    const interrupted = colony();
    interrupted.run(SEVEN_DAYS / 2);
    const resumed = reload(interrupted);
    resumed.run(SEVEN_DAYS / 2);

    expect(hashWorld(resumed.world)).toBe(hashWorld(straight.world));
  });
});
