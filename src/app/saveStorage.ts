/**
 * Where saves actually live.
 *
 * Deliberately outside `sim/`: the simulation produces plain data and knows nothing about
 * browsers, which is what keeps save/load testable in Node. This file is the only place
 * that touches `localStorage`.
 *
 * **Metadata is stored separately from the colony itself.** Listing the saves has to read
 * every slot's name and day, and parsing a 20KB world to display one line would make the
 * menu slower the more you play. Two keys per slot means listing touches only the small
 * one.
 *
 * There is no index key. The list is derived by scanning for `:info` suffixes, so it
 * cannot drift out of step with what is actually stored — an index that disagrees with
 * reality is worse than no index.
 */

import { migrate, SaveVersionError } from '../sim/save/migrate';
import type { SaveData } from '../sim/save/serialize';

const PREFIX = 'magic-cafebabe:slot:';
const INFO_SUFFIX = ':info';
const DATA_SUFFIX = ':data';

/** The single-slot key used before saves were named. Migrated on first listing. */
const LEGACY_KEY = 'magic-cafebabe:save';

export interface SaveSlot {
  readonly id: string;
  readonly name: string;
  readonly day: number;
  readonly colonists: number;
  readonly savedAt: number;
}

/** Stats the caller supplies; the slot's identity is this module's business. */
export interface SaveStats {
  readonly day: number;
  readonly colonists: number;
}

export function newSlotId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** A default name that tells you something useful without being asked. */
export function suggestedName(stats: SaveStats): string {
  return `Day ${stats.day}`;
}

/** Every stored colony, newest first. */
export function listSaves(): SaveSlot[] {
  migrateLegacySlot();

  const slots: SaveSlot[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX) || !key.endsWith(INFO_SUFFIX)) continue;

      const info = parse<SaveSlot>(localStorage.getItem(key));
      // A slot whose data went missing would load as nothing; don't offer it.
      if (info && localStorage.getItem(dataKey(info.id)) !== null) slots.push(info);
    }
  } catch {
    // Private browsing, disabled storage — an empty list is the honest answer.
    return [];
  }

  return slots.sort((a, b) => b.savedAt - a.savedAt);
}

export function writeSave(
  id: string,
  name: string,
  data: SaveData,
  stats: SaveStats,
): boolean {
  const info: SaveSlot = { id, name, day: stats.day, colonists: stats.colonists, savedAt: Date.now() };

  try {
    // Data first: a half-written slot with no info is invisible, whereas info with no
    // data would show a save that cannot be loaded.
    localStorage.setItem(dataKey(id), JSON.stringify(data));
    localStorage.setItem(infoKey(id), JSON.stringify(info));
    return true;
  } catch (error) {
    console.error('Could not write save', error);
    // Roll back so a quota failure doesn't leave an unloadable stub behind.
    try {
      localStorage.removeItem(dataKey(id));
      localStorage.removeItem(infoKey(id));
    } catch {
      /* nothing further to try */
    }
    return false;
  }
}

/**
 * Reads and upgrades one colony.
 *
 * Returns null for anything unreadable — corrupt JSON, a save from a newer build —
 * rather than throwing into the render loop. The menu reports it; the running game
 * carries on.
 */
export function readSave(id: string): SaveData | null {
  const raw = safeGet(dataKey(id));
  if (!raw) return null;

  try {
    return migrate(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SaveVersionError) console.warn('Save cannot be loaded:', error.message);
    else console.error('Save is corrupt', error);
    return null;
  }
}

export function deleteSave(id: string): void {
  try {
    localStorage.removeItem(dataKey(id));
    localStorage.removeItem(infoKey(id));
  } catch {
    // Nothing useful to do; the menu will simply keep offering it.
  }
}

/** Folds a pre-naming save into the slot system so nobody loses a colony to an update. */
function migrateLegacySlot(): void {
  const raw = safeGet(LEGACY_KEY);
  if (!raw) return;

  try {
    const legacy = JSON.parse(raw) as { info?: SaveStats; data?: SaveData };
    if (legacy.data) {
      const id = newSlotId();
      const stats = legacy.info ?? { day: 1, colonists: 0 };
      writeSave(id, `${suggestedName(stats)} (recovered)`, legacy.data, stats);
    }
  } catch {
    // Unreadable legacy save; dropping it is the only option.
  }

  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* leave it */
  }
}

const infoKey = (id: string) => `${PREFIX}${id}${INFO_SUFFIX}`;
const dataKey = (id: string) => `${PREFIX}${id}${DATA_SUFFIX}`;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
