/**
 * The read-only view of the simulation that UI renders from.
 *
 * React must never read World directly, and must never re-render at 60fps. The app
 * loop publishes a snapshot roughly ten times a second; components subscribe to that.
 * Anything the UI needs goes here as plain, already-computed data — a snapshot should
 * be cheap to build and impossible to mutate the sim through.
 */

import { daylight, formatTime, timeOfDay } from './world/time';
import type { World } from './world/world';

export interface SimSnapshot {
  readonly tick: number;
  readonly seed: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly clock: string;
  readonly daylight: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

export function buildSnapshot(world: World): SimSnapshot {
  const time = timeOfDay(world.tick);
  return {
    tick: world.tick,
    seed: world.seed,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    clock: formatTime(time),
    daylight: daylight(world.tick),
    mapWidth: world.map.width,
    mapHeight: world.map.height,
  };
}
