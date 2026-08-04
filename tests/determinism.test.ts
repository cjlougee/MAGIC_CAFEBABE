/**
 * Enforcement rule 2, behaviourally.
 *
 * This is the test that protects every system built after it. As long as it passes,
 * a bug report is a seed plus a tick count, save/load is just serialization, and no
 * system can quietly introduce hidden state.
 */

import { describe, expect, it } from 'vitest';
import { STARTING_TICK } from '../src/sim/core/constants';
import { Rng } from '../src/sim/core/rng';
import { hashWorld } from '../src/sim/save/hash';
import { Simulation } from '../src/sim/simulation';
import { createWorld } from '../src/sim/world/world';

const SMALL = { width: 48, height: 48 };

describe('world determinism', () => {
  it('produces an identical world from an identical seed', () => {
    const a = createWorld(12345, SMALL);
    const b = createWorld(12345, SMALL);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('produces different worlds from different seeds', () => {
    const a = createWorld(12345, SMALL);
    const b = createWorld(12346, SMALL);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('stays identical across a long run', () => {
    const a = new Simulation({ seed: 777, ...SMALL });
    const b = new Simulation({ seed: 777, ...SMALL });

    a.run(5000);
    b.run(5000);

    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.world.tick).toBe(STARTING_TICK + 5000);
  });

  it('reaches the same state whether run in one batch or many', () => {
    const batched = new Simulation({ seed: 4242, ...SMALL });
    const stepped = new Simulation({ seed: 4242, ...SMALL });

    batched.run(1200);
    for (let i = 0; i < 12; i++) stepped.run(100);

    expect(hashWorld(stepped.world)).toBe(hashWorld(batched.world));
  });

  it('regenerates deterministically through the command queue', () => {
    const a = new Simulation({ seed: 1, ...SMALL });
    const b = new Simulation({ seed: 999, ...SMALL });

    a.dispatch({ type: 'regenerate', seed: 555 });
    b.dispatch({ type: 'regenerate', seed: 555 });
    a.tick();
    b.tick();

    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.world.seed).toBe(555);
  });
});

describe('Rng', () => {
  it('replays the same stream from the same seed', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    const drawsA = Array.from({ length: 500 }, () => a.nextUint32());
    const drawsB = Array.from({ length: 500 }, () => b.nextUint32());
    expect(drawsA).toEqual(drawsB);
  });

  it('diverges between seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it('resumes exactly from saved state, which is what makes save/load possible', () => {
    const original = new Rng(31337);
    original.nextUint32();
    original.nextUint32();

    const resumed = Rng.fromState(original.save());
    const expected = Array.from({ length: 50 }, () => original.nextUint32());
    const actual = Array.from({ length: 50 }, () => resumed.nextUint32());

    expect(actual).toEqual(expected);
  });

  it('emits floats within [0, 1)', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 2000; i++) {
      const value = rng.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int() inside its bound', () => {
    const rng = new Rng(6);
    for (let i = 0; i < 2000; i++) {
      const value = rng.int(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it('distributes roughly evenly across buckets', () => {
    const rng = new Rng(8);
    const buckets = new Array(10).fill(0);
    const draws = 100_000;
    for (let i = 0; i < draws; i++) buckets[rng.int(10)]++;

    // 10% expected per bucket; allow generous slack so this never flakes.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws * 0.085);
      expect(count).toBeLessThan(draws * 0.115);
    }
  });

  it('shuffles without losing or duplicating elements', () => {
    const rng = new Rng(11);
    const items = Array.from({ length: 100 }, (_, i) => i);
    const shuffled = rng.shuffle([...items]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('refuses to pick from an empty array rather than returning undefined', () => {
    expect(() => new Rng(1).pick([])).toThrow();
  });
});
