/**
 * M9's playable check, run headless: **a party goes somewhere and stays sent.**
 *
 * The bug this milestone exists to fix was invisible and total. A direct move order set
 * a path and nothing else, and `startJob` clears the path — so the first work giver to
 * reach that colonist threw the order away. Every direct order in the game had a
 * lifetime of one think interval, and the symptom was a colonist who set off and then
 * wandered back to hauling.
 */

import { describe, expect, it } from 'vitest';
import { THINK_INTERVAL } from '../src/sim/ai/think';
import { TICKS_PER_HOUR } from '../src/sim/core/constants';
import { pos } from '../src/sim/core/position';
import { ItemDef } from '../src/sim/defs/items';
import { Terrain } from '../src/sim/defs/terrain';
import { WorkType } from '../src/sim/defs/workTypes';
import { hashWorld } from '../src/sim/save/hash';
import { deserializeWorld, serializeWorld } from '../src/sim/save/serialize';
import { Simulation } from '../src/sim/simulation';
import type { World } from '../src/sim/world/world';

/** A clear yard with something to do in it, so "went back to work" is a real risk. */
function yard() {
  const sim = new Simulation({ seed: 20260809, width: 64, height: 64, colonists: 4 });
  const world = sim.world;

  for (let y = 2; y <= 61; y++) {
    for (let x = 2; x <= 61; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  world.reachability.markDirty();
  world.rooms.markDirty();

  // Loose stone everywhere gives every colonist a hauling job to be tempted by.
  for (let i = 0; i < 12; i++) {
    world.items.spawn(world.map, ItemDef.Stone, 10, pos(10 + i, 10));
  }
  // A *block* of stockpile, not one cell. Cell reservation is exclusive, so a
  // single-cell stockpile lets exactly one colonist haul at a time and every other
  // colonist correctly reports having nothing to do — which would make "did draft stop
  // them working?" unanswerable.
  for (let y = 40; y <= 44; y++) {
    for (let x = 40; x <= 44; x++) world.zones.addStockpile(world.map.idx(x, y));
  }

  return { sim, world };
}

function colonists(world: World) {
  return [...world.pawns.values()].filter((pawn) => !pawn.dead);
}

describe('the player character', () => {
  it('marks exactly one colonist, and the same one from the same seed', () => {
    const a = new Simulation({ seed: 4242, width: 64, height: 64, colonists: 4 }).world;
    const b = new Simulation({ seed: 4242, width: 64, height: 64, colonists: 4 }).world;

    const marked = colonists(a).filter((pawn) => pawn.playerCharacter);
    expect(marked).toHaveLength(1);

    expect(colonists(b).find((pawn) => pawn.playerCharacter)?.name).toBe(marked[0].name);
  });
});

describe('draft', () => {
  it('keeps a colonist walking to where they were sent', () => {
    /*
     * The regression test for the whole milestone. Before draft, this failed at tick 30:
     * the pawn was given a haul job, `startJob` cleared its path, and it never arrived.
     */
    const { sim, world } = yard();
    const pawn = colonists(world)[0];
    const target = pos(55, 55);

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target });
    sim.run(THINK_INTERVAL * 4);

    expect(pawn.drafted).toBe(true);
    expect(pawn.job, 'a drafted colonist took work anyway').toBeNull();

    sim.run(TICKS_PER_HOUR);
    expect(pawn.pos).toEqual(target);
  });

  it('takes no work at all, however urgent the priority grid says it is', () => {
    const { sim, world } = yard();
    const [drafted, free] = colonists(world);

    for (const pawn of colonists(world)) {
      pawn.priorities[WorkType.Haul] = 1;
    }

    sim.dispatch({ type: 'moveTo', pawnId: drafted.id, target: pos(30, 30) });
    sim.run(TICKS_PER_HOUR);

    expect(drafted.job).toBeNull();
    // The control: hauling really was available and somebody really did take it, so the
    // assertion above is about draft rather than about there being nothing to do.
    expect(free.drafted).toBe(false);
    expect(colonists(world).some((pawn) => pawn !== drafted && pawn.job !== null)).toBe(true);
  });

  it('resumes the order after a need pulls them off it', () => {
    /*
     * Why the target is stored rather than just pathed. Eating clears the path, so an
     * order that lived only in `pawn.path` would end wherever hunger struck.
     */
    const { sim, world } = yard();
    const pawn = colonists(world)[0];
    const target = pos(58, 58);

    world.items.spawn(world.map, ItemDef.RawFood, 20, pos(12, 12));
    pawn.needs[0] = 0.05; // Hungry enough to divert immediately.

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target });
    sim.run(TICKS_PER_HOUR * 3);

    expect(pawn.pos, 'stopped where it got hungry instead of resuming').toEqual(target);
    // Arriving clears the order, which is what stops `resumeDraftOrder` re-pathing a
    // pawn who is already standing on the spot forever.
    expect(pawn.draftTarget).toBeNull();
  });

  it('hands them back to the work pool when released', () => {
    const { sim, world } = yard();
    const pawn = colonists(world)[0];

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target: pos(30, 30) });
    sim.run(THINK_INTERVAL * 2);
    expect(pawn.drafted).toBe(true);

    sim.dispatch({ type: 'undraft', pawnId: pawn.id });
    sim.run(THINK_INTERVAL * 3);

    expect(pawn.drafted).toBe(false);
    expect(pawn.draftTarget).toBeNull();
    expect(pawn.job, 'released but still idle').not.toBeNull();
  });

  it('keeps an impossible order rather than dropping it silently', () => {
    /*
     * The M8 lesson applied. A colonist who cannot reach their target must remain
     * visibly under orders, because the alternative is one who quietly stands still and
     * a player with no way to find out why.
     */
    const { sim, world } = yard();
    const pawn = colonists(world)[0];

    // An island: reachable-looking ground with no route to it.
    for (let y = 18; y <= 24; y++) {
      for (let x = 18; x <= 24; x++) world.map.setTerrain(x, y, Terrain.Rock);
    }
    world.map.setTerrain(21, 21, Terrain.Dirt);
    world.reachability.markDirty();

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target: pos(21, 21) });
    sim.run(THINK_INTERVAL * 3);

    expect(pawn.draftTarget).toEqual(pos(21, 21));
    expect(sim.snapshot().alerts.some((alert) => alert.id === `unreachable:${pawn.id}`)).toBe(true);
  });
});

describe('a party', () => {
  it('sends everyone, and puts nobody on the same cell', () => {
    const { sim, world } = yard();
    const party = colonists(world);

    sim.dispatch({
      type: 'moveParty',
      pawnIds: party.map((pawn) => pawn.id),
      target: pos(50, 50),
    });
    sim.run(TICKS_PER_HOUR * 2);

    const cells = new Set(party.map((pawn) => `${pawn.pos.x},${pawn.pos.y}`));
    expect(cells.size, 'colonists stacked on one another').toBe(party.length);

    for (const pawn of party) {
      expect(pawn.drafted).toBe(true);
      const away = Math.hypot(pawn.pos.x - 50, pawn.pos.y - 50);
      expect(away, `${pawn.name} is ${away.toFixed(1)} tiles from the rendezvous`).toBeLessThan(7);
    }
  });

  it('arranges the same party the same way from the same order', () => {
    // The fan-out draws no randomness, so it must be reproducible — it is part of world
    // state the moment it decides who walks where.
    const run = () => {
      const { sim, world } = yard();
      const ids = colonists(world).map((pawn) => pawn.id);
      sim.dispatch({ type: 'moveParty', pawnIds: ids, target: pos(50, 50) });
      sim.run(TICKS_PER_HOUR);
      return hashWorld(world);
    };

    expect(run()).toBe(run());
  });
});

describe('saving a party mid-journey', () => {
  it('restores the standing order and finishes the walk', () => {
    const { sim, world } = yard();
    const pawn = colonists(world)[0];
    const target = pos(58, 20);

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target });
    sim.run(THINK_INTERVAL * 2);

    const restored = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    expect(hashWorld(restored)).toBe(hashWorld(world));

    const revived = [...restored.pawns.values()].find((other) => other.id === pawn.id);
    expect(revived?.drafted).toBe(true);
    expect(revived?.draftTarget).toEqual(target);
  });
});
