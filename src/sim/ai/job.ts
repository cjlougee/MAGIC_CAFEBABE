/**
 * A job is **data**, not behaviour.
 *
 * That split is the whole design. A Job says *what* should happen ("mine this cell");
 * a JobDriver is a list of toils saying *how*; the pawn carries only an index into that
 * list. Because the job is plain data and the toils are looked up by kind, saving a
 * mid-job pawn means saving three numbers — no closures, no reconstructing a call
 * stack.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';

export type JobKind = 'mine' | 'haul';

export interface MineJob {
  readonly kind: 'mine';
  readonly cell: TilePos;
}

export interface HaulJob {
  readonly kind: 'haul';
  readonly item: EntityId;
  readonly to: TilePos;
}

export type Job = MineJob | HaulJob;

export interface ActiveJob {
  readonly job: Job;
  /** Index into the driver's toil list. */
  toilIndex: number;
  ticksInToil: number;
  /** Work accumulated by the current work toil. */
  workDone: number;
  /**
   * Failed path attempts in the current toil.
   *
   * A route can be planned successfully and then invalidated before the pawn arrives —
   * a wall goes up, a bridge comes down. Without a ceiling, the pawn re-plans, fails,
   * re-plans forever and the job never ends.
   */
  attempts: number;
}

export function createActiveJob(job: Job): ActiveJob {
  return { job, toilIndex: 0, ticksInToil: 0, workDone: 0, attempts: 0 };
}

export type JobOutcome = 'completed' | 'failed' | 'interrupted';
