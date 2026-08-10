/**
 * The simulation's public surface.
 *
 * Everything outside sim/ talks to the game through this class and nothing else:
 * dispatch() to request change, tick() to advance, snapshot() to read.
 *
 * tick() is the only place world state advances, and it advances by exactly one step.
 * How *many* steps run per frame is the game loop's business, not the sim's — that
 * separation is what keeps the simulation frame-rate independent and deterministic.
 */

import { TICKS_PER_DAY, TICKS_PER_HOUR } from './core/constants';
import { tickMovement } from './ai/movement';
import { tickBreak, tickMood } from './ai/mood';
import { tickNeeds } from './ai/needs';
import { interrupt, isThinkTick, tickJob, tickPawnAI } from './ai/think';
import { growPlants } from './world/growth';
import {
  CommandQueue,
  type BillCommand,
  type BuildCommand,
  type Command,
  type DebugCommand,
  type DesignateCommand,
  type MoveToCommand,
  type MovePartyCommand,
  type SetDraftedCommand,
  type SetWorkPriorityCommand,
  type TileRectangle,
  type ZoneCommand,
} from './core/commands';
import { buildingCells } from './entities/building';
import { createSite, type ConstructionSite } from './entities/constructionSite';
import { cancelConstruction, completeConstruction, setLocked } from './world/construction';
import { buildingAt, pawnOccupies, siteAt } from './world/lookup';
import { clearPath, type Pawn } from './entities/pawn';
import { GROUND_LEVEL, type TilePos } from './core/position';

import { PRIORITY_DISABLED, PRIORITY_LOWEST, WORK_TYPE_COUNT } from './defs/workTypes';
import { buildableDef } from './defs/buildables';
import { buildingDef } from './defs/buildings';
import { recipeDef, recipesFor } from './defs/recipes';
import type { Building } from './entities/building';
import { ledgerContents } from './entities/materials';
import { deserializeWorld, serializeWorld, type SaveData } from './save/serialize';
import { buildSnapshot, type SimSnapshot } from './snapshot';
import { Designation } from './world/designations';
import {
  canDesignateDeconstruct,
  canDesignateMine,
  canPlaceFootprint,
  orientToNeighbours,
  canPlaceStockpile,
} from './world/placement';
import { createWorld, type World, type WorldOptions } from './world/world';

/**
 * How far from a party's target we will look for somewhere to stand.
 *
 * Generous enough to fan a squad out around a doorway, small enough that a party sent
 * somewhere genuinely crowded bunches up rather than scattering across the district.
 */
const PARTY_SPREAD_RADIUS = 6;

export interface SimulationOptions extends WorldOptions {
  readonly seed?: number;
}

export class Simulation {
  private commands = new CommandQueue();
  private worldState: World;
  private readonly options: WorldOptions;

  constructor(options: SimulationOptions = {}) {
    const { seed = 1, ...worldOptions } = options;
    this.options = worldOptions;
    this.worldState = createWorld(seed, worldOptions);
  }

  get world(): World {
    return this.worldState;
  }

  /** Queue a change. Applied at the start of the next tick, never immediately. */
  dispatch(command: Command): void {
    this.commands.push(command);
  }

  /**
   * Advance the world by exactly one simulation step.
   *
   * Order matters. Commands first, so player intent lands before anything reacts to it.
   * Then AI and jobs, which may set a route. Then movement, which walks that route —
   * a step planned this tick therefore begins next tick, never mid-tick.
   */
  tick(): void {
    const world = this.worldState;
    this.applyCommands();

    growPlants(world);

    // Insertion order, which is stable — pawns must not act in a different sequence
    // between runs or determinism breaks.
    for (const pawn of world.pawns.values()) {
      if (pawn.dead) continue;

      // Needs and mood advance before decisions, so a colonist decides using the state
      // they are actually in rather than last tick's.
      tickNeeds(pawn);
      tickMood(pawn);
      tickBreak(pawn);

      if (pawn.job) tickJob(world, pawn);
      else if (isThinkTick(world, pawn)) tickPawnAI(world, pawn);
    }

    for (const pawn of world.pawns.values()) {
      if (!pawn.dead && !pawn.asleep) tickMovement(world.map, pawn);
    }

    world.tick++;
  }

  /** Advance by n steps. Convenience for tests and the headless harness. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  /**
   * Applies queued commands without advancing time.
   *
   * Needed because commands normally land at the start of a tick, and while the game
   * is paused no tick ever arrives — so a paused player's actions would silently
   * queue up forever, or force us to sneak in a tick and corrupt the clock.
   */
  flushCommands(): void {
    this.applyCommands();
  }

  snapshot(): SimSnapshot {
    return buildSnapshot(this.worldState);
  }

  /** A JSON-safe capture of the whole colony. Where it is stored is the app's problem. */
  save(): SaveData {
    return serializeWorld(this.worldState);
  }

  /**
   * Replaces the world with a saved one.
   *
   * Any queued commands are dropped: they were aimed at the world being replaced, and
   * applying them to a different one would act on entity ids that mean something else.
   */
  load(save: SaveData): void {
    this.commands.drain();
    this.worldState = deserializeWorld(save);
  }

  private applyCommands(): void {
    for (const command of this.commands.drain()) {
      switch (command.type) {
        case 'regenerate':
          this.worldState = createWorld(command.seed, this.options);
          break;
        case 'moveTo':
          this.applyMoveTo(command);
          break;
        case 'moveParty':
          this.applyMoveParty(command);
          break;
        case 'setDrafted':
          this.applySetDrafted(command);
          break;
        case 'designate':
          this.applyDesignate(command);
          break;
        case 'zone':
          this.applyZone(command);
          break;
        case 'setWorkPriority':
          this.applyWorkPriority(command);
          break;
        case 'build':
          this.applyBuild(command);
          break;
        case 'bill':
          this.applyBill(command);
          break;
        case 'setLocked': {
          const door = this.worldState.buildings.get(command.building);
          if (door) setLocked(this.worldState, door, command.locked);
          break;
        }
        case 'debug':
          this.applyDebug(command);
          break;
      }
    }
  }

  /**
   * Standing orders on a workbench.
   *
   * Removing the last bill empties the bench onto the ground. Ingredients with no bill
   * left to consume them are invisible and unreachable — the player would see berries
   * missing from the larder and nothing anywhere to explain where they went.
   */
  private applyBill(command: BillCommand): void {
    const world = this.worldState;
    const bench = world.buildings.get(command.bench);
    if (!bench) return;

    const existing = bench.bills.findIndex((bill) => bill.recipe === command.recipe);

    switch (command.action) {
      case 'add': {
        // Only what this bench can actually make, and never the same recipe twice —
        // a second identical bill would be a quota arguing with itself.
        if (existing >= 0) return;
        if (!recipesFor(bench.def).some((recipe) => recipe.id === command.recipe)) return;
        bench.bills.push({
          recipe: command.recipe,
          untilCount: recipeDef(command.recipe).defaultUntilCount,
        });
        return;
      }

      case 'remove': {
        if (existing < 0) return;
        bench.bills.splice(existing, 1);
        if (bench.bills.length === 0) this.emptyBench(bench);
        return;
      }

      case 'setCount': {
        if (existing < 0 || command.untilCount === undefined) return;
        // A negative quota would mean "cook until you have less than nothing".
        bench.bills[existing].untilCount = Math.max(0, Math.floor(command.untilCount));
        return;
      }
    }
  }

  /** Puts everything loaded into a bench back on the ground beside it. */
  private emptyBench(bench: Building): void {
    const world = this.worldState;
    for (const held of ledgerContents(bench.loaded)) {
      world.items.spawn(world.map, held.def, held.count, bench.pos);
      bench.loaded[held.def] = 0;
    }
  }

  private applyBuild(command: BuildCommand): void {
    const world = this.worldState;

    const rotation = command.rotation ?? 0;

    this.forEachCell(command.area, (index) => {
      const pos = {
        x: world.map.xOf(index),
        y: world.map.yOf(index),
        z: world.map.zOf(index),
      };
      // The whole footprint has to be free, not just the cell under the cursor. Checked
      // per candidate rather than once for the area, because a drag places many and each
      // one is its own question — and because sites placed earlier in the same drag are
      // already in the world for the next one to collide with.
      if (!canPlaceFootprint(world, pos, command.buildable, rotation)) return;

      // A door lines itself up with the wall run it interrupts. Per cell, because a drag
      // along a wall can lay several and each one answers for its own neighbours.
      const facing = orientToNeighbours(world, pos, command.buildable, rotation);
      const site = world.sites.add((id) => createSite(id, command.buildable, pos, facing));
      if (command.instant) this.finishSite(site);
    });
  }

  /**
   * Completes a site now, if it is safe to.
   *
   * Refuses a blocking structure on a cell somebody is standing in. `toilWork` waits for
   * that rather than failing, and skipping the wait must not mean skipping the check: a
   * pawn sealed into an impassable cell reports its own position as unreachable, so
   * `canReach` fails for every target and it idles forever with nothing to show why. The
   * worst state in the simulation is not one to hand a debug button.
   */
  private finishSite(site: ConstructionSite): boolean {
    const world = this.worldState;
    const index = world.map.idx(site.pos.x, site.pos.y, site.pos.z);
    const result = buildableDef(site.def).result;

    if (
      result.kind === 'building' &&
      !buildingDef(result.building).passable &&
      pawnOccupies(world, index)
    ) {
      return false;
    }

    completeConstruction(world, site);
    return true;
  }

  /**
   * Cheats. Everything here changes the world in ways play never would.
   *
   * Time only moves *forward*, to the next occurrence of the hour asked for. Winding the
   * clock back would leave anything that has already happened sitting in the future, and
   * "skip to nightfall" is what the button is for anyway.
   */
  private applyDebug(command: DebugCommand): void {
    const world = this.worldState;

    switch (command.action) {
      case 'setHour': {
        if (command.hour === undefined) return;
        const target = Math.max(0, Math.min(23, Math.floor(command.hour)));
        const dayStart = Math.floor(world.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
        const at = dayStart + target * TICKS_PER_HOUR;
        world.tick = at > world.tick ? at : at + TICKS_PER_DAY;
        return;
      }

      case 'giveItems': {
        if (command.item === undefined || !command.count) return;
        // Through the normal spawn path, so it spills onto storable ground and obeys
        // stack limits exactly as mined stone does.
        world.items.spawn(world.map, command.item, command.count, world.landingSite);
        return;
      }

      case 'finishBlueprints': {
        // Snapshotted first: finishing mutates the store being iterated.
        for (const site of [...world.sites.values()]) this.finishSite(site);
        return;
      }
    }
  }

  private applyMoveTo(command: MoveToCommand): void {
    const pawn = this.worldState.pawns.get(command.pawnId);
    if (pawn) this.orderPawnTo(pawn, command.target);
  }

  /**
   * Sends a party, fanned out so they arrive as a group rather than as a queue.
   *
   * Each pawn is given the nearest free standable cell to the target that nobody ahead
   * of them has claimed. Assignment walks the party in the order given, so the same
   * order always produces the same arrangement — a spread that varied run to run would
   * break determinism for something purely cosmetic.
   */
  private applyMoveParty(command: MovePartyCommand): void {
    const world = this.worldState;
    const taken = new Set<number>();

    for (const pawnId of command.pawnIds) {
      const pawn = world.pawns.get(pawnId);
      if (!pawn || pawn.dead) continue;

      const cell = this.freeCellNear(command.target, taken);
      if (!cell) continue;

      taken.add(world.map.idx(cell.x, cell.y, cell.z));
      this.orderPawnTo(pawn, cell);
    }
  }

  /** Nearest standable, unclaimed cell to `target`, searched in rings. */
  private freeCellNear(target: TilePos, taken: ReadonlySet<number>): TilePos | null {
    const map = this.worldState.map;
    const z = target.z ?? GROUND_LEVEL;

    for (let radius = 0; radius <= PARTY_SPREAD_RADIUS; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // Ring only — the interior was covered by a smaller radius.
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

          const x = target.x + dx;
          const y = target.y + dy;
          if (!map.isPassable(x, y, z)) continue;
          if (taken.has(map.idx(x, y, z))) continue;

          return { x, y, z };
        }
      }
    }
    return null;
  }

  /** The whole of a direct order: preempt, draft, remember, path. */
  private orderPawnTo(pawn: Pawn, target: TilePos): void {
    const world = this.worldState;

    /*
     * Enforcement rule 3 at the point of use: a direct order preempts autonomous work.
     * interrupt() ends the job and releases its reservations before we plan anything,
     * so the rock this pawn had claimed becomes available to someone else immediately
     * rather than staying locked until the pawn happens to be reassigned.
     */
    interrupt(world, pawn, 'player order');

    /*
     * A direct order drafts.
     *
     * Without it the order had a lifetime of one think interval: `startJob` clears the
     * path, so the first work giver to reach this pawn threw away where the player had
     * sent them, and a colonist ordered across the map turned round and went back to
     * hauling. "Send someone somewhere" has to mean they stay sent.
     *
     * The target is stored as well as pathed, so eating on the way does not cancel it.
     */
    pawn.drafted = true;
    pawn.draftTarget = target;

    /*
     * Plan from where the pawn will *be*, not where it is.
     *
     * A pawn caught mid-step is between two tiles; `pos` is the one it is leaving.
     * Routing from there would either double back or require snapping it backwards.
     */
    const origin = pawn.moveTarget ?? pawn.pos;

    // O(1) rejection before spending a search. Without this, ordering a pawn onto an
    // island runs a full flood of the map every time the player misclicks. The target is
    // kept regardless, so an impossible order shows up as an alert rather than as a
    // colonist who quietly ignored you.
    if (!world.reachability.canReach(origin, target)) return;

    const result = world.pathfinder.find(origin, target);
    if (!result) return;

    pawn.path = result.steps;
    pawn.pathIndex = 0;
  }

  /** Under direct command, or back to the work pool where they stand. */
  private applySetDrafted(command: SetDraftedCommand): void {
    for (const pawnId of command.pawnIds) {
      const pawn = this.worldState.pawns.get(pawnId);
      if (!pawn) continue;

      pawn.drafted = command.drafted;
      pawn.draftTarget = null;

      /*
       * Cleared in both directions, and for the same reason: whatever they were walking
       * toward, they are not walking toward it now. Drafting somebody who was hauling
       * stops them where they stand — which is what "hold" means — and releasing
       * somebody mid-errand should let them pick up work from here rather than finish a
       * journey they were only making under orders.
       */
      if (pawn.job) interrupt(this.worldState, pawn, 'draft change');
      clearPath(pawn);
    }
  }

  private applyDesignate(command: DesignateCommand): void {
    const world = this.worldState;

    this.forEachCell(command.area, (index) => {
      if (command.action === 'cancel') {
        world.designations.remove(Designation.Mine, index);
        // Clearing a demolition mark is undoing a mark, so it belongs here. Erase never
        // takes down anything finished — a standing wall is not a mark. Cleared across
        // the whole structure for the same reason it was marked across it: half a mark
        // on a hearth is a state the player cannot see or act on.
        const marked = buildingAt(world, index);
        for (const cell of marked ? buildingCells(marked) : []) {
          world.designations.remove(Designation.Deconstruct, world.map.idx(cell.x, cell.y, cell.z));
        }
        world.designations.remove(Designation.Deconstruct, index);
        // Erasing should undo whatever the player put here, including a blueprint they
        // no longer want — with the delivered materials handed back.
        const site = siteAt(world, index);
        if (site) cancelConstruction(world, site);
        return;
      }

      if (command.action === 'deconstruct') {
        // Marking natural rock or an empty field would create work no colonist can do
        // and a mark the player can't explain.
        if (!canDesignateDeconstruct(world, index)) return;

        // A structure is marked whole. Buildings are shown as marked by *tinting the
        // sprite*, so a 2x2 hearth with one cell marked would tint entirely while three
        // of its cells carried no designation — the player would see a finished order
        // and the givers would see a quarter of one.
        const building = buildingAt(world, index);
        for (const cell of building ? buildingCells(building) : []) {
          world.designations.add(Designation.Deconstruct, world.map.idx(cell.x, cell.y, cell.z));
        }
        if (!building) world.designations.add(Designation.Deconstruct, index);
        return;
      }

      // Marking open ground would create work that can never be completed and a
      // designation the player can't explain.
      if (!canDesignateMine(world.map, index)) return;
      world.designations.add(Designation.Mine, index);
    });
  }

  private applyZone(command: ZoneCommand): void {
    const world = this.worldState;

    this.forEachCell(command.area, (index) => {
      if (command.action === 'clear') {
        world.zones.removeStockpile(index);
        return;
      }
      if (!canPlaceStockpile(world.map, index)) return;
      world.zones.addStockpile(index);
    });
  }

  private applyWorkPriority(command: SetWorkPriorityCommand): void {
    const pawn = this.worldState.pawns.get(command.pawnId);
    if (!pawn) return;
    if (command.workType < 0 || command.workType >= WORK_TYPE_COUNT) return;

    const priority = Math.max(PRIORITY_DISABLED, Math.min(PRIORITY_LOWEST, command.priority));
    pawn.priorities[command.workType] = priority;

    // Losing the ability to do the job you are currently doing should stop you doing it.
    if (priority === PRIORITY_DISABLED && pawn.job) {
      interrupt(this.worldState, pawn, 'work type disabled');
      clearPath(pawn);
    }
  }

  private forEachCell(area: TileRectangle, visit: (index: number) => void): void {
    const map = this.worldState.map;
    for (let y = area.y0; y <= area.y1; y++) {
      for (let x = area.x0; x <= area.x1; x++) {
        if (!map.inBounds(x, y, area.z)) continue;
        visit(map.idx(x, y, area.z));
      }
    }
  }
}
