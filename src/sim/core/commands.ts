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
import type { ItemDefId } from '../defs/items';
import type { RecipeId } from '../defs/recipes';
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

/**
 * Sends several colonists to one place.
 *
 * Not a loop of `moveTo` in the input layer, because the interesting part is that they
 * must not all path to the *same cell* — four pawns given one tile would arrive as one
 * pawn and three colonists standing on the doorstep. Fanning them out is a decision
 * about the world, so it belongs in the simulation where it is deterministic and
 * testable rather than in a mouse handler.
 */
export interface MovePartyCommand {
  readonly type: 'moveParty';
  readonly pawnIds: readonly EntityId[];
  readonly target: TilePos;
}

/**
 * Hands a colonist back to the work pool.
 *
 * The inverse of the draft a move order implies. Without it, ordering somebody anywhere
 * would take them off work permanently and the only way back would be reloading.
 */
export interface UndraftCommand {
  readonly type: 'undraft';
  readonly pawnId: EntityId;
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
  /**
   * Skip the blueprint entirely and raise the finished structure.
   *
   * A debug affordance, but it lives on the ordinary build command rather than in
   * `DebugCommand` because it is the *same* placement decision — same legality rules,
   * same area, same cell filter. Duplicating that just to skip two phases would be a
   * second definition of where a wall may go, and those drift.
   */
  readonly instant?: boolean;
}

/**
 * Cheats, for developing against.
 *
 * Grouped under one command rather than scattered through the union so that everything
 * which is *not* real gameplay is visible in one place, and so the whole surface can be
 * dropped from a release build by not rendering the panel that sends it.
 *
 * They still go through the queue like everything else. A debug action that reached into
 * world state directly would be the one code path that could desync the snapshot or
 * break determinism, and it would be the least-tested one in the game.
 */
export interface DebugCommand {
  readonly type: 'debug';
  readonly action: 'setHour' | 'giveItems' | 'finishBlueprints';
  /** `setHour`: 0–23. Time only ever moves forward, to the next such hour. */
  readonly hour?: number;
  /** `giveItems`: what, and how much, dropped at the landing site. */
  readonly item?: ItemDefId;
  readonly count?: number;
}

/**
 * Adds a standing order to a workbench, removes one, or changes what "enough" means.
 *
 * One command rather than three, because all three are "the bills on this bench are now
 * different" and splitting them would give the sim three places to keep the same
 * invariants — a bench with no bills must not sit on stranded ingredients.
 */
export interface BillCommand {
  readonly type: 'bill';
  readonly action: 'add' | 'remove' | 'setCount';
  readonly bench: EntityId;
  readonly recipe: RecipeId;
  /** Only read by `setCount`. */
  readonly untilCount?: number;
}

export type Command =
  | RegenerateCommand
  | MoveToCommand
  | MovePartyCommand
  | UndraftCommand
  | DesignateCommand
  | ZoneCommand
  | SetWorkPriorityCommand
  | BuildCommand
  | BillCommand
  | DebugCommand;

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
