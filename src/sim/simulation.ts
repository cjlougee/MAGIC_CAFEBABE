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

import { tickMovement } from './ai/movement';
import { interrupt, isThinkTick, tickJob, tickPawnAI } from './ai/think';
import {
  CommandQueue,
  type Command,
  type DesignateCommand,
  type MoveToCommand,
  type SetWorkPriorityCommand,
  type TileRectangle,
  type ZoneCommand,
} from './core/commands';
import { clearPath } from './entities/pawn';
import { isMineable } from './defs/terrain';
import { PRIORITY_DISABLED, PRIORITY_LOWEST, WORK_TYPE_COUNT } from './defs/workTypes';
import { buildSnapshot, type SimSnapshot } from './snapshot';
import { Designation } from './world/designations';
import { createWorld, type World, type WorldOptions } from './world/world';

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

    // Insertion order, which is stable — pawns must not act in a different sequence
    // between runs or determinism breaks.
    for (const pawn of world.pawns.values()) {
      if (pawn.job) tickJob(world, pawn);
      else if (isThinkTick(world, pawn)) tickPawnAI(world, pawn);
    }

    for (const pawn of world.pawns.values()) {
      tickMovement(world.map, pawn);
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

  private applyCommands(): void {
    for (const command of this.commands.drain()) {
      switch (command.type) {
        case 'regenerate':
          this.worldState = createWorld(command.seed, this.options);
          break;
        case 'moveTo':
          this.applyMoveTo(command);
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
      }
    }
  }

  private applyMoveTo(command: MoveToCommand): void {
    const world = this.worldState;
    const pawn = world.pawns.get(command.pawnId);
    if (!pawn) return;

    /*
     * Enforcement rule 3 at the point of use: a direct order preempts autonomous work.
     * interrupt() ends the job and releases its reservations before we plan anything,
     * so the rock this pawn had claimed becomes available to someone else immediately
     * rather than staying locked until the pawn happens to be reassigned.
     */
    interrupt(world, pawn, 'player order');

    /*
     * Plan from where the pawn will *be*, not where it is.
     *
     * A pawn caught mid-step is between two tiles; `pos` is the one it is leaving.
     * Routing from there would either double back or require snapping it backwards.
     */
    const origin = pawn.moveTarget ?? pawn.pos;

    // O(1) rejection before spending a search. Without this, ordering a pawn onto an
    // island runs a full flood of the map every time the player misclicks.
    if (!world.reachability.canReach(origin, command.target)) return;

    const result = world.pathfinder.find(origin, command.target);
    if (!result) return;

    pawn.path = result.steps;
    pawn.pathIndex = 0;
  }

  private applyDesignate(command: DesignateCommand): void {
    const world = this.worldState;

    this.forEachCell(command.area, (index) => {
      if (command.action === 'cancel') {
        world.designations.remove(Designation.Mine, index);
        return;
      }
      // Only solid terrain can be mined; marking open ground would create work that
      // can never be completed and a designation the player can't explain.
      if (!isMineable(world.map.terrainAt(index))) return;
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
      // A stockpile inside a wall would accept haul jobs nobody can complete.
      if (world.map.walkCost[index] === 0) return;
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
