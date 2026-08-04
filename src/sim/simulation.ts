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

import { CommandQueue, type Command } from './core/commands';
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
    const commands = this.commands.drain();
    for (const command of commands) {
      switch (command.type) {
        case 'regenerate':
          this.worldState = createWorld(command.seed, this.options);
          break;
      }
    }
  }
}
