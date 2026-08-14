/**
 * The scenario harness, checked headless.
 *
 * Scenarios exist so a game state can be *looked at* cheaply, but the states they build
 * must be states the game could actually reach. These tests hold that line: everything
 * here runs with no renderer, which is the same property the simulation has had since M0.
 */

import { describe, expect, it } from 'vitest';
import { runScenario, type ScenarioBuilder } from '../src/scenarios/builder';
import { HOURS, SCENARIO_SEED, flatten, tickAtHour } from '../src/scenarios/fixtures';
import { SCENARIOS, scenarioNames, type Scenario } from '../src/scenarios/index';
import { bedHeadCell } from '../src/sim/ai/needs';
import { STARTING_TICK, TICKS_PER_DAY } from '../src/sim/core/constants';
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

    /*
     * Compared as booleans, deliberately.
     *
     * `expect(world).toBe(other)` is a landmine: on failure vitest pretty-prints a diff of
     * both operands, and a `World` holds a tile grid, four entity stores, pathfinder
     * scratch and a reachability map. Measured — with the drain removed so this genuinely
     * fails, the object form took the worker past 2GB and killed it after ninety seconds
     * with "Worker exited unexpectedly"; the boolean form fails cleanly in two.
     *
     * The failure path is the one nobody exercises until something breaks, which is
     * exactly when a dead worker is least helpful.
     */
    expect(sim.world === fresh, 'install did not swap the world').toBe(true);
    expect(sim.world === before, 'install left the old world in place').toBe(false);

    sim.tick();
    expect(sim.world).toBe(fresh);
  });
});

describe('the flat fixture', () => {
  it('is flat, walkable, and the same world twice', () => {
    const first = runScenario(scenario((s) => s.flat(SIZE)));
    const second = runScenario(scenario((s) => s.flat(SIZE)));
    const map = first.world.map;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(map.getTerrain(x, y)).toBe(Terrain.Grass);
        expect(map.isPassable(x, y)).toBe(true);
      }
    }

    // Same scenario, same picture — the whole reason a scenario names its seed.
    expect(hashWorld(first.world)).toBe(hashWorld(second.world));
  });

  it('changes the ground itself, not a surface laid over it', () => {
    const { world } = runScenario(scenario((s) => s.flat(SIZE)));

    // The only assertion that separates `setTerrainAt` from `setSurfaceAt` — `getTerrain`
    // answers the same either way. A surface would leave the old ground remembered
    // underneath, so lifting a floor here would hand back rock from a mountain that this
    // fixture flattened away.
    for (let i = 0; i < world.map.size; i++) {
      expect(world.map.naturalTerrainAt(i)).toBe(Terrain.Grass);
    }
  });

  it('invalidates the reachability it just changed', () => {
    const world = createWorld(SCENARIO_SEED, { width: SIZE, height: SIZE, colonists: 2 });
    const corner = pos(0, 0);
    const far = pos(SIZE - 1, SIZE - 1);

    /*
     * The districts have to be built from the *generated* map first, or this proves
     * nothing: `ReachabilityMap` starts wholly dirty and nothing in `createWorld` queries
     * it, so a first `canReach` after flattening rebuilds regardless and passes with the
     * invalidation deleted. This seed puts deep water in the corner, so the stale answer
     * is the false one.
     */
    expect(world.reachability.canReach(corner, far)).toBe(false);

    flatten(world);
    expect(world.reachability.canReach(corner, far)).toBe(true);
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

  it('stamps the map flags a finished structure owes it', () => {
    // A wall, because every other test places something passable that seals no room — and
    // those cannot tell the build command apart from adding a building to the store. This
    // is the assertion that says `place` went through construction: `completeConstruction`
    // is the only thing that sets these two, and it sets them separately.
    let at = pos(0, 0);
    const { world } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        at = s.place(Building.Wall, pos(2, 2)).pos;
      }),
    );

    const index = world.map.idx(at.x, at.y, at.z);
    expect(world.map.isPassable(at.x, at.y, at.z)).toBe(false);
    expect(world.map.sealsRoomAt(index)).toBe(true);
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

  it('holds the bed with a real sleep job, not just the flag', () => {
    let bedId = 0;
    const { world } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        const bed = s.place(Building.Bed, pos(2, 2));
        s.sleeperIn(bed);
        bedId = bed.id;
      }),
    );

    const sleeper = [...world.pawns.values()].find((pawn) => pawn.asleep);
    expect(sleeper?.job?.job.kind).toBe('sleep');

    // The half that `fallAsleep` alone cannot give: nobody else may take this bed. Without
    // the claim a second colonist would be sent to it, and nothing would wake the first.
    const other = [...world.pawns.values()].find((pawn) => pawn.id !== sleeper?.id);
    expect(other).toBeDefined();
    expect(world.reservations.canReserveEntity(bedId, other?.id ?? 0)).toBe(false);
  });

  it('is still asleep, and still out of the work pool, once time runs', () => {
    // The state has to survive contact with the tick loop. `tickPawnAI` does not skip
    // sleeping pawns, so a posed sleeper holding no job would be handed hauling here while
    // still being drawn in bed.
    const { world } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        s.sleeperIn(s.place(Building.Bed, pos(2, 2)));
        s.tick(200);
      }),
    );

    const asleep = [...world.pawns.values()].filter((pawn) => pawn.asleep);
    expect(asleep).toHaveLength(1);
    expect(asleep[0].job?.job.kind).toBe('sleep');
  });
});

describe('timeOfDay', () => {
  it('lands on the hour asked for without winding the clock back', () => {
    const { world } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        s.timeOfDay('dawn');
      }),
    );

    // 06:00 is earlier than the 08:00 a world starts at, so it lands on the *next* dawn.
    // Time only ever moves forward through the debug command, and a scenario does not get
    // to break that rule by assigning the clock itself.
    expect(world.tick % TICKS_PER_DAY).toBe(tickAtHour(HOURS.dawn));
    expect(world.tick).toBeGreaterThan(STARTING_TICK);
  });
});

describe('starting a second world', () => {
  it('forgets the cells the first one touched', () => {
    const { world, touched } = runScenario(
      scenario((s) => {
        s.flat(SIZE);
        s.place(Building.Wall, pos(2, 2));
        // Replaces the world outright. The wall went with it, so a `touched` still naming
        // its cell would frame the camera on empty ground.
        s.flat(SIZE);
      }),
    );

    expect(touched).toEqual([]);
    expect(world.map.isPassable(2, 2)).toBe(true);
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
