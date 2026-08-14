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

import { driverFor } from '../sim/ai/jobDrivers';
import { bedHeadCell } from '../sim/ai/needs';
import { interrupt, startJob, tickJob } from '../sim/ai/think';
import type { EntityId } from '../sim/core/entityStore';
import type { TilePos } from '../sim/core/position';
import { buildableDef, buildableProducing, type BuildableId } from '../sim/defs/buildables';
import { buildingDef, type BuildingId } from '../sim/defs/buildings';
import type { TerrainId } from '../sim/defs/terrain';
import { buildingCells, createBuilding, isBed, type Building } from '../sim/entities/building';
import { stopMoving, type Pawn } from '../sim/entities/pawn';
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

  /**
   * One flat terrain, edge to edge — no rock, water or ruins to read past.
   *
   * Not an *empty* world: the landing party still arrives, so the middle of the map holds
   * colonists and the bedrolls they came with. Anything placed near the centre will
   * collide with them, which is why `beds.ts` lays its row along the top.
   */
  flat(size?: number, terrain?: TerrainId): void;
  /** The world as worldgen makes it — rock, water, ruins and all. */
  generated(size?: number): void;
  /** Raises a finished structure, or throws saying which one it could not raise. */
  place(def: BuildingId, at: TilePos, rotation?: Rotation): Building;
  /**
   * Lays a surface — a floor, a carpet — on one cell.
   *
   * Through the same build command `place` uses, which means it inherits the rule that
   * **surfaces do not stack**: laying carpet over a stone floor throws here rather than
   * quietly producing a cell the game would have refused. A scenario that could reach
   * states the player cannot is worse than no scenario.
   */
  floor(at: TilePos, buildable: BuildableId): void;
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

  floor(at: TilePos, buildable: BuildableId): void {
    const simulation = this.activeSimulation();
    const world = simulation.world;
    const index = world.map.idx(at.x, at.y, at.z);
    const before = world.map.terrainAt(index);

    simulation.dispatch({
      type: 'build',
      buildable,
      area: { x0: at.x, y0: at.y, x1: at.x, y1: at.y, z: at.z },
      instant: true,
    });
    simulation.flushCommands();

    if (world.map.terrainAt(index) === before) {
      throw new Error(
        `scenario: could not lay ${buildableDef(buildable).name} at ${at.x},${at.y},${at.z} — ` +
          'the cell is occupied, not storable, or already carries a surface the colony laid',
      );
    }
    this.placed.push(at);
  }

  /**
   * Puts a colonist to sleep in a bed — by giving them the colony's own sleep job and
   * running it, not by setting a flag.
   *
   * Calling `fallAsleep` alone looked right and was not. In the game `asleep` is only ever
   * true *inside* an active sleep job: the job holds a reservation on the bed, and
   * `endJob` is what clears the flag again. A pawn with `asleep === true` and `job ===
   * null` is a state one tick of the real game can never produce — nobody had claimed the
   * bed, so a second colonist could be sent to it, and `tickPawnAI` does not skip sleeping
   * pawns, so the posed sleeper could be handed hauling while still drawn in bed.
   *
   * So the job is built exactly as `findNeedJob` builds it, down to `spot`, and then
   * driven. That is the harness rule one level in: *calling the mutator is not the whole
   * transition*. What is still skipped is only the choosing — whether this colonist wanted
   * this bed, and the walk across the map to reach it.
   */
  sleeperIn(bed: Building, pawn?: Pawn): Pawn {
    if (!isBed(bed)) {
      throw new Error(`scenario: a ${buildingDef(bed.def).name} is not something to sleep in`);
    }

    const world = this.activeSimulation().world;
    const who = pawn ?? this.nextUnposedColonist();
    if (!who) {
      throw new Error(
        `scenario: no colonist left to sleep in the ${buildingDef(bed.def).name} at ` +
          `${bed.pos.x},${bed.pos.y} — the world was built with ${SCENARIO_COLONISTS}`,
      );
    }

    // Enforcement rule 3 at the point of use, the same way a player order takes a pawn:
    // whatever they were doing ends through `endJob` and gives its reservations back,
    // rather than being overwritten and leaking them.
    interrupt(world, who, 'posed by a scenario');

    // The walk is what a scenario skips, so the pawn simply arrives. `stopMoving` first,
    // the same pair `escapeIfTrapped` uses: `pawn.pos` is the tile a walking colonist is
    // *leaving*, so a pawn caught mid-step would be drawn sliding out of the bed.
    const spot = bedHeadCell(bed);
    stopMoving(who);
    who.pos = spot;

    startJob(who, { kind: 'sleep', bed: bed.id, spot });
    this.driveToSleep(world, who, bed);

    this.posed.add(who.id);
    return who;
  }

  /**
   * Runs the sleep driver until the colonist is actually asleep.
   *
   * Toil by toil, through `tickJob`, because that is the only thing that can produce the
   * real state: the first toil claims the bed, the second is already satisfied because the
   * pawn was put on the spot, and the third is what calls `fallAsleep`. Bounded by the
   * driver's own length, and loud if it runs out — if the sleep job ever grows a toil that
   * a posed pawn cannot satisfy standing still, this must fail rather than quietly hand
   * back a colonist who is awake.
   */
  private driveToSleep(world: World, who: Pawn, bed: Building): void {
    for (const _toil of driverFor('sleep')) {
      if (who.asleep) break;
      tickJob(world, who);
      if (!who.job) break;
    }

    if (!who.asleep || !who.job) {
      throw new Error(
        `scenario: could not put ${who.name} to sleep in the ${buildingDef(bed.def).name} at ` +
          `${bed.pos.x},${bed.pos.y} — the sleep job ended instead of running`,
      );
    }
  }

  /**
   * Skips to an hour, exactly as the debug panel's Skip-to does.
   *
   * The command, not `world.tick = n`, and the difference is not cosmetic: `setHour` only
   * ever moves time **forward**, to the next occurrence of the hour asked for. Assigning
   * the clock directly would wind it back past `STARTING_TICK` for any hour before 08:00
   * and strand everything that had already happened in the future — a transition the game
   * refuses, which makes it exactly the kind a scenario may not invent. `dawn` therefore
   * lands on the following day, which is still a pure function of the hour and still the
   * same picture every run.
   *
   * Nothing is simulated, which is the point: "show me this at night" must not mean "play
   * until night", or every scenario would be at the mercy of what the colony did on the
   * way there.
   */
  timeOfDay(when: HourName | number): void {
    const simulation = this.activeSimulation();
    simulation.dispatch({
      type: 'debug',
      action: 'setHour',
      hour: typeof when === 'number' ? when : HOURS[when],
    });
    simulation.flushCommands();
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

    /*
     * Both cleared, because both describe the world being replaced. `touched` is what the
     * camera frames, so a cell left over from a discarded world would point it at ground
     * that no longer holds anything — a picture of something that is not there, which is
     * the one failure this harness exists to prevent. `posed` names pawns that do not
     * exist in the new world either.
     */
    this.placed.length = 0;
    this.posed.clear();

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
