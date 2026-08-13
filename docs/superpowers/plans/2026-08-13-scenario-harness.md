# Scenario harness implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach any game state worth looking at in one call, and get a full-resolution PNG of it in a second — replacing the ~20 round trips it currently takes to verify a gameplay change.

**Architecture:** A scenario is a TypeScript function that drives a real `Simulation` through its own command queue and mutators, never by hand-setting fields. `Engine.loadScenario` installs the result using the same sequence `regenerate` already uses. The page extracts the canvas via `renderer.extract` and POSTs it to a dev-only Vite middleware that writes `art/scenes/<name>.png`.

**Tech Stack:** TypeScript, Vite (dev middleware), PixiJS (`renderer.extract`), vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-scenario-harness-design.md`

---

## Load-bearing facts established before planning

- `createWorld(seed, { width?, height?, colonists? })` builds a World; `generateMap` gives it real terrain.
- `Simulation.load(save)` already drains the queue and replaces `worldState` — the precedent for installing a world from outside without inventing a second mutation path.
- `Engine.regenerate(seed)` is the correct "replace the world" sequence: dispatch → `select(null)` → `selectStructure(null)` → `setTool('select')` → `worldEpoch++` → `renderer.onWorldReplaced()` → `renderer.focusOn(x, y)` → `store.update({ snapshot })`. Skipping `worldEpoch++` leaves the minimap painting a world the player has left.
- The **instant build** path already exists: `{ type: 'build', …, instant: true }` → `canPlaceFootprint` → `createSite` → `finishSite`, which refuses a blocking structure on an occupied cell before calling `completeConstruction`. Scenarios must use it rather than stamping the grid.
- Sleep state is `pawn.asleep`, set inside `toilSleep` in `src/sim/ai/toils.ts:163`. The sleep job's target cell is `bedHeadCell(bed)` (`src/sim/ai/needs.ts:144`).
- `TICKS_PER_HOUR = 2500`, `STARTING_TICK = TICKS_PER_HOUR * 8`.
- `pawn.pos` is a `TilePos`.

## File structure

| File | Responsibility |
|---|---|
| `src/scenarios/builder.ts` | The `ScenarioBuilder` verbs. Drives a real `Simulation`. |
| `src/scenarios/fixtures.ts` | The flat debug room. |
| `src/scenarios/index.ts` | `Scenario` type + the registry. |
| `src/scenarios/beds.ts` | First real scenarios. |
| `src/app/scenarioMode.ts` | Dev-only `window.__scenario`, including capture. |
| `vite.config.ts` | The `POST /__capture` middleware (`apply: 'serve'`). |
| `src/app/engine.ts` | `loadScenario`, mirroring `regenerate`. |
| `src/sim/simulation.ts` | `install(world)`, mirroring `load(save)`. |
| `src/sim/entities/pawn.ts` | `fallAsleep` / `wakeUp`, so one definition serves toil and scenario. |
| `tests/scenarios.test.ts` | Scenarios build legal worlds, headless. |

---

## Task 0: Verify `renderer.extract` works with the pane hidden

**This gates the whole design.** If it fails, stop and reconsider — the fallback is bringing the headless renderer forward.

- [ ] **Step 1: Start the dev server and load the game**

Use `preview_start` with the `game` config (or navigate to an already-running `http://localhost:5173`).

- [ ] **Step 2: With the Browser pane NOT displayed, extract the canvas and check it has content**

Run via `javascript_tool`:

```js
(async () => {
  const canvas = document.querySelector('canvas');
  // Pixi's own extract, not html2canvas: it reads the framebuffer rather than
  // compositing a window, which is why it should survive a hidden pane.
  const app = canvas && canvas.__pixiApp;
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return JSON.stringify({ w: canvas.width, h: canvas.height, bytes: blob ? blob.size : 0 });
})()
```

Expected: `bytes` well above 5000. A near-zero or all-transparent result means the WebGL context has `preserveDrawingBuffer: false` and `canvas.toBlob` cannot see it.

- [ ] **Step 3: DONE — `canvas.toBlob` works**

Measured 18,703 bytes at 966×1030 with all 100 sampled centre pixels opaque. Pixi's `extract` is not needed for the pixels. **The residual risk is `requestAnimationFrame`, not the read:** rAF is throttled in a hidden tab, so `capture()` renders synchronously rather than waiting for a frame. Task 4's code already reflects this.

- [ ] **Step 4: Record the result in the spec**

Append a line to `docs/superpowers/specs/2026-08-13-scenario-harness-design.md` under "Verification" saying which extraction path works and what it returned. This is the assumption everything rests on; it gets written down.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-scenario-harness-design.md
git commit -m "M12.5: record which canvas extraction path survives a hidden pane"
```

---

## Task 1: `fallAsleep` / `wakeUp`, so scenario and toil share one definition

**Files:**
- Modify: `src/sim/entities/pawn.ts`
- Modify: `src/sim/ai/toils.ts` (around line 163)
- Test: `tests/pawn.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/pawn.test.ts`:

```ts
describe('sleep state', () => {
  /*
   * Extracted so a scenario can put a colonist to bed the same way the game does.
   * A harness that reaches a state by a route the game cannot take shows a picture of
   * something that cannot happen — the same failure as a review surface disagreeing
   * with the layer, which shipped a bug in M12.
   */
  it('is set and cleared through one pair of functions', () => {
    const pawn = createPawn(1, 'Test', { x: 0, y: 0, z: GROUND_LEVEL }, {
      skinTone: 0, hairStyle: 0, hairColour: 0, apparelColour: 0,
    });
    expect(pawn.asleep).toBe(false);

    fallAsleep(pawn);
    expect(pawn.asleep).toBe(true);

    wakeUp(pawn);
    expect(pawn.asleep).toBe(false);
  });
});
```

Add to that file's imports: `fallAsleep`, `wakeUp` from `../src/sim/entities/pawn`. Check the existing `createPawn` signature at the top of `src/sim/entities/pawn.ts` and match it — the call above assumes `(id, name, pos, appearance)`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/pawn.test.ts -t "one pair of functions"
```

Expected: FAIL — `fallAsleep is not a function`.

- [ ] **Step 3: Add the functions**

In `src/sim/entities/pawn.ts`, after `createPawn`:

```ts
/**
 * Falling asleep, in one place.
 *
 * A single assignment today, and deliberately a function anyway: `toilSleep` reaches this
 * state through the AI, and a scenario reaches it directly, and those two must not drift.
 * When sleep grows a second field — a dream, a disturbance, a bed claim — both callers get
 * it for free rather than one of them getting it.
 */
export function fallAsleep(pawn: Pawn): void {
  pawn.asleep = true;
}

export function wakeUp(pawn: Pawn): void {
  pawn.asleep = false;
}
```

- [ ] **Step 4: Route the toil through them**

In `src/sim/ai/toils.ts`, replace `pawn.asleep = true;` with `fallAsleep(pawn);` and `pawn.asleep = false;` with `wakeUp(pawn);`. Add to that file's pawn import: `fallAsleep`, `wakeUp`.

- [ ] **Step 5: Run the full check**

```bash
npm run check
```

Expected: PASS, 708 tests. The sleep behaviour is unchanged; only its spelling moved.

- [ ] **Step 6: Commit**

```bash
git add src/sim/entities/pawn.ts src/sim/ai/toils.ts tests/pawn.test.ts
git commit -m "sim: one definition for falling asleep, shared by toil and scenario"
```

---

## Task 2: `Simulation.install(world)`

**Files:**
- Modify: `src/sim/simulation.ts` (beside `load`)
- Test: `tests/scenarios.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/scenarios.test.ts`:

```ts
/**
 * The scenario harness, checked headless.
 *
 * Scenarios exist so a game state can be *looked at* cheaply, but the states they build
 * must be states the game could actually reach. These tests hold that line: everything
 * here runs with no renderer, which is the same property the simulation has had since M0.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { createWorld } from '../src/sim/world/world';

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
```

Check `Simulation`'s constructor and `dispatch`/`tick` names against `src/sim/simulation.ts` and correct the test if they differ.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/scenarios.test.ts
```

Expected: FAIL — `sim.install is not a function`.

- [ ] **Step 3: Add `install`, beside `load`**

In `src/sim/simulation.ts`, directly after `load`:

```ts
  /**
   * Installs a world built elsewhere.
   *
   * The same shape as `load`, for the same reason: a world arriving whole from outside
   * cannot be expressed as a command without the simulation learning what built it. Saves
   * come in this way already; scenarios are the second caller.
   *
   * Drains first. A command queued against the world being replaced would otherwise land
   * on its successor, addressing entity ids that mean something different there.
   */
  install(world: World): void {
    this.commands.drain();
    this.worldState = world;
  }
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/scenarios.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/simulation.ts tests/scenarios.test.ts
git commit -m "sim: install a world built elsewhere, mirroring load"
```

---

## Task 3: The scenario builder and the flat fixture

**Files:**
- Create: `src/scenarios/index.ts`, `src/scenarios/fixtures.ts`, `src/scenarios/builder.ts`
- Test: `tests/scenarios.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/scenarios.test.ts`:

```ts
import { Building } from '../src/sim/defs/buildings';
import { buildScenario } from '../src/scenarios/builder';
import { Terrain } from '../src/sim/defs/terrain';

describe('the flat fixture', () => {
  it('is flat, walkable, and the same every time', () => {
    const a = buildScenario({ name: 'x', about: '', build: (s) => s.flat(24) });
    const b = buildScenario({ name: 'x', about: '', build: (s) => s.flat(24) });

    expect(a.map.width).toBe(24);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        expect(a.map.getTerrain(x, y)).toBe(Terrain.Dirt);
        expect(a.map.getTerrain(x, y)).toBe(b.map.getTerrain(x, y));
      }
    }
  });
});

describe('placing structures', () => {
  it('goes through the game\'s own legality check', () => {
    const world = buildScenario({
      name: 'x', about: '',
      build: (s) => {
        s.flat(24);
        s.place(Building.Bed, { x: 5, y: 5 }, 0);
      },
    });
    expect(world.buildings.size).toBeGreaterThan(0);
  });

  it('refuses an illegal placement loudly rather than stamping it', () => {
    expect(() =>
      buildScenario({
        name: 'x', about: '',
        build: (s) => {
          s.flat(24);
          s.place(Building.Bed, { x: 5, y: 5 }, 0);
          s.place(Building.Bed, { x: 5, y: 5 }, 0); // same cells
        },
      }),
    ).toThrow(/could not place/i);
  });
});

describe('forced states', () => {
  it('puts a colonist asleep in a named bed, on its head cell', () => {
    let bedId = -1;
    const world = buildScenario({
      name: 'x', about: '',
      build: (s) => {
        s.flat(24);
        const bed = s.place(Building.Bed, { x: 5, y: 5 }, 0);
        bedId = bed.id;
        s.sleeperIn(bed);
      },
    });

    const bed = world.buildings.get(bedId)!;
    const sleeping = [...world.pawns.values()].filter((p) => p.asleep);
    expect(sleeping).toHaveLength(1);
    expect(sleeping[0].pos).toEqual(bedHeadCell(bed));
  });
});
```

Add `import { bedHeadCell } from '../src/sim/ai/needs';` — confirm the export name and path; if `bedHeadCell` is not exported, export it, since the scenario builder and the sleep job must agree on which cell is the head.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/scenarios.test.ts
```

Expected: FAIL — cannot resolve `../src/scenarios/builder`.

- [ ] **Step 3: Write the scenario type and registry**

Create `src/scenarios/index.ts`:

```ts
/**
 * Game states worth looking at, as code.
 *
 * Verifying one render change — is a sleeping colonist positioned right on a bed? — cost
 * about twenty tool calls, six of them spent persuading colonists to prefer a bed over a
 * bedroll, which was not under test. The simulation has been headless and constructible
 * from TypeScript since M0; what was missing was a way to get a *picture* of a world built
 * that way.
 *
 * **A scenario forces outcomes through the game's own mutators and skips only the AI that
 * would have chosen them.** Skipping the decision is the point. Skipping the transition
 * would make the harness show pictures of states the game cannot reach, which is worse
 * than having no harness.
 */

import type { ScenarioBuilder } from './builder';

export interface Scenario {
  /** Stable id, used on the command line and as the PNG filename. */
  readonly name: string;
  /** One line, shown in the index. What the picture is meant to answer. */
  readonly about: string;
  build(s: ScenarioBuilder): void;
  /** How to point the camera. Defaults to framing everything the scenario placed. */
  readonly frame?: Frame;
}

export type Frame =
  | { readonly fit: 'contents'; readonly zoom?: number; readonly pad?: number }
  | { readonly at: { readonly x: number; readonly y: number }; readonly zoom: number };

import { beds } from './beds';

/** Every scenario, by name. */
export const SCENARIOS: Record<string, Scenario> = Object.fromEntries(
  [...beds].map((s) => [s.name, s]),
);

export function scenarioNames(): string[] {
  return Object.keys(SCENARIOS).sort();
}
```

- [ ] **Step 4: Write the fixture**

Create `src/scenarios/fixtures.ts`:

```ts
/**
 * The debug room.
 *
 * Worldgen randomness is noise in a picture whose subject is a bed: a lake in shot, a tree
 * occluding the thing under review, a landing site three hundred tiles from where the
 * camera is pointed. A scenario starts from flat, known, walkable ground unless terrain is
 * the point — and then it asks for `generated` instead.
 */

import { TICKS_PER_HOUR } from '../sim/core/constants';
import { GROUND_LEVEL } from '../sim/core/position';
import { Terrain } from '../sim/defs/terrain';
import type { World } from '../sim/world/world';

/** One seed for every scenario, so two runs of the same scenario are the same picture. */
export const SCENARIO_SEED = 20260813;

/**
 * Flattens a world's terrain to one walkable surface.
 *
 * Uses `setTerrainAt` rather than writing the grid, because *the ground itself* is
 * changing and `naturalTerrain` has to change with it — the distinction `setSurfaceAt`
 * exists to keep. Reachability is invalidated with the blanket `markDirty`, which is the
 * right call for a bulk edit and the wrong one for a single cell.
 */
export function flatten(world: World, terrain: TerrainId = Terrain.Dirt): void {
  const { map } = world;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setTerrainAt(map.idx(x, y, GROUND_LEVEL), terrain);
    }
  }
  world.reachability.markDirty();
  world.rooms.markDirty();
}

/** Absolute tick for an hour on day one. `timeOfDay` names the usual four. */
export function tickAtHour(hour: number): number {
  return Math.round(hour * TICKS_PER_HOUR);
}

export const HOURS = { dawn: 6, noon: 12, dusk: 19, night: 23 } as const;
export type TimeName = keyof typeof HOURS;
```

Import `TerrainId` alongside `Terrain`. Confirm `setTerrainAt`'s signature in `src/sim/world/tilemap.ts` — it may take `(index, terrain)` or `(x, y, terrain)`; match it.

- [ ] **Step 5: Write the builder**

Create `src/scenarios/builder.ts`:

```ts
/**
 * The verbs a scenario is written in.
 *
 * Every one of them drives a real `Simulation` — commands go on the queue and are drained,
 * state changes go through the same mutators the game uses. What a scenario skips is the
 * *AI's decision*: whether a colonist wants that bed, whether they would walk there,
 * whether it is late enough. That decision is what cost twenty tool calls and it is never
 * what is under test.
 */

import { Simulation } from '../sim/simulation';
import { createWorld, type World } from '../sim/world/world';
import { GROUND_LEVEL, type TilePos } from '../sim/core/position';
import { Building, type BuildingId } from '../sim/defs/buildings';
import { Buildable, type BuildableId } from '../sim/defs/buildables';
import type { Rotation } from '../sim/world/footprint';
import type { Building as BuildingEntity } from '../sim/entities/building';
import { buildingCells, createBuilding } from '../sim/entities/building';
import { buildingDef } from '../sim/defs/buildings';
import { cellsOf, footprintOfBuilding } from '../sim/world/footprint';
import type { Pawn } from '../sim/entities/pawn';
import { fallAsleep } from '../sim/entities/pawn';
import { bedHeadCell } from '../sim/ai/needs';
import type { Scenario } from './index';
import { flatten, HOURS, SCENARIO_SEED, tickAtHour, type TimeName } from './fixtures';
import type { TerrainId } from '../sim/defs/terrain';

export interface ScenarioBuilder {
  /** A flat, walkable debug room. The default starting point. */
  flat(size?: number, terrain?: TerrainId): void;
  /** Real worldgen, for when terrain is the subject. */
  generated(size?: number): void;
  /** Places a finished structure. Throws if the game would refuse it. */
  place(def: BuildingId, at: { x: number; y: number }, rotation?: Rotation): BuildingEntity;
  /** Puts a colonist asleep in this structure, on the cell the sleep job would use. */
  sleeperIn(bed: BuildingEntity, pawn?: Pawn): Pawn;
  /** Moves the clock without simulating. */
  timeOfDay(when: TimeName | number): void;
  /** Actually simulates, for when emergent state is the subject. */
  tick(ticks: number): void;
  /** Every cell the scenario placed something on, for framing the camera. */
  readonly touched: TilePos[];
  readonly world: World;
}

/**
 * Which buildable produces which building — scenarios name the *thing*, not the recipe.
 *
 * A **bedroll is deliberately absent**: it arrives with the landing party rather than
 * being constructed, so there is no buildable for it and no build command that could
 * place one. `place` handles that below by the same route worldgen uses.
 */
const BUILDABLE_FOR: Partial<Record<BuildingId, BuildableId>> = {
  [Building.Wall]: Buildable.Wall,
  [Building.Door]: Buildable.Door,
  [Building.Campfire]: Buildable.Campfire,
  [Building.Bed]: Buildable.Bed,
  [Building.Hearth]: Buildable.Hearth,
};

class Builder implements ScenarioBuilder {
  readonly touched: TilePos[] = [];
  private sim: Simulation;
  private nextSleeper = 0;

  constructor() {
    this.sim = new Simulation();
    this.sim.install(createWorld(SCENARIO_SEED, { width: 32, height: 32, colonists: 4 }));
  }

  get world(): World {
    return this.sim.world;
  }

  flat(size = 32, terrain?: TerrainId): void {
    this.sim.install(createWorld(SCENARIO_SEED, { width: size, height: size, colonists: 4 }));
    flatten(this.sim.world, terrain);
  }

  generated(size = 64): void {
    this.sim.install(createWorld(SCENARIO_SEED, { width: size, height: size, colonists: 4 }));
  }

  place(def: BuildingId, at: { x: number; y: number }, rotation: Rotation = 0): BuildingEntity {
    const pos: TilePos = { x: at.x, y: at.y, z: GROUND_LEVEL };
    const buildable = BUILDABLE_FOR[def];
    if (buildable === undefined) return this.placeStarting(def, pos, rotation);

    const before = this.world.buildings.size;

    /*
     * Through the *instant build* command, which is the path the debug panel's "place
     * finished" already uses: legality check, site, then completion — including the refusal
     * to raise a blocking structure on a cell somebody is standing in. Stamping the grid
     * directly would let a scenario build worlds the simulation considers broken.
     */
    this.sim.dispatch({
      type: 'build',
      buildable,
      area: { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, z: pos.z },
      rotation,
      instant: true,
    });
    this.sim.tick();

    if (this.world.buildings.size === before) {
      throw new Error(
        `could not place ${buildingDef(def).name} at ${pos.x},${pos.y} rot ${rotation} — ` +
          `the simulation refused it, which means the scenario is describing an impossible world`,
      );
    }

    const placed = [...this.world.buildings.values()].at(-1)!;
    this.touched.push(...buildingCells(placed));
    return placed;
  }

  /**
   * Structures that arrive with the landing party rather than being built.
   *
   * Only bedrolls, today. There is no buildable and so no build command; worldgen adds
   * them straight to the store and stamps nothing, because a bedroll is passable and does
   * not seal a room, which makes `setBuildingAt` a no-op for it. This mirrors
   * `placeBedrolls` in `sim/world/spawn.ts` exactly, including its `isStorable` test —
   * a bedroll on water would be as illegal here as it is there.
   */
  private placeStarting(def: BuildingId, pos: TilePos, rotation: Rotation): BuildingEntity {
    const cells = cellsOf(pos, footprintOfBuilding(def), rotation);
    const clear = cells.every((c) => this.world.map.isStorable(c.x, c.y, c.z));
    if (!clear) {
      throw new Error(
        `could not place ${buildingDef(def).name} at ${pos.x},${pos.y} rot ${rotation} — ` +
          `not every cell it covers is storable ground`,
      );
    }

    const placed = this.world.buildings.add((id) => createBuilding(id, def, pos, rotation));
    this.touched.push(...buildingCells(placed));
    return placed;
  }

  sleeperIn(bed: BuildingEntity, pawn?: Pawn): Pawn {
    const who = pawn ?? [...this.world.pawns.values()][this.nextSleeper++];
    if (!who) throw new Error('no colonist left to put to bed — ask for more in flat()');

    // The state the sleep toil produces, reached through the same mutator, on the same
    // cell the sleep job would target. The AI's decision to go to bed is what is skipped.
    who.pos = bedHeadCell(bed);
    fallAsleep(who);
    this.touched.push(who.pos);
    return who;
  }

  timeOfDay(when: TimeName | number): void {
    const hour = typeof when === 'number' ? when : HOURS[when];
    this.world.tick = tickAtHour(hour);
  }

  tick(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.sim.tick();
  }
}

/** Runs a scenario and returns the world it built. */
export function buildScenario(scenario: Scenario): World {
  const builder = new Builder();
  scenario.build(builder);
  return builder.world;
}

/** Runs a scenario and returns both the world and what it touched, for framing. */
export function runScenario(scenario: Scenario): { world: World; touched: TilePos[] } {
  const builder = new Builder();
  scenario.build(builder);
  return { world: builder.world, touched: builder.touched };
}
```

All three shapes above are confirmed against the codebase: `TileRectangle` is exactly `{ x0, y0, x1, y1, z }`; `Buildable` is `{ Wall, Door, Floor, Campfire, Bed, Hearth }` with **no Bedroll**, which is why `placeStarting` exists; and `Building` is an `as const` object with no reverse mapping, which is why names come from `buildingDef(def).name`.

- [ ] **Step 6: Write the first scenarios**

Create `src/scenarios/beds.ts`:

```ts
/**
 * Beds, which is where the harness came from.
 *
 * Checking that a sleeping colonist sits correctly on a bed cost about twenty tool calls
 * by hand and found the bug only after the user pointed at it. This is that check, as two
 * pictures.
 */

import { Building } from '../sim/defs/buildings';
import { ROTATIONS } from '../sim/world/footprint';
import type { Scenario } from './index';

const bedsAllRotations: Scenario = {
  name: 'beds-all-rotations',
  about: 'A bed at each rotation with a colonist asleep in it, at night',
  build(s) {
    s.flat(28);
    for (const rotation of ROTATIONS) {
      const bed = s.place(Building.Bed, { x: 6 + rotation * 5, y: 8 }, rotation);
      s.sleeperIn(bed);
    }
    s.timeOfDay('night');
  },
  frame: { fit: 'contents', zoom: 2 },
};

const bedrollsAllRotations: Scenario = {
  name: 'bedrolls-all-rotations',
  about: 'A bedroll at each rotation with a colonist asleep in it, at night',
  build(s) {
    s.flat(28);
    for (const rotation of ROTATIONS) {
      const roll = s.place(Building.Bedroll, { x: 6 + rotation * 5, y: 8 }, rotation);
      s.sleeperIn(roll);
    }
    s.timeOfDay('night');
  },
  frame: { fit: 'contents', zoom: 2 },
};

export const beds: Scenario[] = [bedsAllRotations, bedrollsAllRotations];
```

`Building.Bedroll` has no buildable, so `place` routes it to `placeStarting` automatically — no change needed here. That asymmetry is content, not an oversight: bedrolls arrive with the landing party.

- [ ] **Step 7: Run the tests and make them pass**

```bash
npx vitest run tests/scenarios.test.ts
```

Expected: PASS. Fix signature mismatches against the real APIs as they surface — the two flagged in Step 5 are the likely ones.

- [ ] **Step 8: Run the full check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/scenarios tests/scenarios.test.ts
git commit -m "scenarios: build game states through the game's own paths"
```

---

## Task 4: The capture middleware and the dev API

**Files:**
- Modify: `vite.config.ts`
- Create: `src/app/scenarioMode.ts`
- Modify: `src/app/engine.ts`, `.gitignore`

- [ ] **Step 1: Add the middleware**

In `vite.config.ts`, add above `defineConfig`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Writes a captured frame to `art/scenes/<name>.png`.
 *
 * A file on disk rather than a screenshot, because a screenshot is downscaled, needs the
 * browser window to be composited, and cannot be diffed. `apply: 'serve'` keeps this out
 * of every production build.
 */
function sceneCapture(): Plugin {
  return {
    name: 'scene-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        // Sanitised, not trusted. A dev server is still a server, and `../` in a filename
        // is the oldest hole there is.
        const name = (url.searchParams.get('name') ?? '').replace(/[^a-z0-9._-]/gi, '');
        if (req.method !== 'POST' || !name) {
          res.statusCode = 400;
          res.end('need POST and a ?name');
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > 32 * 1024 * 1024) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          const dir = join(process.cwd(), 'art', 'scenes');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${name}.png`), Buffer.concat(chunks));
          res.statusCode = 200;
          res.end(`art/scenes/${name}.png`);
        });
      });
    },
  };
}
```

Then add `sceneCapture()` to the `plugins` array: `plugins: [react(), sceneCapture()]`.

- [ ] **Step 2: Verify the endpoint by hand**

With the dev server running:

```bash
curl -s -X POST --data-binary @art/sprites/building-4-0-open.png "http://localhost:5173/__capture?name=selftest"
```

Expected: prints `art/scenes/selftest.png`, and that file exists and is a valid PNG. Then delete it.

- [ ] **Step 3: Add `loadScenario` to the Engine**

In `src/app/engine.ts`, directly after `regenerate`:

```ts
  /**
   * Installs a scenario's world, mirroring `regenerate` step for step.
   *
   * Every line below exists in `regenerate` for a reason that applies equally here — most
   * pointedly `worldEpoch++`, without which the minimap goes on painting a world that is
   * no longer loaded.
   */
  loadScenario(name: string): void {
    const scenario = SCENARIOS[name];
    if (!scenario) throw new Error(`no scenario named "${name}"`);

    const { world, touched } = runScenario(scenario);
    this.sim.install(world);

    this.select(null);
    this.selectStructure(null);
    this.setTool('select');
    this.worldEpoch++;
    this.renderer.onWorldReplaced();

    const focus = frameFor(scenario.frame, touched, world);
    this.renderer.focusOn(focus.x, focus.y);
    this.debugSetZoom(focus.zoom);
    this.store.update({ snapshot: this.sim.snapshot() });
  }
```

And a module-level helper in the same file:

```ts
/** Where to point the camera: the middle of what the scenario placed, unless told otherwise. */
function frameFor(
  frame: Frame | undefined,
  touched: TilePos[],
  world: World,
): { x: number; y: number; zoom: number } {
  if (frame && 'at' in frame) return { ...frame.at, zoom: frame.zoom };
  if (touched.length === 0) {
    return { x: world.landingSite.x, y: world.landingSite.y, zoom: frame?.zoom ?? 1 };
  }
  const xs = touched.map((c) => c.x);
  const ys = touched.map((c) => c.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    zoom: frame?.zoom ?? 1,
  };
}
```

Add imports: `SCENARIOS`, `type Frame` from `../scenarios`; `runScenario` from `../scenarios/builder`; `type TilePos` from `../sim/core/position`; `type World` from `../sim/world/world`. Confirm `renderer.focusOn` takes tile coordinates (it is called as `focusOn(landingSite.x, landingSite.y)` in `regenerate`, so it does).

- [ ] **Step 4: Write the dev-only window API**

Create `src/app/scenarioMode.ts`:

```ts
/**
 * The scenario harness, from the outside.
 *
 * Two calls replace about twenty:
 *
 *   await __scenario.capture('beds-all-rotations')   // load, draw, extract, write
 *   Read art/scenes/beds-all-rotations.png
 *
 * `capture()` with no name grabs whatever is on screen, which is what makes handing setup
 * to a human cheap: they arrange something fiddly by hand, and the still costs one call.
 *
 * Dev builds only. Guarded at the call site by `import.meta.env.DEV`.
 */

import type { Application } from 'pixi.js';
import type { Engine } from './engine';
import { scenarioNames, SCENARIOS } from '../scenarios';

export interface ScenarioApi {
  list(): { name: string; about: string }[];
  load(name: string): void;
  capture(name?: string): Promise<string>;
}

export function installScenarioApi(engine: Engine, app: Application): void {
  const api: ScenarioApi = {
    list: () => scenarioNames().map((name) => ({ name, about: SCENARIOS[name].about })),

    load: (name) => engine.loadScenario(name),

    capture: async (name) => {
      if (name) engine.loadScenario(name);

      /*
       * Rendered synchronously, not waited for.
       *
       * `requestAnimationFrame` is throttled or suspended outright in a hidden tab — which
       * is exactly the situation this harness exists to survive, since a screenshot already
       * fails there. Waiting on a frame would hang the capture precisely when it is needed
       * most. Driving the renderer directly makes the wait unnecessary; the timeout race is
       * belt and braces for the case where something else owns the loop.
       */
      engine.renderer.application.renderer.render(engine.renderer.application.stage);
      await Promise.race([
        new Promise((r) => requestAnimationFrame(r)),
        new Promise((r) => setTimeout(r, 100)),
      ]);

      // The DOM canvas, verified to hold a real image: 18,703 bytes at 966x1030 with
      // opaque centre pixels. Pixi's `extract` re-renders into a render texture and would
      // also work, but there is no reason to pay for it when the buffer already survives.
      const canvas = app.canvas as HTMLCanvasElement;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('canvas.toBlob produced no image');

      const file = name ?? 'current';
      const res = await fetch(`/__capture?name=${encodeURIComponent(file)}`, {
        method: 'POST',
        body: blob,
      });
      return res.text();
    },
  };

  (globalThis as unknown as { __scenario: ScenarioApi }).__scenario = api;
}
```

Task 0 confirmed the DOM canvas path, so the code above is final. `app.canvas` is Pixi's own handle on that same element — preferred over `document.querySelector('canvas')`, which would pick up the minimap if it ever became a canvas.

- [ ] **Step 5: Call it from the app bootstrap**

Find where `Engine` is constructed in `src/app/App.tsx` and add, immediately after:

```ts
if (import.meta.env.DEV) {
  void import('./scenarioMode').then((m) => m.installScenarioApi(engine, engine.renderer.app));
}
```

A dynamic import so the scenarios never enter a production bundle.

`GameRenderer` holds the Pixi `Application` as `private readonly app`, so it needs a getter. Add to `src/render/gameRenderer.ts`:

```ts
  /** The Pixi application, for the dev-only scenario capture. Nothing else should reach for this. */
  get application(): Application {
    return this.app;
  }
```

and pass `engine.renderer.application` above. `Engine.renderer` is already accessible from `App.tsx`; if it is private, add a getter for it too rather than reaching through the class.

- [ ] **Step 6: Ignore the output**

Add to `.gitignore`, beneath the existing `/art/` entry — which already covers it, so confirm rather than duplicate:

```bash
git check-ignore -v art/scenes/x.png
```

Expected: matched by `/art/`. If so, no change needed.

- [ ] **Step 7: Verify end to end**

With the dev server running, via `javascript_tool`:

```js
await __scenario.capture('beds-all-rotations')
```

Expected: returns `art/scenes/beds-all-rotations.png`. Then `Read` that file: four beds, one per rotation, a colonist asleep in each, at night.

- [ ] **Step 8: Run the full check**

```bash
npm run check
```

- [ ] **Step 9: Commit**

```bash
git add vite.config.ts src/app/scenarioMode.ts src/app/engine.ts src/app/App.tsx
git commit -m "scenarios: load and capture from the browser in two calls"
```

---

## Task 5: Prove the saving, and write it down

**Files:**
- Modify: `docs/ROADMAP.md`, `CLAUDE.md`
- Create: `.claude/skills/scenario/SKILL.md`
- Modify: `.claude/skills/art-pass/SKILL.md`, `.claude/skills/add-work-type/SKILL.md`

- [ ] **Step 1: Re-run the original question and count the calls**

Answer *"is a sleeping colonist positioned correctly on a bed, at every rotation?"* using only the harness. Record the number of tool calls. The spec opens with twenty; if the answer is not two or three, the milestone has not landed and the gap is the thing to fix.

- [ ] **Step 2: Write the `scenario` skill**

Create `.claude/skills/scenario/SKILL.md` with frontmatter:

```yaml
---
name: scenario
description: Use when you need to see a game state that is not the default — verifying a render or gameplay change, checking every rotation of something, or reproducing a bug. Covers writing a scenario, capturing it to a PNG, and when to hand setup to the user instead.
---
```

Cover, with the reasons rather than just the rules:
- The two-call loop, and the twenty-call baseline it replaces.
- **Force outcomes through the game's own mutators; skip only the AI that would have chosen them.** A scenario that reaches a state by a route the game cannot take shows a picture of something that cannot happen.
- Start from `s.flat()`. Worldgen randomness is noise in a picture whose subject is a bed.
- `capture()` with no name, for grabbing something set up by hand.
- **When not to write one:** feel, timing, performance, whether an animation reads. Write the user a short numbered setup instead and capture the result.
- A scenario over about a dozen lines means the builder is missing a verb.

- [ ] **Step 3: Update `art-pass`**

Its closing section currently says "still look at the running game, at play zoom … Press `` ` `` for the debug panel". Replace the setup half with capturing a scenario; keep the debug panel as the manual fallback and keep the closing point that the harness has nothing to say about whether a thing reads as what it is.

- [ ] **Step 4: Update `add-work-type`**

Add one line to its verification section: a new work type deserves a scenario showing the job actually running, because "the pawn does the thing" is exactly the kind of dynamic claim a screenshot cannot support.

- [ ] **Step 5: Update CLAUDE.md**

- Retitle **"Looking at art costs one command"** to **"Looking costs one command"**, covering `npm run art` for sprites and `__scenario.capture` for game states.
- Add `scenarios/` to the layout block, described as *game states worth looking at, as code*.
- Add to the silently-failing invariants: **a scenario forces outcomes through the game's own mutators and skips only the AI that would have chosen them** — with the reason, which is that the alternative shows pictures of impossible states.
- In the debug panel section, note that it is the right tool for *playing with* a change and no longer the way to *set one up*.
- **Already landed, do not redo:** the "Hand the fussy setup to the user" section was added ahead of this milestone, because the protocol took effect immediately and a session starting before M12.5 ships would otherwise not know about it. Check it still reads correctly beside the new scenario material and leave it alone if it does.
- Add the `scenario` skill to the Skills list.

- [ ] **Step 6: Update the roadmap**

Insert an M12.5 section before M13 recording what was built, the call count before and after from Step 1, and that the headless renderer is deliberately deferred until the scene graph is extracted from `ObjectLayer`.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/ROADMAP.md .claude/skills
git commit -m "M12.5: docs and skills for the scenario harness"
```

---

## Deferred, deliberately

**The headless renderer.** Scenarios already build worlds with no browser; what is missing is `buildSceneGraph(world, view) → DrawCommand[]` extracted out of `ObjectLayer`, so a pure-TS compositor and the Pixi layer consume one list. That extraction is the structural fix for the bug class caught in M12 — a review surface computing placement its own way — and is worth its own task once the capture path has proven itself. Until then the real renderer is the only renderer, which is the strongest guarantee available that a picture matches the game.

**Golden images.** Explicitly rejected for now: M13–M15 are almost entirely intentional art changes, and a golden that fails on every one of them trains people to regenerate without looking.
