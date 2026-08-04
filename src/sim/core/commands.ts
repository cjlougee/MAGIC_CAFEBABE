/**
 * The only channel through which the outside world may change the simulation.
 *
 * UI and input never mutate sim state directly. They push Commands onto this queue,
 * and the sim drains it at the start of each tick. That keeps mutation ordered and
 * deterministic — which is what makes save/load, replay, and reproducible bug
 * reports possible.
 *
 * This union grows one entry per milestone. M1 adds MoveTo, M2 adds designations.
 */

export interface RegenerateCommand {
  readonly type: 'regenerate';
  readonly seed: number;
}

export type Command = RegenerateCommand;

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
