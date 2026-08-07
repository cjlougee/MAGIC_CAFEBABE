/**
 * M6's playable check, headless: **build a fire, place a bill, walk away, come back to
 * meals — and to a kitchen that stopped when it had enough.**
 *
 * The quota is the part worth guarding. A bench that cooks forever is not a production
 * system, it is a berry shredder.
 */

import { describe, expect, it } from 'vitest';
import { pos } from '../src/sim/core/position';
import { Building } from '../src/sim/defs/buildings';
import { ItemDef } from '../src/sim/defs/items';
import { Recipe, recipeDef } from '../src/sim/defs/recipes';
import { Terrain } from '../src/sim/defs/terrain';
import { Thought } from '../src/sim/defs/thoughts';
import { WorkType } from '../src/sim/defs/workTypes';
import { interrupt } from '../src/sim/ai/think';
import { Simulation } from '../src/sim/simulation';
import { createBuilding, type Building as BuildingEntity } from '../src/sim/entities/building';
import { countHeld } from '../src/sim/world/lookup';
import type { World } from '../src/sim/world/world';

/** A flat yard with a stocked larder and no bushes to distract anyone. */
function kitchen(colonists = 2) {
  const sim = new Simulation({ seed: 4242, width: 48, height: 48, colonists });
  const world = sim.world;

  for (const plant of [...world.plants.values()]) world.plants.remove(plant.id);

  for (let y = 2; y <= 45; y++) {
    for (let x = 2; x <= 45; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  world.reachability.markDirty();
  world.rooms.markDirty();

  const origin = world.landingSite;
  world.items.spawn(world.map, ItemDef.Stone, 200, pos(origin.x - 3, origin.y));
  world.items.spawn(world.map, ItemDef.RawFood, 200, pos(origin.x - 4, origin.y));

  return { sim, world, origin };
}

/** Raises a finished campfire immediately, without waiting for anyone to build it. */
function placeCampfire(world: World, at: { x: number; y: number; z: number }): BuildingEntity {
  const bench = world.buildings.add((id) => createBuilding(id, Building.Campfire, at));
  // Blocked the same way `completeConstruction` would have, so the cell behaves exactly
  // as it would if a colonist had raised the fire.
  world.map.setBuildingAt(world.map.idx(at.x, at.y, at.z), true, false);
  world.reachability.markDirty();
  world.rooms.markDirty();
  return bench;
}

function addBill(sim: Simulation, bench: BuildingEntity, recipe = Recipe.SimpleMeal) {
  sim.dispatch({ type: 'bill', action: 'add', bench: bench.id, recipe });
  sim.flushCommands();
}

function setQuota(sim: Simulation, bench: BuildingEntity, untilCount: number) {
  sim.dispatch({
    type: 'bill',
    action: 'setCount',
    bench: bench.id,
    recipe: Recipe.SimpleMeal,
    untilCount,
  });
  sim.flushCommands();
}

/** Nobody harvests, mines, or builds — this is a test about cooking. */
function cooksOnly(world: World) {
  for (const pawn of world.pawns.values()) {
    pawn.priorities[WorkType.Harvest] = 0;
    pawn.priorities[WorkType.Mine] = 0;
    pawn.priorities[WorkType.Construct] = 0;
    pawn.priorities[WorkType.Haul] = 0;
    pawn.priorities[WorkType.Cook] = 1;
  }
}

describe('a kitchen with a standing order', () => {
  it('turns raw food into meals', () => {
    const { sim, world, origin } = kitchen();
    cooksOnly(world);
    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);

    sim.run(20000);

    expect(countHeld(world, ItemDef.Meal)).toBeGreaterThan(0);
  });

  it('spends the ingredients it cooked with', () => {
    const { sim, world, origin } = kitchen();
    cooksOnly(world);
    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);

    const before = countHeld(world, ItemDef.RawFood);
    sim.run(20000);

    const meals = countHeld(world, ItemDef.Meal);
    const spent = before - countHeld(world, ItemDef.RawFood);
    const perMeal = recipeDef(Recipe.SimpleMeal).ingredients[0].count;

    // Colonists eat too, so the raw food spent is at least what the meals cost. The
    // point is that it went *down* by a plausible amount rather than staying put, which
    // would mean meals were being conjured.
    expect(meals).toBeGreaterThan(0);
    expect(spent).toBeGreaterThanOrEqual(meals * perMeal);
  });

  it('stops at the quota instead of cooking forever', () => {
    const { sim, world, origin } = kitchen();
    cooksOnly(world);
    // Nobody is hungry enough to eat the evidence during the run.
    for (const pawn of world.pawns.values()) pawn.needs[0] = 1;

    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);
    setQuota(sim, bench, 3);

    sim.run(40000);

    expect(countHeld(world, ItemDef.Meal)).toBe(3);
  });

  it('starts again when the meals are eaten below the quota', () => {
    const { sim, world, origin } = kitchen();
    cooksOnly(world);
    for (const pawn of world.pawns.values()) pawn.needs[0] = 1;

    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);
    setQuota(sim, bench, 3);
    sim.run(40000);
    expect(countHeld(world, ItemDef.Meal)).toBe(3);

    // Someone raids the larder.
    for (const item of [...world.items.values()]) {
      if (item.def === ItemDef.Meal) world.items.remove(item.id, world.map);
    }
    expect(countHeld(world, ItemDef.Meal)).toBe(0);

    sim.run(40000);
    expect(countHeld(world, ItemDef.Meal)).toBe(3);
  });

  it('does nothing at all with no bill on the bench', () => {
    const { sim, world, origin } = kitchen();
    cooksOnly(world);
    placeCampfire(world, pos(origin.x + 2, origin.y));

    sim.run(20000);

    expect(countHeld(world, ItemDef.Meal)).toBe(0);
  });

  it('never cooks for a colonist with Cook switched off', () => {
    const { sim, world, origin } = kitchen();
    cooksOnly(world);
    for (const pawn of world.pawns.values()) pawn.priorities[WorkType.Cook] = 0;

    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);

    sim.run(20000);

    expect(countHeld(world, ItemDef.Meal)).toBe(0);
  });
});

describe('stocking the bench', () => {
  it('loads ingredients before any labour happens', () => {
    const { sim, world, origin } = kitchen(1);
    cooksOnly(world);
    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);

    // Long enough to fetch, not long enough to have finished cooking.
    sim.run(600);

    const loadedOrCooked =
      bench.loaded[ItemDef.RawFood] > 0 || countHeld(world, ItemDef.Meal) > 0;
    expect(loadedOrCooked).toBe(true);
  });

  it('is Cook work, not Haul — a pure hauler ignores the bench', () => {
    // The distinction the whole design rests on: a blueprint is a public request, a
    // bill is the kitchen's own business. A colonist who only hauls must never be
    // pulled into fetching someone's ingredients.
    const { sim, world, origin } = kitchen(1);
    for (const pawn of world.pawns.values()) {
      pawn.priorities[WorkType.Harvest] = 0;
      pawn.priorities[WorkType.Mine] = 0;
      pawn.priorities[WorkType.Construct] = 0;
      pawn.priorities[WorkType.Cook] = 0;
      pawn.priorities[WorkType.Haul] = 1;
    }

    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);

    sim.run(20000);

    expect(bench.loaded[ItemDef.RawFood]).toBe(0);
    expect(countHeld(world, ItemDef.Meal)).toBe(0);
  });

  it('leaks no reservations once the kitchen settles', () => {
    const { sim, world, origin } = kitchen();
    cooksOnly(world);
    for (const pawn of world.pawns.values()) pawn.needs[0] = 1;

    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);
    setQuota(sim, bench, 2);

    sim.run(40000);

    // Not zero: a colonist asleep in a bedroll is *holding* it, which is a live claim
    // and not a leak. The same bound the week-long survival test uses.
    const living = [...world.pawns.values()].filter((pawn) => !pawn.dead).length;
    expect(world.reservations.activeCount).toBeLessThanOrEqual(living * 3);
  });
});

describe('ingredients are never lost', () => {
  it('come back when the last bill is removed', () => {
    const { sim, world, origin } = kitchen(1);
    cooksOnly(world);
    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);
    sim.run(600);

    const loaded = bench.loaded[ItemDef.RawFood];
    // Only meaningful if something actually got loaded.
    if (loaded === 0) return;

    const before = countHeld(world, ItemDef.RawFood);
    sim.dispatch({ type: 'bill', action: 'remove', bench: bench.id, recipe: Recipe.SimpleMeal });
    sim.flushCommands();

    expect(bench.loaded[ItemDef.RawFood]).toBe(0);
    expect(countHeld(world, ItemDef.RawFood)).toBe(before + loaded);
  });

  it('come back when a stocked bench is deconstructed', () => {
    const { sim, world, origin } = kitchen(1);
    cooksOnly(world);
    const at = pos(origin.x + 2, origin.y);
    const bench = placeCampfire(world, at);
    addBill(sim, bench);
    sim.run(600);

    const loaded = bench.loaded[ItemDef.RawFood];
    if (loaded === 0) return;

    // Stop the kitchen and the eating first, or the raw food this test is counting
    // drains into meals and colonists while the demolition is still being walked to —
    // and the assertion would be measuring lunch rather than salvage.
    for (const pawn of world.pawns.values()) {
      pawn.priorities[WorkType.Cook] = 0;
      pawn.priorities[WorkType.Construct] = 1;
      pawn.needs[0] = 1;
      // Priorities only gate the *next* job. A colonist already mid-craft would finish
      // it, turn the loaded berries into a meal, and leave this test measuring an empty
      // bench. Preemption is the tool for exactly that.
      interrupt(world, pawn, 'test setup');
    }

    const before = countHeld(world, ItemDef.RawFood);
    sim.dispatch({
      type: 'designate',
      action: 'deconstruct',
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(20000);

    expect(world.buildings.get(bench.id)).toBeUndefined();
    expect(countHeld(world, ItemDef.RawFood)).toBe(before + loaded);
  });
});

describe('eating what was cooked', () => {
  it('prefers a meal to raw food, and remembers it fondly', () => {
    const { sim, world, origin } = kitchen(1);
    for (const pawn of world.pawns.values()) {
      for (let i = 0; i < pawn.priorities.length; i++) pawn.priorities[i] = 0;
      // Hungry enough to go and eat right away.
      pawn.needs[0] = 0.1;
    }

    // A meal sits beside the larder, so distance cannot be what decides it.
    world.items.spawn(world.map, ItemDef.Meal, 5, pos(origin.x - 4, origin.y + 1));

    sim.run(4000);

    const pawn = [...world.pawns.values()][0];
    const remembered = pawn.memories.map((memory) => memory.def);
    expect(remembered).toContain(Thought.AteMeal);
    expect(remembered).not.toContain(Thought.AteRawFood);
  });
});

describe('bills survive a save', () => {
  it('keeps the quota and the loaded ingredients', () => {
    const { sim, world, origin } = kitchen(1);
    cooksOnly(world);
    const bench = placeCampfire(world, pos(origin.x + 2, origin.y));
    addBill(sim, bench);
    setQuota(sim, bench, 7);
    sim.run(600);

    const restored = new Simulation({ seed: 1, width: 8, height: 8, colonists: 1 });
    restored.load(sim.save());

    const reloaded = restored.world.buildings.get(bench.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.bills).toHaveLength(1);
    expect(reloaded!.bills[0].untilCount).toBe(7);
    expect(reloaded!.loaded[ItemDef.RawFood]).toBe(bench.loaded[ItemDef.RawFood]);
  });
});
