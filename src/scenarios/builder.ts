/**
 * The verbs a scenario is written in.
 *
 * Every one of them reaches its outcome the way the game does. `place` dispatches the
 * *build command*, so the same legality rules, the same footprint arithmetic and the same
 * map flags apply as when a colonist finishes a wall; `sleeperIn` calls the *same*
 * `fallAsleep` the sleep toil calls. What a scenario skips is the deciding — whether a
 * colonist wanted that bed, whether they walked there, whether it was late enough — and
 * nothing else. See the header of `index.ts` for why that line is where it is.
 *
 * The consequence worth stating: a verb that cannot reach its outcome **throws**. A
 * scenario describing a world the game could not produce is worse than no scenario,
 * because it looks like evidence.
 */

import { bedHeadCell } from '../sim/ai/needs';
import type { EntityId } from '../sim/core/entityStore';
import type { TilePos } from '../sim/core/position';
import { buildableProducing, type BuildableId } from '../sim/defs/buildables';
import { buildingDef, type BuildingId } from '../sim/defs/buildings';
import type { TerrainId } from '../sim/defs/terrain';
import { buildingCells, createBuilding, isBed, type Building } from '../sim/entities/building';
import { fallAsleep, stopMoving, type Pawn } from '../sim/entities/pawn';
import { Simulation } from '../sim/simulation';
import { cellsOf, footprintOfBuilding, type Rotation } from '../sim/world/footprint';
import { buildingAt } from '../sim/world/lookup';
import type { World } from '../sim/world/world';
import {
  HOURS,
  SCENARIO_COLONISTS,
  SCENARIO_SEED,
  SCENARIO_SIZE,
  flatten,
  tickAtHour,
  type HourName,
} from './fixtures';
import type { Scenario } from './index';

/** What a scenario's `build` is handed. Everything it is allowed to do to the world. */
export interface ScenarioBuilder {
  /** The world being described. Read it freely; change it through the verbs. */
  readonly world: World;
  /**
   * Every cell this scenario put something on, in the order it was placed.
   *
   * The camera is framed from these, so a scenario never has to state its coordinates
   * twice — once to build and once to point at.
   */
  readonly touched: readonly TilePos[];

  /** An empty field of one terrain, with nothing on it to argue with. */
  flat(size?: number, terrain?: TerrainId): void;
  /** The world as worldgen makes it — rock, water, ruins and all. */
  generated(size?: number): void;
  /** Raises a finished structure, or throws saying which one it could not raise. */
  place(def: BuildingId, at: TilePos, rotation?: Rotation): Building;
  /** Puts a colonist to sleep in a bed. Takes the next one not already posed. */
  sleeperIn(bed: Building, pawn?: Pawn): Pawn;
  /** Moves the clock to an hour, without simulating the time in between. */
  timeOfDay(when: HourName | number): void;
  /** Actually runs the simulation, for a scenario that wants a colony to *do* something. */
  tick(ticks: number): void;
}

export class Builder implements ScenarioBuilder {
  private simulation: Simulation | null = null;
  private readonly placed: TilePos[] = [];
  /** Colonists already posed, so two `sleeperIn` calls never pick the same person. */
  private readonly posed = new Set<EntityId>();

  get world(): World {
    return this.activeSimulation().world;
  }

  get touched(): readonly TilePos[] {
    return this.placed;
  }

  flat(size: number = SCENARIO_SIZE, terrain?: TerrainId): void {
    flatten(this.startSimulation(size).world, terrain);
  }

  generated(size: number = SCENARIO_SIZE): void {
    this.startSimulation(size);
  }

  /**
   * Raises a finished structure where a colonist would have built one.
   *
   * Two routes, because the game has two. Anything with a blueprint goes through the
   * build command with `instant`, which is the debug panel's Place-finished path and so
   * already answers for legality, footprints, door facing, and the map flags a finished
   * structure sets. A bedroll has no blueprint at all — the party arrives carrying it —
   * so it takes the same route `placeBedrolls` does.
   */
  place(def: BuildingId, at: TilePos, rotation: Rotation = 0): Building {
    const buildable = buildableProducing(def);
    const building =
      buildable === undefined
        ? this.placeStarting(def, at, rotation)
        : this.placeBuilt(def, buildable, at, rotation);

    for (const cell of buildingCells(building)) this.placed.push(cell);
    return building;
  }

  /**
   * Lays a colonist down asleep.
   *
   * At the head cell rather than the anchor, from the same `bedHeadCell` the sleep job
   * picks its spot with: on a 2×1 bed those differ for two of the four rotations, and a
   * sleeper at the wrong end is exactly the sort of thing a scenario exists to make
   * visible rather than to introduce.
   */
  sleeperIn(bed: Building, pawn?: Pawn): Pawn {
    if (!isBed(bed)) {
      throw new Error(`scenario: a ${buildingDef(bed.def).name} is not something to sleep in`);
    }

    const who = pawn ?? this.nextUnposedColonist();
    if (!who) {
      throw new Error(
        `scenario: no colonist left to sleep in the ${buildingDef(bed.def).name} at ` +
          `${bed.pos.x},${bed.pos.y} — the world was built with ${SCENARIO_COLONISTS}`,
      );
    }

    // The same pair `escapeIfTrapped` uses to put a pawn somewhere it was not: stop, then
    // move. A scenario that ticked first could be posing someone mid-step, and `pawn.pos`
    // is the tile a walking colonist is *leaving* — they would be drawn sliding out of the
    // bed we just put them in.
    stopMoving(who);
    who.pos = bedHeadCell(bed);
    fallAsleep(who);

    this.posed.add(who.id);
    return who;
  }

  /**
   * Sets the clock outright.
   *
   * The one piece of state a scenario assigns rather than routing through a mutator, and
   * only because there is nothing to route through: time is a counter the tick loop
   * increments, and the debug panel's skip-to-hour sets it exactly like this. Nothing is
   * simulated, which is the point — "show me this at night" must not mean "play until
   * night", or every scenario would be at the mercy of what the colony did on the way.
   */
  timeOfDay(when: HourName | number): void {
    this.activeSimulation().world.tick = tickAtHour(typeof when === 'number' ? when : HOURS[when]);
  }

  tick(ticks: number): void {
    this.activeSimulation().run(ticks);
  }

  /** The blueprint route: the player's own build command, finished on the spot. */
  private placeBuilt(
    def: BuildingId,
    buildable: BuildableId,
    at: TilePos,
    rotation: Rotation,
  ): Building {
    const simulation = this.activeSimulation();
    const world = simulation.world;
    const before = world.buildings.size;

    simulation.dispatch({
      type: 'build',
      buildable,
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: at.z },
      rotation,
      instant: true,
    });
    // Applied now, without advancing time. A scenario places several things in a row and
    // each has to be in the world before the next one asks whether its cells are free.
    simulation.flushCommands();

    // The command refuses silently, by design — a drag along a wall must not abort
    // because one cell of it was taken. A scenario is the opposite case: it asked for
    // exactly this, so nothing arriving is a failure and has to say so.
    const placed = buildingAt(world, world.map.idx(at.x, at.y, at.z));
    if (world.buildings.size === before || !placed) {
      throw new Error(describeFailure(def, at, rotation));
    }
    return placed;
  }

  /**
   * The route for what the landing party brought: straight into the store, stamping no
   * cells at all, exactly as `placeBedrolls` does — a bedroll is passable and seals no
   * room, so it owes the map no flags.
   *
   * Checks `buildingAt` as well as `isStorable`, where `placeBedrolls` uses its own set
   * of claimed cells instead. Storability cannot see a *passable* building: without the
   * second check two bedrolls would happily share a cell and the picture would show one.
   */
  private placeStarting(def: BuildingId, at: TilePos, rotation: Rotation): Building {
    const world = this.activeSimulation().world;
    const map = world.map;

    /*
     * Only for something that owes the map nothing. Today that is the bedroll and only
     * the bedroll, but the next building added without a blueprint might block movement
     * or seal a room — and stamping those flags here would be a second, quieter copy of
     * `completeConstruction`. Refusing says so out loud instead of shipping a wall
     * colonists walk through.
     */
    const structure = buildingDef(def);
    if (!structure.passable || structure.blocksRoom) {
      throw new Error(
        `scenario: ${structure.name} has no blueprint, and this route stamps no cells — ` +
          'give it a buildable, or it would stand there and stop nothing',
      );
    }

    for (const cell of cellsOf(at, footprintOfBuilding(def), rotation)) {
      const clear =
        map.isStorable(cell.x, cell.y, cell.z) &&
        !buildingAt(world, map.idx(cell.x, cell.y, cell.z));
      if (!clear) throw new Error(describeFailure(def, at, rotation));
    }

    return world.buildings.add((id) => createBuilding(id, def, at, rotation));
  }

  private nextUnposedColonist(): Pawn | null {
    for (const pawn of this.world.pawns.values()) {
      if (!pawn.dead && !this.posed.has(pawn.id)) return pawn;
    }
    return null;
  }

  private startSimulation(size: number): Simulation {
    const simulation = new Simulation({
      seed: SCENARIO_SEED,
      width: size,
      height: size,
      colonists: SCENARIO_COLONISTS,
    });
    this.simulation = simulation;
    return simulation;
  }

  /**
   * The world a scenario forgot to ask for.
   *
   * Built on demand rather than in the constructor, so a scenario opening with `flat(28)`
   * does not first pay for a full-size map it throws away unlooked at.
   */
  private activeSimulation(): Simulation {
    return this.simulation ?? this.startSimulation(SCENARIO_SIZE);
  }
}

/** One phrasing of the refusal, so both routes fail the same way. */
function describeFailure(def: BuildingId, at: TilePos, rotation: Rotation): string {
  return (
    `scenario: could not place ${buildingDef(def).name} at ${at.x},${at.y},${at.z} ` +
    `rotation ${rotation} — those cells are occupied, off the map, or not ground ` +
    'anything can be built on'
  );
}

/** Runs a scenario and hands back the world it described. */
export function buildScenario(scenario: Scenario): World {
  return runScenario(scenario).world;
}

/** The same, plus the cells it placed on — which is what a camera needs to frame it. */
export function runScenario(scenario: Scenario): {
  world: World;
  touched: readonly TilePos[];
} {
  const builder = new Builder();
  scenario.build(builder);
  return { world: builder.world, touched: builder.touched };
}
