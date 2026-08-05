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
import { CommandQueue, type Command, type MoveToCommand } from './core/commands';
import { clearPath } from './entities/pawn';
import { buildSnapshot, type SimSnapshot } from './snapshot';
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

  /** Advance the world by exactly one simulation step. */
  tick(): void {
    this.applyCommands();

    // Iteration order is the entity store's insertion order, which is stable — pawns
    // must not move in a different sequence between runs or determinism breaks.
    for (const pawn of this.worldState.pawns.values()) {
      tickMovement(this.worldState.map, pawn);
    }

    this.worldState.tick++;
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
      }
    }
  }

  private applyMoveTo(command: MoveToCommand): void {
    const world = this.worldState;
    const pawn = world.pawns.get(command.pawnId);
    if (!pawn) return;

    /*
     * Plan from where the pawn will *be*, not where it is.
     *
     * A pawn caught mid-step is between two tiles; `pos` is the one it is leaving.
     * Routing from there would either double back or require snapping it backwards.
     * Planning from `moveTarget` lets the current step finish and the new route pick
     * up cleanly from there — a new order supersedes the old one without ever
     * teleporting a pawn.
     */
    const origin = pawn.moveTarget ?? pawn.pos;

    // O(1) rejection before spending a search. Without this, ordering a pawn onto an
    // island runs a full flood of the map every time the player misclicks.
    if (!world.reachability.canReach(origin, command.target)) {
      clearPath(pawn);
      return;
    }

    const result = world.pathfinder.find(origin, command.target);
    if (!result) {
      clearPath(pawn);
      return;
    }

    pawn.path = result.steps;
    pawn.pathIndex = 0;
  }
}
