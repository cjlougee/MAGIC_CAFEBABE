/**
 * M8's playable check, run headless: **ten seeds, ten named places.**
 *
 * The claim being defended is not "POIs exist" but the four properties that make one a
 * *place* rather than a labelled noise blob — it is somewhere specific, it is far enough
 * away to be a journey, you can get inside it, and it is still called the same thing
 * next session.
 */

import { describe, expect, it } from 'vitest';
import { pos } from '../src/sim/core/position';
import { POI_DEFS, Poi } from '../src/sim/defs/pois';
import { Terrain } from '../src/sim/defs/terrain';
import { hashWorld } from '../src/sim/save/hash';
import { deserializeWorld, serializeWorld } from '../src/sim/save/serialize';
import { createWorld } from '../src/sim/world/world';

const SEEDS = [1, 7, 42, 777, 2024, 20260808, 31337, 90210, 123456, 8675309];

/**
 * Full-size worlds, because placement constraints are tuned against the real map — and
 * cached, because generating one costs ~145ms and every test below wants all ten.
 *
 * Safe to share: nothing here ticks the simulation or mutates the world. The one test
 * that needs a *fresh* world for the same seed asks for it explicitly.
 */
const worlds = new Map<number, ReturnType<typeof createWorld>>();

function world(seed: number) {
  const existing = worlds.get(seed);
  if (existing) return existing;

  const built = createWorld(seed, { colonists: 3 });
  worlds.set(seed, built);
  return built;
}

describe('point of interest defs', () => {
  it('keeps array position aligned with id', () => {
    POI_DEFS.forEach((def, index) => {
      expect(def.id, `${def.kind} sits at index ${index}`).toBe(index);
    });
  });

  it('promises exactly one kind of place', () => {
    // More than one "guaranteed" kind would be a promise the constraint relaxation
    // cannot keep on a crowded map, and zero would make an empty world legal.
    expect(POI_DEFS.filter((def) => def.guaranteed)).toHaveLength(1);
  });
});

describe('places', () => {
  it('gives every world at least the guaranteed one', () => {
    for (const seed of SEEDS) {
      const pois = [...world(seed).pois.values()];
      expect(pois.length, `seed ${seed} has no places at all`).toBeGreaterThan(0);
      expect(
        pois.some((poi) => poi.def === Poi.RelicVault),
        `seed ${seed} has no vault`,
      ).toBe(true);
    }
  });

  it('names every place, distinctly, and never after its type', () => {
    for (const seed of SEEDS) {
      const pois = [...world(seed).pois.values()];
      const names = pois.map((poi) => poi.name);

      expect(new Set(names).size, `seed ${seed} reused a name`).toBe(names.length);
      for (const name of names) {
        expect(name.length).toBeGreaterThan(3);
        // "Listening post" is what it is, not what it is called. A place named after its
        // category is the exact failure this milestone exists to avoid.
        expect(name.toLowerCase()).not.toContain('listening post');
        expect(name.toLowerCase()).not.toContain('relic vault');
      }
    }
  });

  it('puts them far enough away to be a journey', () => {
    for (const seed of SEEDS) {
      const state = world(seed);
      for (const poi of state.pois.values()) {
        const away = Math.hypot(
          poi.pos.x - state.landingSite.x,
          poi.pos.y - state.landingSite.y,
        );
        // Half the nominal minimum: the guaranteed vault may relax that far, and a place
        // that lands in the colony's back garden is not somewhere you travel to.
        expect(away, `seed ${seed}: ${poi.name} is ${away.toFixed(0)} tiles away`).toBeGreaterThan(
          44,
        );
      }
    }
  });

  it('never builds one standing in water', () => {
    for (const seed of SEEDS) {
      const state = world(seed);
      for (const poi of state.pois.values()) {
        for (let y = poi.pos.y - poi.radius; y <= poi.pos.y + poi.radius; y++) {
          for (let x = poi.pos.x - poi.radius; x <= poi.pos.x + poi.radius; x++) {
            const terrain = state.map.terrain[state.map.idx(x, y)];
            expect(
              terrain === Terrain.DeepWater || terrain === Terrain.ShallowWater,
              `seed ${seed}: ${poi.name} has water at ${x},${y}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('keeps a clear apron, so the building has an outline', () => {
    /*
     * The bug that a green suite was perfectly happy with, and that thirty seconds of
     * looking at the game found.
     *
     * Sites are scored by nearby wreckage, which is right for the fiction — the old
     * civilization built where it built — and pushed compounds into the *densest* ruin
     * fields, where a nine-tile post is the same colours in the same shapes as the sprawl
     * around it and is simply invisible. A place you cannot pick out is not a
     * destination, whatever the minimap says.
     */
    for (const seed of SEEDS) {
      const state = world(seed);
      for (const poi of state.pois.values()) {
        const outer = poi.radius + 4;
        let cells = 0;
        let wreckage = 0;

        for (let y = poi.pos.y - outer; y <= poi.pos.y + outer; y++) {
          for (let x = poi.pos.x - outer; x <= poi.pos.x + outer; x++) {
            const inFootprint =
              Math.abs(x - poi.pos.x) <= poi.radius && Math.abs(y - poi.pos.y) <= poi.radius;
            if (inFootprint || !state.map.inBounds(x, y)) continue;

            cells++;
            const terrain = state.map.terrain[state.map.idx(x, y)];
            if (terrain === Terrain.RuinFloor || terrain === Terrain.RuinWall) wreckage++;
          }
        }

        expect(
          wreckage / cells,
          `seed ${seed}: ${poi.name} is buried in wreckage and has no visible outline`,
        ).toBeLessThan(0.6);
      }
    }
  });

  it('leaves a way in', () => {
    /*
     * The failure the doorways exist to prevent, and it is a silent one. A sealed ring
     * is not just an inaccessible building — it is a pocket of walkable ground that
     * reachability correctly reports as its own district, so a colonist sent there
     * simply never arrives and nothing on screen says why.
     */
    for (const seed of SEEDS) {
      const state = world(seed);
      for (const poi of state.pois.values()) {
        const inside = pos(poi.pos.x, poi.pos.y);
        expect(
          state.map.isPassable(inside.x, inside.y),
          `seed ${seed}: the middle of ${poi.name} is not standable`,
        ).toBe(true);
        expect(
          state.reachability.canReach(state.landingSite, inside),
          `seed ${seed}: ${poi.name} cannot be walked into`,
        ).toBe(true);
      }
    }
  });

  it('generates the same places from the same seed', () => {
    // Deliberately bypasses the cache — comparing an object with itself would pass no
    // matter how non-deterministic placement was.
    const a = [...createWorld(4242, { colonists: 3 }).pois.values()];
    const b = [...createWorld(4242, { colonists: 3 }).pois.values()];

    expect(a.map((poi) => `${poi.name}@${poi.pos.x},${poi.pos.y}`)).toEqual(
      b.map((poi) => `${poi.name}@${poi.pos.x},${poi.pos.y}`),
    );
  });

  it('still calls them the same thing after a save round-trip', () => {
    const before = world(20260808);
    const after = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(before))));

    expect([...after.pois.values()].map((poi) => poi.name)).toEqual(
      [...before.pois.values()].map((poi) => poi.name),
    );
    // The hash covers the name, so this also proves nothing else about them was dropped.
    expect(hashWorld(after)).toBe(hashWorld(before));
  });
});
