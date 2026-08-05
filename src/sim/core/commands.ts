/**
 * The only channel through which the outside world may change the simulation.
 *
 * UI and input never mutate sim state directly. They push Commands onto this queue,
 * and the sim drains it at the start of each tick. That keeps mutation ordered and
 * deterministic — which is what makes save/load, replay, and reproducible bug
 * reports possible.
 *
 * This union grows one entry per milestone. M2 adds designations and work priorities.
 */

import type { EntityId } from './entityStore';
import type { TilePos } from './position';

export interface RegenerateCommand {
  readonly type: 'regenerate';
  readonly seed: number;
}

/**
 * A direct player order to walk somewhere.
 *
 * This is the first of the *direct control* commands — the half of the hybrid control
 * model the player drives by hand. In M2 it will need to preempt whatever job the pawn
 * was doing; the plumbing for that is the same queue.
 */
export interface MoveToCommand {
  readonly type: 'moveTo';
  readonly pawnId: EntityId;
  readonly target: TilePos;
}

export type Command = RegenerateCommand | MoveToCommand;

export class CommandQueue {
  private pending: Command[] = [];

  push(command: Command): void {
    this.pending.push(command);
  }

  /** Returns everything queued and clears the queue. Called once per tick. */
  drain(): Command[] {
    if (this.pending.length === 0) return [];
    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  get size(): number {
    return this.pending.length;
  }
}
