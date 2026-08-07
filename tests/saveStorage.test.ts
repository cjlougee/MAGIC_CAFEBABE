/**
 * The save-slot layer.
 *
 * Runs against a `localStorage` stub, because this is the one file allowed to touch
 * browser storage and its logic — listing, overwriting, legacy migration, failure
 * handling — is exactly the sort that breaks quietly and loses somebody's colony.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { SaveData } from '../src/sim/save/serialize';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

let storage: MemoryStorage;
let store: typeof import('../src/app/saveStorage');

beforeEach(async () => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  store = await import('../src/app/saveStorage');
});

function sampleSave(): SaveData {
  return new Simulation({ seed: 5, width: 24, height: 24, colonists: 2 }).save();
}

describe('save slots', () => {
  it('starts empty', () => {
    expect(store.listSaves()).toEqual([]);
  });

  it('stores and lists a colony', () => {
    expect(store.writeSave('a', 'Homestead', sampleSave(), { day: 4, colonists: 3 })).toBe(true);

    const slots = store.listSaves();
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ id: 'a', name: 'Homestead', day: 4, colonists: 3 });
  });

  it('keeps several colonies side by side', () => {
    store.writeSave('a', 'First', sampleSave(), { day: 1, colonists: 3 });
    store.writeSave('b', 'Second', sampleSave(), { day: 9, colonists: 2 });

    expect(store.listSaves().map((s) => s.name).sort()).toEqual(['First', 'Second']);
  });

  it('lists newest first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    store.writeSave('old', 'Old', sampleSave(), { day: 1, colonists: 1 });
    vi.setSystemTime(9000);
    store.writeSave('new', 'New', sampleSave(), { day: 2, colonists: 1 });
    vi.useRealTimers();

    expect(store.listSaves().map((s) => s.name)).toEqual(['New', 'Old']);
  });

  it('overwrites a slot in place rather than adding one', () => {
    store.writeSave('a', 'Homestead', sampleSave(), { day: 1, colonists: 3 });
    store.writeSave('a', 'Homestead', sampleSave(), { day: 7, colonists: 2 });

    const slots = store.listSaves();
    expect(slots).toHaveLength(1);
    expect(slots[0].day).toBe(7);
  });

  it('round-trips the colony itself, not just its label', () => {
    const original = sampleSave();
    store.writeSave('a', 'Homestead', original, { day: 1, colonists: 2 });
    expect(store.readSave('a')?.tick).toBe(original.tick);
  });

  it('deletes both halves of a slot', () => {
    store.writeSave('a', 'Homestead', sampleSave(), { day: 1, colonists: 2 });
    store.deleteSave('a');

    expect(store.listSaves()).toEqual([]);
    expect(store.readSave('a')).toBeNull();
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => store.newSlotId()));
    expect(ids.size).toBe(50);
  });
});

describe('robustness', () => {
  it('returns null for a slot that does not exist', () => {
    expect(store.readSave('nope')).toBeNull();
  });

  it('returns null rather than throwing on corrupt data', () => {
    store.writeSave('a', 'Homestead', sampleSave(), { day: 1, colonists: 2 });
    storage.setItem('magic-cafebabe:slot:a:data', '{ not json');

    expect(() => store.readSave('a')).not.toThrow();
    expect(store.readSave('a')).toBeNull();
  });

  it('hides a slot whose colony data went missing', () => {
    // Better to not offer a save than to offer one that loads nothing.
    store.writeSave('a', 'Homestead', sampleSave(), { day: 1, colonists: 2 });
    storage.removeItem('magic-cafebabe:slot:a:data');

    expect(store.listSaves()).toEqual([]);
  });

  it('reports failure instead of leaving a broken slot behind', () => {
    const full = new MemoryStorage();
    full.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    vi.stubGlobal('localStorage', full);
    // The error is logged on purpose; muted here so real failures stand out in output.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(store.writeSave('a', 'Homestead', sampleSave(), { day: 1, colonists: 2 })).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('legacy single-slot saves', () => {
  it('recovers a pre-naming save instead of losing it to an update', () => {
    storage.setItem(
      'magic-cafebabe:save',
      JSON.stringify({ info: { day: 6, colonists: 3, savedAt: 1 }, data: sampleSave() }),
    );

    const slots = store.listSaves();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toContain('recovered');
    expect(slots[0].day).toBe(6);
    // Converted once, not on every listing.
    expect(storage.getItem('magic-cafebabe:save')).toBeNull();
    expect(store.listSaves()).toHaveLength(1);
  });

  it('discards an unreadable legacy save without breaking the list', () => {
    storage.setItem('magic-cafebabe:save', 'garbage');
    expect(store.listSaves()).toEqual([]);
  });
});
