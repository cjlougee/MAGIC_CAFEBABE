/**
 * The only channel through which the outside world may change the simulation.
 *
 * UI and input never mutate sim state directly. They push Commands onto this queue,
 * and the sim drains it at the start of each tick. That keeps mutation ordered and
 * deterministic — which is what makes save/load, replay, and reproducible bug
 * reports possible.
 *
 * Area commands carry a rectangle rather than a list of cells: a drag across a large
 * map would otherwise put thousands of coordinates on the queue for something the
 * simulation can expand itself in a loop.
 */

import type { BuildableId } from '../defs/buildables';
import type { WorkTypeId } from '../defs/workTypes';
import type { EntityId } from './entityStore';
import type { TilePos } from './position';

export interface RegenerateCommand {
  readonly type: 'regenerate';
  readonly seed: number;
}

/**
 * A direct player order to walk somewhere.
 *
 * Preempts whatever the pawn was doing — the direct-control half of the hybrid model
 * taking precedence over autonomous work.
 */
export interface MoveToCommand {
  readonly type: 'moveTo';
  readonly pawnId: EntityId;
  readonly target: TilePos;
}

export interface TileRectangle {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z: number;
}

/**
 * Marks cells for work, or clears existing marks.
 *
 * `cancel` removes *marks* — including a blueprint, which is only a mark until someone
 * builds it. It never takes down anything finished; that is what `deconstruct` marks a
 * colonist to go and do.
 */
export interface DesignateCommand {
  readonly type: 'designate';
  readonly action: 'mine' | 'deconstruct' | 'cancel';
  readonly area: TileRectangle;
}

/** Paints or erases stockpile cells. */
export interface ZoneCommand {
  readonly type: 'zone';
  readonly action: 'stockpile' | 'clear';
  readonly area: TileRectangle;
}

export interface SetWorkPriorityCommand {
  readonly type: 'setWorkPriority';
  readonly pawnId: EntityId;
  readonly workType: WorkTypeId;
  /** 0 disables the work type; 1 is most urgent. */
  readonly priority: number;
}

/** Places blueprints across an area, or clears the sites already there. */
export interface BuildCommand {
  readonly type: 'build';
  readonly buildable: BuildableId;
  readonly area: TileRectangle;
}

export type Command =
  | RegenerateCommand
  | MoveToCommand
  | DesignateCommand
  | ZoneCommand
  | SetWorkPriorityCommand
  | BuildCommand;

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

/** Normalises a drag into an ordered, inclusive rectangle. */
export function normaliseRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z: number,
): TileRectangle {
  return {
    x0: Math.min(ax, bx),
    y0: Math.min(ay, by),
    x1: Math.max(ax, bx),
    y1: Math.max(ay, by),
    z,
  };
}
