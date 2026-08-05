/**
 * Water rules.
 *
 * Water is the only terrain a colonist can *enter* but must not *use*, which makes it
 * the one place "passable" and "usable" come apart. Every one of these tests exists
 * because the first implementation conflated them and happily stored stone in a river.
 *
 * See docs/decisions/0004-water.md.
 */

import { describe, expect, it } from 'vitest';
import { endJob } from '../src/sim/ai/think';
import { pos } from '../src/sim/core/position';
import { ItemDef } from '../src/sim/defs/items';
import { Terrain, terrainDef } from '../src/sim/defs/terrain';
import { Simulation } from '../src/sim/simulation';
import type { World } from '../src/sim/world/world';

function yard() {
  const sim = new Simulation({ seed: 3, width: 40, height: 40, colonists: 1 });
  const world = sim.world;

  for (let y = 2; y <= 37; y++) {
    for (let x = 2; x <= 37; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  // A river down the middle: shallow banks around a deep channel.
  for (let y = 2; y <= 37; y++) {
    world.map.setTerrain(20, y, Terrain.ShallowWater);
    world.map.setTerrain(21, y, Terrain.DeepWater);
    world.map.setTerrain(22, y, Terrain.ShallowWater);
  }
  world.reachability.markDirty();

  return { sim, world };
}

function totalStone(world: World): number {
  let total = 0;
  for (const item of world.items.values()) {
    if (item.def === ItemDef.Stone) total += item.count;
  }
  return total;
}

describe('terrain definitions', () => {
  it('marks deep water impassable and shallow water merely slow', () => {
    expect(terrainDef(Terrain.DeepWater).walkCost).toBe(0);
    expect(terrainDef(Terrain.ShallowWater).walkCost).toBeGreaterThan(
      terrainDef(Terrain.Dirt).walkCost,
    );
  });

  it('marks no water as somewhere goods can be kept', () => {
    expect(terrainDef(Terrain.DeepWater).storable).toBe(false);
    expect(terrainDef(Terrain.ShallowWater).storable).toBe(false);
  });

  it('marks every dry passable terrain storable', () => {
    for (const def of [Terrain.Dirt, Terrain.Grass, Terrain.Sand, Terrain.Gravel, Terrain.RuinFloor]) {
      expect(terrainDef(def).storable, terrainDef(def).name).toBe(true);
    }
  });

  it('marks solid terrain unstorable, since nothing can stand there', () => {
    expect(terrainDef(Terrain.Rock).storable).toBe(false);
    expect(terrainDef(Terrain.RuinWall).storable).toBe(false);
  });
});

describe('stockpiles and water', () => {
  it('refuses to paint a stockpile on water', () => {
    const { sim, world } = yard();

    sim.dispatch({
      type: 'zone',
      action: 'stockpile',
      area: { x0: 20, y0: 10, x1: 22, y1: 12, z: 0 },
    });
    sim.flushCommands();

    expect(world.zones.stockpileCount).toBe(0);
  });

  it('still accepts the dry cells of a drag that crosses water', () => {
    // The player drags a rectangle over a river bank; the dry half should work rather
    // than the whole gesture silently doing nothing.
    const { sim, world } = yard();

    sim.dispatch({
      type: 'zone',
      action: 'stockpile',
      area: { x0: 18, y0: 10, x1: 22, y1: 10, z: 0 },
    });
    sim.flushCommands();

    expect(world.zones.stockpileCount).toBe(2); // x=18 and x=19; 20-22 are water.
    expect(world.zones.isStockpile(world.map.idx(18, 10))).toBe(true);
    expect(world.zones.isStockpile(world.map.idx(20, 10))).toBe(false);
  });
});

describe('items and water', () => {
  it('never spills mined goods into a river', () => {
    const { world } = yard();
    // A cell right on the bank, so the spill radius definitely reaches water.
    world.items.spawn(world.map, ItemDef.Stone, 300, pos(19, 10));

    for (const item of world.items.values()) {
      if (!item.pos) continue;
      const terrain = world.map.getTerrain(item.pos.x, item.pos.y);
      expect(terrain, `stone came to rest on ${terrainDef(terrain).name}`).not.toBe(
        Terrain.ShallowWater,
      );
    }
  });

  it('loses nothing while avoiding the water', () => {
    const { world } = yard();
    world.items.spawn(world.map, ItemDef.Stone, 300, pos(19, 10));
    expect(totalStone(world)).toBe(300);
  });

  it('puts goods on dry land when a colonist is interrupted mid-river', () => {
    /*
     * A pawn wading a ford and interrupted by a player order is standing *in* the water.
     * Dropping at their feet would put the stack in the river; deleting it would leak
     * resources. Neither is acceptable, so the drop searches outward for dry ground.
     */
    const { world } = yard();
    const pawn = [...world.pawns.values()][0];

    const [stack] = world.items.spawn(world.map, ItemDef.Stone, 10, pos(15, 10));
    world.items.beginCarry(stack, pawn.id, world.map);
    pawn.carryingItemId = stack.id;
    pawn.pos = pos(20, 10); // Mid-ford.

    endJob(world, pawn, 'interrupted');

    expect(pawn.carryingItemId).toBeNull();
    expect(totalStone(world)).toBe(10);

    const dropped = [...world.items.values()].find((item) => item.def === ItemDef.Stone);
    expect(dropped?.pos).toBeDefined();
    expect(world.map.getTerrain(dropped!.pos!.x, dropped!.pos!.y)).not.toBe(Terrain.ShallowWater);
  });
});

describe('movement and water', () => {
  it('lets colonists wade a shallow ford', () => {
    const { world } = yard();
    expect(world.map.isPassable(20, 10)).toBe(true);
    expect(world.reachability.canReach(pos(10, 10), pos(30, 10))).toBe(true);
  });

  it('does not let them cross the deep channel', () => {
    const { world } = yard();
    expect(world.map.isPassable(21, 10)).toBe(false);
  });

  it('makes a deep channel with no ford a genuine barrier', () => {
    // No swimming: deep water divides the map. That is the point — it gives terrain
    // shape and creates chokepoints that matter once raids arrive.
    const { world } = yard();
    for (let y = 0; y < world.map.height; y++) {
      world.map.setTerrain(20, y, Terrain.DeepWater);
      world.map.setTerrain(22, y, Terrain.DeepWater);
    }
    world.reachability.markDirty();

    expect(world.reachability.canReach(pos(10, 10), pos(30, 10))).toBe(false);
  });
});
