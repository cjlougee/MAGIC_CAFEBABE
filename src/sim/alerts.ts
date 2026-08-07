/**
 * Things the player needs to know about.
 *
 * Derived fresh from world state rather than raised as events, so an alert can never
 * be stale — the moment the situation resolves, the alert is simply not generated
 * again. Event-based alerts need dismissal logic and eventually lie.
 *
 * Kept deliberately short. An alerts panel that is always full is an alerts panel
 * nobody reads.
 */

import { moodOf } from './ai/mood';
import { isEdible } from './defs/items';
import { Need, needDef } from './defs/needs';
import { BREAK_THRESHOLD } from './defs/thoughts';
import { isOnGround } from './entities/item';
import type { World } from './world/world';

export type AlertLevel = 'info' | 'warning' | 'danger';

export interface Alert {
  readonly id: string;
  readonly level: AlertLevel;
  readonly text: string;
}

export function buildAlerts(world: World): Alert[] {
  const alerts: Alert[] = [];

  let edibleUnits = 0;
  for (const item of world.items.values()) {
    if (isOnGround(item) && isEdible(item.def)) edibleUnits += item.count;
  }

  const living = [...world.pawns.values()].filter((pawn) => !pawn.dead);
  const dead = world.pawns.size - living.length;

  if (dead > 0) {
    alerts.push({
      id: 'deaths',
      level: 'danger',
      text: dead === 1 ? 'A colonist has died' : `${dead} colonists have died`,
    });
  }

  for (const pawn of living) {
    if (pawn.needs[Need.Hunger] <= 0) {
      alerts.push({ id: `starving:${pawn.id}`, level: 'danger', text: `${pawn.name} is starving` });
    }
  }

  if (edibleUnits === 0 && living.length > 0) {
    alerts.push({ id: 'nofood', level: 'danger', text: 'No food available' });
  } else if (edibleUnits < living.length * 4) {
    alerts.push({ id: 'lowfood', level: 'warning', text: 'Food is running low' });
  }

  for (const pawn of living) {
    if (pawn.breakTicks > 0) {
      alerts.push({
        id: `break:${pawn.id}`,
        level: 'warning',
        text: `${pawn.name} has stopped coping`,
      });
    } else if (moodOf(pawn) < BREAK_THRESHOLD) {
      alerts.push({
        id: `mood:${pawn.id}`,
        level: 'warning',
        text: `${pawn.name} is close to breaking`,
      });
    }
  }

  for (const pawn of living) {
    if (pawn.needs[Need.Rest] < needDef(Need.Rest).warnBelow) {
      alerts.push({
        id: `tired:${pawn.id}`,
        level: 'info',
        text: `${pawn.name} is exhausted`,
      });
    }
  }

  return alerts;
}
