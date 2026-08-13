/**
 * The scenario harness, checked headless.
 *
 * Scenarios exist so a game state can be *looked at* cheaply, but the states they build
 * must be states the game could actually reach. These tests hold that line: everything
 * here runs with no renderer, which is the same property the simulation has had since M0.
 */

import { describe, expect, it } from 'vitest';
import { runScenario, type ScenarioBuilder } from '../src/scenarios/builder';
import { SCENARIOS, scenarioNames, type Scenario } from '../src/scenarios/index';
import { bedHeadCell } from '../src/sim/ai/needs';
import { pos } from '../src/sim/core/position';
import { buildableProducing } from '../src/sim/defs/buildables';
import { Building } from '../src/sim/defs/buildings';
import { Terrain } from '../src/sim/defs/terrain';
import type { Building as BuildingEntity } from '../src/sim/entities/building';
import { hashWorld } from '../src/sim/save/hash';
import { Simulation } from '../src/sim/simulation';
import { createWorld } from '../src/sim/world/world';

/** Small enough to walk every cell in an assertion, big enough to hold a few beds. */
const SIZE = 24;

/**
 * A scenario written inline, so a test can describe exactly the world it needs without
 * adding one to the registry that only a test ever looks at.
 */
function scenario(build: (s: ScenarioBuilder) => void): Scenario {
  return { name: 'test', about: 'built inline by a test', build };
}

describe('Simulation.install', () => {
  it('replaces the world and drops queued commands aimed at the old one', () => {
    const sim = new Simulation();
    const before = sim.world;

    // A command queued against the old world must not land on the new one — the same
    // reason `load` drains before swapping.
    sim.dispatch({ type: 'regenerate', seed: 99 });
    const fresh = createWorld(1234, { width: 32, height: 32, colonists: 2 });
    sim.install(fresh);

    expect(sim.world).toBe(fresh);
    expect(sim.world).not.toBe(before);

    sim.tick();
    expect(sim.world).toBe(fresh);
  });
});

describe('the flat fixture', () => {
  it('is flat, walkable end to end, and the same world twice', () => {
    const first = runScenario(scenario((s) => s.flat(SIZE)));
    const second = runScenario(scenario((s) => s.flat(SIZE)));
    const map = first.world.map;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(map.getTerrain(x, y)).toBe(Terrain.Grass);
        expect(map.isPassable(x, y)).toBe(true);
      }
    }

    // Corner to corner, which is the assertion that catches a flatten that changed the
    // terrain and forgot to invalidate reachability: the districts would still describe
    // the rock that used to be there.
    expect(first.world.reachability.canReach(pos(0, 0), pos(SIZE - 1, SIZE - 1))).toBe(true);

    // Same scenario, same picture — the whole reason a scenario names its seed.
    expect(hashWorld(first.world)).toBe(hashWorld(second.world));
  });
});

describe('placing structures', () => {
  it('adds a building', () => {
    let bed: BuildingEntity | undefined;
    const { world } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        bed = s.place(Building.Bed, pos(2, 2));
      }),
    );

    expect(bed?.def).toBe(Building.Bed);
    expect(bed && world.buildings.get(bed.id)).toBe(bed);
  });

  it('refuses a second bed on the same cells', () => {
    // Loudly, not silently. The build command skips a cell it cannot use, so a scenario
    // that shrugged this off would photograph one bed while claiming to show two.
    expect(() =>
      runScenario(
        scenario((s) => {
          s.flat(SIZE);
          s.place(Building.Bed, pos(2, 2));
          s.place(Building.Bed, pos(2, 2));
        }),
      ),
    ).toThrow(/could not place/i);
  });

  it('places a bedroll, which no blueprint produces', () => {
    // The reason `place` cannot simply be "dispatch a build command": bedrolls arrive
    // with the landing party and have no buildable at all.
    expect(buildableProducing(Building.Bedroll)).toBeUndefined();

    let bedroll: BuildingEntity | undefined;
    const { world } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        bedroll = s.place(Building.Bedroll, pos(2, 2), 1);
      }),
    );

    expect(bedroll?.def).toBe(Building.Bedroll);
    expect(bedroll?.rotation).toBe(1);
    expect(bedroll && world.buildings.get(bedroll.id)).toBe(bedroll);
  });
});

describe('sleeperIn', () => {
  it('leaves exactly one colonist asleep, at the head of the bed', () => {
    let head = pos(0, 0);
    const { world } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        // Rotation 2 covers the same cells as rotation 0 and differs only in which end
        // the pillow is at — so a sleeper laid on the anchor instead of the head passes
        // this test at rotation 0 and fails it here.
        const bed = s.place(Building.Bed, pos(2, 2), 2);
        s.sleeperIn(bed);
        head = bedHeadCell(bed);
      }),
    );

    const asleep = [...world.pawns.values()].filter((pawn) => pawn.asleep);
    expect(asleep).toHaveLength(1);
    expect(asleep[0].pos).toEqual(head);
  });
});

describe('the registry', () => {
  /*
   * Every scenario is run, because a scenario nobody runs is a scenario that throws the
   * first time somebody wants a picture from it — and the verbs are deliberately loud, so
   * a layout that collides with the landing party fails here rather than at the camera.
   */
  it.each([...SCENARIOS.keys()])('%s builds and places something', (name) => {
    const scenarioToRun = SCENARIOS.get(name);
    expect(scenarioToRun).toBeDefined();

    const { touched } = runScenario(scenarioToRun as Scenario);
    expect(touched.length).toBeGreaterThan(0);
  });

  it('lists what it holds', () => {
    expect(scenarioNames()).toEqual([...SCENARIOS.keys()]);
    expect(scenarioNames().length).toBeGreaterThan(0);
  });
});
