/**
 * Converting the tick counter into readable time, and into a daylight curve.
 *
 * The daylight curve is piecewise linear rather than a sine wave on purpose: Math.sin
 * has implementation-defined precision, and anything the simulation branches on has
 * to be portable. It also gives direct control over how long dawn and dusk last,
 * which matters more for feel than mathematical elegance does.
 */

import { HOURS_PER_DAY, TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/constants';

export interface TimeOfDay {
  /** Zero-based day number since the colony landed. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function timeOfDay(tick: number): TimeOfDay {
  const dayTick = tick % TICKS_PER_DAY;
  const hour = Math.floor(dayTick / TICKS_PER_HOUR);
  const minute = Math.floor(((dayTick % TICKS_PER_HOUR) / TICKS_PER_HOUR) * 60);
  return { day: Math.floor(tick / TICKS_PER_DAY), hour, minute };
}

/** Fractional hour in [0, 24). */
export function hourOfDay(tick: number): number {
  return ((tick % TICKS_PER_DAY) / TICKS_PER_HOUR) % HOURS_PER_DAY;
}

const DAWN_START = 5;
const DAWN_END = 8;
const DUSK_START = 18;
const DUSK_END = 21;

/** 0 = full night, 1 = full daylight. Presentation only — nothing branches on it. */
export function daylight(tick: number): number {
  const hour = hourOfDay(tick);
  if (hour < DAWN_START || hour >= DUSK_END) return 0;
  if (hour < DAWN_END) return (hour - DAWN_START) / (DAWN_END - DAWN_START);
  if (hour < DUSK_START) return 1;
  return 1 - (hour - DUSK_START) / (DUSK_END - DUSK_START);
}

export function formatTime(time: TimeOfDay): string {
  const hh = String(time.hour).padStart(2, '0');
  const mm = String(time.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}
