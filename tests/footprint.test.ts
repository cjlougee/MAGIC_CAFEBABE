/**
 * M10's playable check, headless: **a building may be bigger than a cell.**
 *
 * The interesting assertions are the ones about *every* cell rather than the anchor —
 * blocking, marking, refunding and legality all used to ask about one cell and be right
 * by accident. A 2x1 bedroll cannot catch any of that on its own, which is why the 2x2
 * hearth exists.
 */

import { describe, expect, it } from 'vitest';
import { pos } from '../src/sim/core/position';
import { Buildable } from '../src/sim/defs/buildables';
import { Building } from '../src/sim/defs/buildings';
import { ItemDef } from '../src/sim/defs/items';
import { Terrain } from '../src/sim/defs/terrain';
import { buildingCells } from '../src/sim/entities/building';
import { hashWorld } from '../src/sim/save/hash';
import { migrate } from '../src/sim/save/migrate';
import { deserializeWorld, serializeWorld } from '../src/sim/save/serialize';
import { Simulation } from '../src/sim/simulation';
import { Designation } from '../src/sim/world/designations';
import {
  anchorFor,
  cellsAdjacentTo,
  cellsOf,
  footprintOfBuilding,
  headCellOf,
  isAdjacentToFootprint,
  sizeOf,
  type Rotation,
} from '../src/sim/world/footprint';
import { buildingAt, siteAt } from '../src/sim/world/lookup';
import { canPlaceFootprint } from '../src/sim/world/placement';
import type { World } from '../src/sim/world/world';

/** A flat cleared yard with materials to hand, and nothing to distract colonists. */
function yard(colonists = 3) {
  const sim = new Simulation({ seed: 909, width: 48, height: 48, colonists });
  const world = sim.world;

  for (const plant of [...world.plants.values()]) world.plants.remove(plant.id);
  for (const building of [...world.buildings.values()]) world.buildings.remove(building.id);

  // Cleared right to the edge, so a test about running off the map is testing the bounds
  // check rather than whatever terrain happened to generate out there.
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) world.map.setTerrain(x, y, Terrain.Dirt);
  }
  world.map.buildingBlocks.fill(0);
  world.map.buildingSealsRoom.fill(0);
  world.reachability.markDirty();
  world.rooms.markDirty();

  const site = world.landingSite;
  world.items.spawn(world.map, ItemDef.Stone, 600, pos(site.x - 3, site.y));
  world.items.spawn(world.map, ItemDef.Scrap, 120, pos(site.x - 4, site.y));

  return { sim, world };
}

function blocksAt(world: World, x: number, y: number): boolean {
  return !world.map.isPassable(x, y, 0);
}

/** Raises a finished structure immediately, the way the debug panel does. */
function placeFinished(sim: Simulation, buildable: number, x: number, y: number, rotation: Rotation = 0) {
  sim.dispatch({
    type: 'build',
    buildable: buildable as never,
    area: { x0: x, y0: y, x1: x, y1: y, z: 0 },
    rotation,
    instant: true,
  });
  sim.tick();
}

describe('footprint arithmetic', () => {
  const twoByOne = { w: 2, h: 1 };

  it('swaps the axes on odd quarter turns', () => {
    expect(sizeOf(twoByOne, 0)).toEqual({ w: 2, h: 1 });
    expect(sizeOf(twoByOne, 1)).toEqual({ w: 1, h: 2 });
    expect(sizeOf(twoByOne, 2)).toEqual({ w: 2, h: 1 });
    expect(sizeOf(twoByOne, 3)).toEqual({ w: 1, h: 2 });
  });

  it('gives rotations 0 and 2 identical cells, and 1 and 3 identical cells', () => {
    const anchor = pos(10, 10);
    expect(cellsOf(anchor, twoByOne, 0)).toEqual(cellsOf(anchor, twoByOne, 2));
    expect(cellsOf(anchor, twoByOne, 1)).toEqual(cellsOf(anchor, twoByOne, 3));
    // ...and the two pairs differ from each other, or rotation would be decoration.
    expect(cellsOf(anchor, twoByOne, 0)).not.toEqual(cellsOf(anchor, twoByOne, 1));
  });

  it('puts the head at opposite ends for rotations that share cells', () => {
    const anchor = pos(10, 10);
    expect(headCellOf(anchor, twoByOne, 0)).toEqual(pos(10, 10));
    expect(headCellOf(anchor, twoByOne, 2)).toEqual(pos(11, 10));
    expect(headCellOf(anchor, twoByOne, 1)).toEqual(pos(10, 10));
    expect(headCellOf(anchor, twoByOne, 3)).toEqual(pos(10, 11));
  });

  it('never counts a footprint cell as adjacent to the footprint', () => {
    const cells = cellsOf(pos(10, 10), { w: 2, h: 2 }, 0);
    for (const cell of cellsAdjacentTo(cells)) {
      expect(cells.some((c) => c.x === cell.x && c.y === cell.y)).toBe(false);
    }
    // A 2x2 has twelve neighbours; a naive per-cell sweep would report duplicates.
    expect(cellsAdjacentTo(cells)).toHaveLength(12);
  });

  it('refuses to call standing on one end of a bed "beside" it', () => {
    const cells = cellsOf(pos(10, 10), twoByOne, 0);
    // On the far cell — genuinely adjacent to the other one, and still not beside it.
    expect(isAdjacentToFootprint(pos(11, 10), cells)).toBe(false);
    expect(isAdjacentToFootprint(pos(10, 10), cells)).toBe(false);
    expect(isAdjacentToFootprint(pos(9, 10), cells)).toBe(true);
    // Diagonally off the far end still counts; two cells clear does not.
    expect(isAdjacentToFootprint(pos(12, 11), cells)).toBe(true);
    expect(isAdjacentToFootprint(pos(13, 10), cells)).toBe(false);
  });
});

describe('turning something keeps turning it the same way', () => {
  /*
   * The complaint this exists for: rotating a desk *felt* like it flipped back and forth
   * rather than going round.
   *
   * Every part of the old behaviour was correct. The anchor is the minimum corner, so
   * rotations 0 and 2 cover identical cells and differ only in facing — so pressing E four
   * times sent the far cell east, south, east, south while the sprite mirrored underneath.
   * Nothing was wrong except that a player turning something expects it to keep going the
   * same way round, and it did not.
   *
   * Pivoting on the *facing* cell fixes it without the simulation changing at all: the
   * stored anchor is still the minimum corner and no save changes meaning.
   */
  const BED = footprintOfBuilding(Building.Bed);
  const pivot = pos(10, 10);

  /** Where the far end of a 2×1 sits, relative to the cell under the cursor. */
  function farEnd(rotation: Rotation) {
    const anchor = anchorFor(pivot, BED, rotation);
    const far = cellsOf(anchor, BED, rotation).find(
      (cell) => cell.x !== pivot.x || cell.y !== pivot.y,
    )!;
    return { dx: far.x - pivot.x, dy: far.y - pivot.y };
  }

  it('sends the far end round the compass, a quarter turn at a time', () => {
    expect([0, 1, 2, 3].map((r) => farEnd(r as Rotation))).toEqual([
      { dx: 1, dy: 0 }, // east
      { dx: 0, dy: 1 }, // south
      { dx: -1, dy: 0 }, // west
      { dx: 0, dy: -1 }, // north
    ]);
  });

  it('never leaves the pivot cell', () => {
    // The thing the player is pointing at is the thing that stays put. Without this the
    // whole structure jumps sideways as it turns, which is the other way to make a
    // rotation control feel wrong.
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      const anchor = anchorFor(pivot, BED, rotation);
      const cells = cellsOf(anchor, BED, rotation);
      expect(
        cells.some((cell) => cell.x === pivot.x && cell.y === pivot.y),
        `rotation ${rotation} moved the structure off the cursor`,
      ).toBe(true);
    }
  });

  it('pivots on the facing cell, so a bed turns about its pillow', () => {
    // `anchorFor` is the exact inverse of `headCellOf`, which is what makes the cell the
    // player points at the cell the colonist's head ends up on.
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      const anchor = anchorFor(pivot, BED, rotation);
      expect(headCellOf(anchor, BED, rotation)).toEqual(pivot);
    }
  });

  it('is a no-op for anything one cell across', () => {
    // Walls are dragged out in runs, and shifting their anchor by rotation would move a
    // whole drag off the cells the player swept.
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      expect(anchorFor(pivot, footprintOfBuilding(Building.Wall), rotation)).toEqual(pivot);
    }
  });
});

describe('placing something bigger than a cell', () => {
  it('refuses when any one cell is unavailable', () => {
    const { sim, world } = yard();
    placeFinished(sim, Buildable.Wall, 20, 20);

    // The hearth's anchor is clear; its far cell is not. One cell of overlap is enough.
    expect(canPlaceFootprint(world, pos(19, 19), Buildable.Hearth, 0)).toBe(false);
    expect(canPlaceFootprint(world, pos(21, 21), Buildable.Hearth, 0)).toBe(true);
  });

  it('refuses a footprint that runs off the map', () => {
    const { world } = yard();
    const edge = world.map.width - 1;
    expect(canPlaceFootprint(world, pos(edge, 20), Buildable.Bed, 0)).toBe(false);
    expect(canPlaceFootprint(world, pos(edge - 1, 20), Buildable.Bed, 0)).toBe(true);
  });

  it('refuses a footprint half in the water', () => {
    const { world } = yard();
    world.map.setTerrain(31, 20, Terrain.DeepWater);
    world.reachability.markDirty();

    expect(canPlaceFootprint(world, pos(30, 20), Buildable.Bed, 0)).toBe(false);
    // Turned a quarter, the same anchor clears the water entirely.
    expect(canPlaceFootprint(world, pos(30, 20), Buildable.Bed, 1)).toBe(true);
  });

  it('reports the same building from every cell it stands on', () => {
    const { sim, world } = yard();
    placeFinished(sim, Buildable.Hearth, 20, 20);

    const ids = new Set<number>();
    for (const [x, y] of [[20, 20], [21, 20], [20, 21], [21, 21]]) {
      const building = buildingAt(world, world.map.idx(x, y, 0));
      expect(building, `no building at ${x},${y}`).toBeDefined();
      ids.add(building!.id);
    }
    expect(ids.size).toBe(1);
    expect(buildingAt(world, world.map.idx(22, 20, 0))).toBeUndefined();
  });

  it('blocks every cell an impassable structure stands on', () => {
    const { sim, world } = yard();
    placeFinished(sim, Buildable.Hearth, 20, 20);

    for (const [x, y] of [[20, 20], [21, 20], [20, 21], [21, 21]]) {
      expect(blocksAt(world, x, y), `${x},${y} should block`).toBe(true);
    }
    expect(blocksAt(world, 22, 20)).toBe(false);
  });

  it('leaves a passable structure passable on both cells', () => {
    const { sim, world } = yard();
    placeFinished(sim, Buildable.Bed, 20, 20);

    expect(blocksAt(world, 20, 20)).toBe(false);
    expect(blocksAt(world, 21, 20)).toBe(false);
  });

  it('occupies every cell against a second blueprint', () => {
    const { sim, world } = yard();
    sim.dispatch({
      type: 'build',
      buildable: Buildable.Hearth,
      area: { x0: 20, y0: 20, x1: 20, y1: 20, z: 0 },
      rotation: 0,
    });
    sim.tick();

    expect(siteAt(world, world.map.idx(21, 21, 0))).toBeDefined();
    expect(canPlaceFootprint(world, pos(21, 21), Buildable.Bed, 0)).toBe(false);
  });
});

describe('a solid thing inside a room', () => {
  /** A 7x7 hut with a door, raised instantly, and whatever is put inside it. */
  function hutWith(place?: (sim: Simulation) => void) {
    const { sim, world } = yard(1);
    const x0 = 15;
    const y0 = 15;

    for (let x = x0; x <= x0 + 6; x++) {
      for (const y of [y0, y0 + 6]) placeFinished(sim, Buildable.Wall, x, y);
    }
    for (let y = y0 + 1; y <= y0 + 5; y++) {
      for (const x of [x0, x0 + 6]) placeFinished(sim, Buildable.Wall, x, y);
    }
    placeFinished(sim, Buildable.Door, x0 + 3, y0);

    place?.(sim);
    return { sim, world, inside: pos(x0 + 1, y0 + 1), far: pos(x0 + 5, y0 + 5) };
  }

  it('counts as one room before anything is put in it', () => {
    const { world, inside } = hutWith();
    expect(world.rooms.isIndoors(inside)).toBe(true);
  });

  it('does not cut the room in two', () => {
    // The whole reason `blocksRoom` and `passable` are separate flags, now across four
    // cells: a hearth in the middle of a hut is solid and is not a wall.
    const { world, inside, far } = hutWith((sim) => placeFinished(sim, Buildable.Hearth, 18, 18));

    expect(world.rooms.isIndoors(inside)).toBe(true);
    expect(world.rooms.isIndoors(far)).toBe(true);
    expect(world.rooms.roomAt(inside)).toBe(world.rooms.roomAt(far));
  });
});

describe('taking a multi-tile structure down', () => {
  it('marks the whole footprint from one marked cell', () => {
    const { sim, world } = yard();
    placeFinished(sim, Buildable.Hearth, 20, 20);

    sim.dispatch({
      type: 'designate',
      action: 'deconstruct',
      area: { x0: 21, y0: 21, x1: 21, y1: 21, z: 0 },
    });
    sim.tick();

    for (const [x, y] of [[20, 20], [21, 20], [20, 21], [21, 21]]) {
      expect(
        world.designations.has(Designation.Deconstruct, world.map.idx(x, y, 0)),
        `${x},${y} should be marked`,
      ).toBe(true);
    }
  });

  it('clears the whole footprint and refunds once', () => {
    const { sim, world } = yard(2);
    placeFinished(sim, Buildable.Hearth, 20, 20);

    const before = countStone(world);
    sim.dispatch({
      type: 'designate',
      action: 'deconstruct',
      area: { x0: 20, y0: 20, x1: 20, y1: 20, z: 0 },
    });
    for (let i = 0; i < 4000 && world.buildings.size > 0; i++) sim.tick();

    expect(world.buildings.size).toBe(0);
    for (const [x, y] of [[20, 20], [21, 20], [20, 21], [21, 21]]) {
      expect(blocksAt(world, x, y), `${x},${y} should be clear`).toBe(false);
    }
    // Twenty-four stone, half back, once — not once per cell.
    expect(countStone(world) - before).toBe(12);
  });
});

describe('colonists and footprints', () => {
  it('builds a bed from beside it, never on it', () => {
    const { sim, world } = yard(2);
    sim.dispatch({
      type: 'build',
      buildable: Buildable.Bed,
      area: { x0: 20, y0: 20, x1: 20, y1: 20, z: 0 },
      rotation: 0,
    });

    const cells = [pos(20, 20), pos(21, 20)];
    let built = false;
    for (let i = 0; i < 20000 && !built; i++) {
      sim.tick();
      for (const pawn of world.pawns.values()) {
        // A pawn may legitimately *walk* across a site; what must never happen is a pawn
        // standing on one while it completes. The completion check is the assertion.
        expect(pawn.pos).toBeDefined();
      }
      built = [...world.buildings.values()].some((b) => b.def === Building.Bed);
    }

    expect(built, 'the bed was never built').toBe(true);
    const bed = [...world.buildings.values()].find((b) => b.def === Building.Bed)!;
    expect(buildingCells(bed).map((c) => `${c.x},${c.y}`)).toEqual(
      cells.map((c) => `${c.x},${c.y}`),
    );
  });

  it('sleeps at the head of the bed, which moves with the rotation', () => {
    const { sim, world } = yard(1);
    placeFinished(sim, Buildable.Bed, 20, 20, 2);

    const bed = [...world.buildings.values()].find((b) => b.def === Building.Bed)!;
    expect(headCellOf(bed.pos, footprintOfBuilding(bed.def), bed.rotation)).toEqual(pos(21, 20));
  });
});

describe('saving a rotation', () => {
  it('round-trips rotation and footprint', () => {
    const { sim, world } = yard();
    placeFinished(sim, Buildable.Bed, 20, 20, 3);

    const restored = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    expect(hashWorld(restored)).toBe(hashWorld(world));

    const bed = [...restored.buildings.values()].find((b) => b.def === Building.Bed)!;
    expect(bed.rotation).toBe(3);
    expect(buildingCells(bed)).toEqual([pos(20, 20), pos(20, 21)]);
  });

  it('notices a rotation that came back wrong', () => {
    // Rotations 1 and 3 cover identical cells, so *everything else* about the world
    // would match. Without rotation in the hash this test passes while guarding nothing.
    const { sim, world } = yard();
    placeFinished(sim, Buildable.Bed, 20, 20, 3);

    const save = JSON.parse(JSON.stringify(serializeWorld(world)));
    const bed = save.buildings.find((b: { def: number }) => b.def === Building.Bed);
    bed.rotation = 1;

    expect(hashWorld(deserializeWorld(save))).not.toBe(hashWorld(world));
  });
});

describe('migrating a colony that predates footprints', () => {
  /** A minimal v5 save with one bedroll and whatever walls the test asks for. */
  function v5Save(walls: readonly (readonly [number, number])[]) {
    const width = 8;
    const height = 8;
    const blocks = new Array(width * height).fill(0);
    for (const [x, y] of walls) blocks[y * width + x] = 1;

    return {
      version: 5,
      seed: 1,
      tick: 0,
      rng: { a: 1, b: 2, c: 3, d: 4 },
      map: {
        width,
        height,
        levels: 1,
        terrain: [3, width * height],
        natural: [3, width * height],
        blocks: rle(blocks),
        seals: [0, width * height],
      },
      landingSite: { x: 4, y: 4, z: 0 },
      pawns: [],
      nextPawnId: 1,
      items: [],
      nextItemId: 1,
      plants: [],
      nextPlantId: 1,
      buildings: [
        { id: 1, def: 0, pos: { x: 2, y: 2, z: 0 }, owner: null, bills: [], loaded: [] },
      ],
      nextBuildingId: 2,
      sites: [],
      nextSiteId: 1,
      pois: [],
      nextPoiId: 1,
      mineDesignations: [],
      deconstructDesignations: [],
      stockpiles: [],
      reservations: { cells: [], entities: [] },
    };
  }

  it('leaves a bedroll alone when there is room to widen east', () => {
    const migrated = migrate(v5Save([]));
    expect(migrated.buildings[0].rotation).toBe(0);
  });

  it('turns a bedroll rather than widening it into a wall', () => {
    // The wall the player built to the east after landing — the case that makes this
    // migration more than "set every rotation to zero".
    const migrated = migrate(v5Save([[3, 2]]));
    expect(migrated.buildings[0].rotation).toBe(1);
  });

  it('accepts the overlap when both directions are blocked', () => {
    const migrated = migrate(v5Save([[3, 2], [2, 3]]));
    expect(migrated.buildings[0].rotation).toBe(0);
  });
});

function countStone(world: World): number {
  let total = 0;
  for (const item of world.items.values()) {
    if (item.def === ItemDef.Stone) total += item.count;
  }
  return total;
}

function rle(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (out.length >= 2 && out[out.length - 2] === value) out[out.length - 1]++;
    else out.push(value, 1);
  }
  return out;
}

describe('barring a door', () => {
  /** A hut with one door, raised instantly, and the cell inside it. */
  function hutWithDoor() {
    const { sim, world } = yard(1);
    const x0 = 15;
    const y0 = 15;

    for (let x = x0; x <= x0 + 4; x++) {
      // The doorway is left as a gap; walling it first would mean the door is refused
      // and the whole hut silently has no way in.
      if (x !== x0 + 2) placeFinished(sim, Buildable.Wall, x, y0);
      placeFinished(sim, Buildable.Wall, x, y0 + 4);
    }
    for (let y = y0 + 1; y <= y0 + 3; y++) {
      for (const x of [x0, x0 + 4]) placeFinished(sim, Buildable.Wall, x, y);
    }
    placeFinished(sim, Buildable.Door, x0 + 2, y0);

    const door = [...world.buildings.values()].find((b) => b.def === Building.Door)!;
    return { sim, world, door, inside: pos(x0 + 2, y0 + 1), outside: pos(x0 + 2, y0 - 2) };
  }

  function lock(sim: Simulation, door: { id: number }, locked: boolean) {
    sim.dispatch({ type: 'setLocked', building: door.id, locked });
    sim.tick();
  }

  it('lets colonists through until it is barred', () => {
    const { sim, world, door, inside, outside } = hutWithDoor();
    expect(world.reachability.canReach(outside, inside)).toBe(true);

    lock(sim, door, true);
    expect(world.reachability.canReach(outside, inside)).toBe(false);

    lock(sim, door, false);
    expect(world.reachability.canReach(outside, inside)).toBe(true);
  });

  it('still seals the room when barred', () => {
    // The whole reason `blocksRoom` and `passable` are separate flags. A locked door that
    // stopped sealing would silently take the roof away from everyone sleeping inside.
    const { sim, world, door, inside } = hutWithDoor();
    expect(world.rooms.isIndoors(inside)).toBe(true);

    lock(sim, door, true);
    expect(world.rooms.isIndoors(inside)).toBe(true);
  });

  it('says out loud when it cuts a colonist off', () => {
    // The quietest failure in the game, and M11 adds a way to cause it on purpose.
    const { sim, world, door, inside } = hutWithDoor();
    const pawn = [...world.pawns.values()][0];
    pawn.pos = { ...inside };
    world.reachability.markDirty();

    expect(sim.snapshot().alerts.some((a) => a.id === `cutoff:${pawn.id}`)).toBe(false);

    lock(sim, door, true);
    expect(sim.snapshot().alerts.some((a) => a.id === `cutoff:${pawn.id}`)).toBe(true);
  });

  it('refuses to bar anything that is not lockable', () => {
    const { sim, world } = yard(1);
    placeFinished(sim, Buildable.Wall, 20, 20);
    const wall = [...world.buildings.values()][0];

    sim.dispatch({ type: 'setLocked', building: wall.id, locked: true });
    sim.tick();

    expect(wall.locked).toBe(false);
  });

  it('round-trips a barred door, and notices one that comes back open', () => {
    const { sim, world, door } = hutWithDoor();
    lock(sim, door, true);

    const save = JSON.parse(JSON.stringify(serializeWorld(world)));
    expect(hashWorld(deserializeWorld(save))).toBe(hashWorld(world));

    const saved = save.buildings.find((b: { id: number }) => b.id === door.id);
    saved.locked = false;
    expect(hashWorld(deserializeWorld(save))).not.toBe(hashWorld(world));
  });
});

describe('a door lines up with its wall', () => {
  it('faces along the run it interrupts', () => {
    const { sim, world } = yard(1);

    // A run along x, with a gap for the door.
    for (const x of [19, 21]) placeFinished(sim, Buildable.Wall, x, 20);
    placeFinished(sim, Buildable.Door, 20, 20);
    const alongX = [...world.buildings.values()].find((b) => b.def === Building.Door)!;
    expect(alongX.rotation).toBe(0);

    // And a run along y, placed with the same default rotation of 0.
    for (const y of [29, 31]) placeFinished(sim, Buildable.Wall, 30, y);
    placeFinished(sim, Buildable.Door, 30, 30);
    const alongY = [...world.buildings.values()].filter((b) => b.def === Building.Door)[1];
    expect(alongY.rotation).toBe(1);
  });

  it('leaves a free-standing door as asked', () => {
    const { sim, world } = yard(1);
    placeFinished(sim, Buildable.Door, 20, 20, 1);
    const door = [...world.buildings.values()].find((b) => b.def === Building.Door)!;
    expect(door.rotation).toBe(1);
  });
});
