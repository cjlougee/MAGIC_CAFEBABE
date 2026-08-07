/**
 * Where a save actually lives.
 *
 * Deliberately outside `sim/`: the simulation produces plain data and knows nothing about
 * browsers, which is what keeps save/load testable in Node. This file is the only place
 * that touches `localStorage`.
 *
 * One slot. Multiple saves are a UI feature, not a technical one, and can layer on later
 * by varying the key.
 */

import { migrate, SaveVersionError } from '../sim/save/migrate';
import type { SaveData } from '../sim/save/serialize';

const SLOT_KEY = 'magic-cafebabe:save';

export interface SaveInfo {
  readonly day: number;
  readonly colonists: number;
  readonly savedAt: number;
}

interface StoredSave {
  readonly info: SaveInfo;
  readonly data: SaveData;
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SLOT_KEY) !== null;
  } catch {
    // Private browsing, disabled storage, quota — treat as "no save" rather than crash.
    return false;
  }
}

export function readSaveInfo(): SaveInfo | null {
  const stored = readStored();
  return stored?.info ?? null;
}

export function writeSave(data: SaveData, info: SaveInfo): boolean {
  try {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ info, data } satisfies StoredSave));
    return true;
  } catch (error) {
    console.error('Could not write save', error);
    return false;
  }
}

/**
 * Reads and upgrades the stored save.
 *
 * Returns null for anything unreadable — corrupt JSON, a save from a newer build — rather
 * than throwing into the render loop. The menu reports it; the running game carries on.
 */
export function readSave(): SaveData | null {
  const stored = readStored();
  if (!stored) return null;

  try {
    return migrate(stored.data);
  } catch (error) {
    if (error instanceof SaveVersionError) console.warn('Save cannot be loaded:', error.message);
    else console.error('Save is corrupt', error);
    return null;
  }
}

export function deleteSave(): void {
  try {
    localStorage.removeItem(SLOT_KEY);
  } catch {
    // Nothing useful to do; the menu will simply keep offering the save.
  }
}

function readStored(): StoredSave | null {
  try {
    const raw = localStorage.getItem(SLOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSave;
  } catch {
    return null;
  }
}
