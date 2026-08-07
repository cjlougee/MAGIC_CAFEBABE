/**
 * Needs — the clocks that make colonists act without being told.
 *
 * Each need falls from 1 (satisfied) to 0 (desperate) at a fixed rate. A need dropping
 * below `seekBelow` produces a job that outranks *all* work, which is what stops a
 * colonist starving to death beside a stockpile because hauling had priority 1.
 *
 * Rates are expressed as "days to empty" and converted, because that is the unit the
 * design is actually reasoned in — nobody has intuitions about per-tick floats.
 */

import { TICKS_PER_DAY } from '../core/constants';

export const Need = {
  Hunger: 0,
  Rest: 1,
} as const;

export type NeedId = (typeof Need)[keyof typeof Need];

export interface NeedDef {
  readonly id: NeedId;
  readonly label: string;
  /** How much is lost each tick. */
  readonly fallPerTick: number;
  /** Below this, the colonist stops working and deals with it. */
  readonly seekBelow: number;
  /** Below this, they are in trouble and the player should be told. */
  readonly warnBelow: number;
}

function perDay(days: number): number {
  return 1 / (TICKS_PER_DAY * days);
}

/** Indexed by NeedId — array position must equal `id`. */
export const NEED_DEFS: readonly NeedDef[] = [
  {
    id: Need.Hunger,
    label: 'Hunger',
    // A colonist eats a little under twice a day, so a full belly lasts most of one.
    fallPerTick: perDay(0.85),
    seekBelow: 0.35,
    warnBelow: 0.15,
  },
  {
    id: Need.Rest,
    label: 'Rest',
    fallPerTick: perDay(1.1),
    seekBelow: 0.3,
    warnBelow: 0.12,
  },
];

export const NEED_COUNT = NEED_DEFS.length;

export function needDef(id: NeedId): NeedDef {
  return NEED_DEFS[id];
}

/** Colonists start rested and fed, but not brimming — day one should still have stakes. */
export function startingNeeds(): number[] {
  return [0.8, 0.85];
}

/** Rest regained per tick while asleep. A full night restores a full bar. */
export const REST_PER_SLEEPING_TICK = 1 / (TICKS_PER_DAY * 0.34);

/** Health lost per tick at zero hunger. Slow enough to be a warning, not a guillotine. */
export const STARVATION_DAMAGE_PER_TICK = 1 / (TICKS_PER_DAY * 2.5);
