/**
 * The read-only view of the simulation that UI renders from.
 *
 * React must never read World directly, and must never re-render at 60fps. The app
 * loop publishes a snapshot roughly ten times a second; components subscribe to that.
 * Anything the UI needs goes here as plain, already-computed data — a snapshot should
 * be cheap to build and impossible to mutate the sim through.
 *
 * The *renderer* is different: it reads World directly every frame, because
 * interpolating a pawn's walk at 10Hz would look like a slideshow. Both are read-only;
 * only the cadence differs.
 */

import { isMoving } from './entities/pawn';
import { daylight, formatTime, timeOfDay } from './world/time';
import type { World } from './world/world';

export interface PawnSummary {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly moving: boolean;
}

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
  readonly pawns: readonly PawnSummary[];
}

export function buildSnapshot(world: World): SimSnapshot {
  const time = timeOfDay(world.tick);

  const pawns: PawnSummary[] = [];
  for (const pawn of world.pawns.values()) {
    pawns.push({
      id: pawn.id,
      name: pawn.name,
      x: pawn.pos.x,
      y: pawn.pos.y,
      z: pawn.pos.z,
      moving: isMoving(pawn),
    });
  }

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
    pawns,
  };
}
