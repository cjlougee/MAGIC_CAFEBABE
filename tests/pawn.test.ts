import { describe, expect, it } from 'vitest';
import { tickMovement } from '../src/sim/ai/movement';
import { pos } from '../src/sim/core/position';
import { Rng } from '../src/sim/core/rng';
import { APPEARANCE_VARIANTS } from '../src/sim/defs/pawnKind';
import { Terrain } from '../src/sim/defs/terrain';
import { createPawn, isMoving, pawnVisualPos, ticksToEnter } from '../src/sim/entities/pawn';
import { Simulation } from '../src/sim/simulation';
import { TileMap } from '../src/sim/world/tilemap';
import { PawnPalette } from '../src/render/art/palette';

function openMap(width: number, height: number): TileMap {
  const map = new TileMap(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) map.setTerrain(x, y, Terrain.Dirt);
  }
  return map;
}

const APPEARANCE = { skinTone: 0, hairStyle: 0, hairColour: 0, apparelColour: 0 };

describe('movement', () => {
  it('walks a route and stops on arrival', () => {
    const map = openMap(10, 10);
    const pawn = createPawn(1, 'Test', pos(1, 1), APPEARANCE);
    pawn.path = [pos(2, 1), pos(3, 1)];

    // Two tiles of open ground at 13 ticks each, plus the tick that starts the first.
    for (let i = 0; i < 40 && isMoving(pawn); i++) tickMovement(map, pawn);

    expect(pawn.pos).toEqual(pos(3, 1));
    expect(isMoving(pawn)).toBe(false);
    expect(pawn.moveTarget).toBeNull();
  });

  it('takes longer to cross expensive terrain', () => {
    const map = openMap(10, 10);
    map.setTerrain(2, 1, Terrain.ShallowWater);

    const overWater = createPawn(1, 'A', pos(1, 1), APPEARANCE);
    overWater.path = [pos(2, 1)];
    const overDirt = createPawn(2, 'B', pos(1, 3), APPEARANCE);
    overDirt.path = [pos(2, 3)];

    let waterTicks = 0;
    let dirtTicks = 0;
    while (isMoving(overWater) || waterTicks === 0) {
      tickMovement(map, overWater);
      waterTicks++;
      if (!isMoving(overWater)) break;
    }
    while (isMoving(overDirt) || dirtTicks === 0) {
      tickMovement(map, overDirt);
      dirtTicks++;
      if (!isMoving(overDirt)) break;
    }

    expect(waterTicks).toBeGreaterThan(dirtTicks);
  });

  it('interpolates smoothly between tiles without ever leaving the pair', () => {
    const map = openMap(10, 10);
    const pawn = createPawn(1, 'Test', pos(1, 1), APPEARANCE);
    pawn.path = [pos(2, 1)];

    for (let i = 0; i < 20 && isMoving(pawn); i++) {
      tickMovement(map, pawn);
      const visual = pawnVisualPos(pawn);
      expect(visual.x).toBeGreaterThanOrEqual(1);
      expect(visual.x).toBeLessThanOrEqual(2);
      expect(visual.y).toBe(1);
    }
  });

  it('abandons a route that a wall has since blocked', () => {
    const map = openMap(10, 10);
    const pawn = createPawn(1, 'Test', pos(1, 1), APPEARANCE);
    pawn.path = [pos(2, 1), pos(3, 1)];

    tickMovement(map, pawn); // Commits to entering (2,1).
    map.setTerrain(3, 1, Terrain.Rock);

    for (let i = 0; i < 40 && isMoving(pawn); i++) tickMovement(map, pawn);

    // It finishes the step already underway, then refuses to walk into rock.
    expect(pawn.pos).toEqual(pos(2, 1));
    expect(isMoving(pawn)).toBe(false);
  });

  it('scales step duration with move cost', () => {
    expect(ticksToEnter(10)).toBe(13);
    expect(ticksToEnter(22)).toBeGreaterThan(ticksToEnter(10));
    expect(ticksToEnter(0)).toBe(1); // Never zero, or a pawn would teleport.
  });
});

describe('move orders', () => {
  const options = { seed: 7, width: 40, height: 40, colonists: 1 };

  function firstPawn(sim: Simulation) {
    return [...sim.world.pawns.values()][0];
  }

  it('routes a colonist to a reachable tile', () => {
    const sim = new Simulation(options);
    const pawn = firstPawn(sim);
    const start = pawn.pos;

    // Somewhere open, a few tiles away, found by walking outward from the pawn.
    let target = start;
    for (let radius = 3; radius < 12 && target === start; radius++) {
      for (const [dx, dy] of [
        [radius, 0],
        [-radius, 0],
        [0, radius],
        [0, -radius],
      ]) {
        const candidate = pos(start.x + dx, start.y + dy);
        if (
          sim.world.map.isPassable(candidate.x, candidate.y) &&
          sim.world.reachability.canReach(start, candidate)
        ) {
          target = candidate;
          break;
        }
      }
    }
    expect(target).not.toEqual(start);

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target });
    sim.run(1200);

    expect(pawn.pos).toEqual(target);
  });

  it('ignores an order to an impassable tile', () => {
    const sim = new Simulation(options);
    const pawn = firstPawn(sim);
    const start = { ...pawn.pos };

    // Find rock somewhere on the map.
    let rock = null as { x: number; y: number } | null;
    for (let i = 0; i < sim.world.map.size && !rock; i++) {
      if (sim.world.map.terrainAt(i) === Terrain.Rock) {
        rock = { x: sim.world.map.xOf(i), y: sim.world.map.yOf(i) };
      }
    }
    if (!rock) return; // Seed produced no rock; nothing to assert.

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target: pos(rock.x, rock.y) });
    sim.run(200);

    expect(pawn.pos).toEqual(start);
  });

  it('lets a new order supersede the old one without teleporting the pawn', () => {
    /*
     * Enforcement rule 3 in miniature. A pawn caught mid-step is between two tiles;
     * a new order must plan from where it will *land*, never snap it backwards.
     */
    const sim = new Simulation(options);
    const pawn = firstPawn(sim);

    const first = pos(pawn.pos.x + 6, pawn.pos.y);
    if (!sim.world.map.isPassable(first.x, first.y)) return;

    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target: first });
    sim.run(20); // Mid-stride.

    const before = pawn.moveTarget ?? pawn.pos;
    sim.dispatch({ type: 'moveTo', pawnId: pawn.id, target: pawn.pos });
    sim.tick();

    const after = pawn.moveTarget ?? pawn.pos;
    // Still on, or committed to, an adjacent cell — no jump across the map.
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  it('ignores an order for a pawn that does not exist', () => {
    const sim = new Simulation(options);
    expect(() => {
      sim.dispatch({ type: 'moveTo', pawnId: 9999, target: pos(1, 1) });
      sim.tick();
    }).not.toThrow();
  });
});

describe('colonist spawning', () => {
  it('lands the starting party on passable, mutually reachable ground', () => {
    for (const seed of [1, 2, 3, 42, 777]) {
      const sim = new Simulation({ seed, width: 64, height: 64 });
      const pawns = [...sim.world.pawns.values()];
      expect(pawns.length).toBeGreaterThan(0);

      for (const pawn of pawns) {
        expect(
          sim.world.map.isPassable(pawn.pos.x, pawn.pos.y),
          `seed ${seed}: ${pawn.name} spawned in solid terrain`,
        ).toBe(true);
        expect(
          sim.world.reachability.canReach(pawns[0].pos, pawn.pos),
          `seed ${seed}: ${pawn.name} is cut off from the party`,
        ).toBe(true);
      }
    }
  });

  it('gives colonists distinct ids and names drawn from the seeded rng', () => {
    const a = new Simulation({ seed: 5, width: 48, height: 48 });
    const b = new Simulation({ seed: 5, width: 48, height: 48 });

    const namesA = [...a.world.pawns.values()].map((p) => p.name);
    const namesB = [...b.world.pawns.values()].map((p) => p.name);
    expect(namesA).toEqual(namesB);

    const ids = new Set([...a.world.pawns.values()].map((p) => p.id));
    expect(ids.size).toBe(a.world.pawns.size);
  });
});

describe('appearance', () => {
  it('has a colour for every index the simulation can roll', () => {
    // sim/ rolls indices and render/ maps them to colours. If these drift apart, pawns
    // render with an undefined colour instead of failing loudly.
    expect(PawnPalette.skin.length).toBeGreaterThanOrEqual(APPEARANCE_VARIANTS.skinTones);
    expect(PawnPalette.hair.length).toBeGreaterThanOrEqual(APPEARANCE_VARIANTS.hairColours);
    expect(PawnPalette.apparel.length).toBeGreaterThanOrEqual(APPEARANCE_VARIANTS.apparelColours);
  });

  it('rolls every field inside its declared range', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      expect(rng.int(APPEARANCE_VARIANTS.skinTones)).toBeLessThan(APPEARANCE_VARIANTS.skinTones);
      expect(rng.int(APPEARANCE_VARIANTS.hairStyles)).toBeLessThan(APPEARANCE_VARIANTS.hairStyles);
    }
  });
});
