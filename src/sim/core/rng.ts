/**
 * The one source of randomness in the simulation.
 *
 * Enforcement rule 2: nothing under src/sim/ may call Math.random(). A single Rng
 * lives in world state and is serialized with the save, so a world built from seed
 * S and ticked N times is byte-identical every run, on every machine.
 *
 * Algorithm is sfc32 (Small Fast Counter, 128-bit state) seeded through splitmix32.
 * Only +, -, *, ^, and shifts are used — IEEE-754 specifies these exactly, so results
 * are portable. Deliberately avoids Math.sin/pow/exp, whose precision is
 * implementation-defined and would break cross-machine determinism.
 */

export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

const UINT32 = 4294967296;

/** Expands a single integer seed into 128 bits of well-mixed state. */
function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const mix = splitmix32(seed);
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
  }

  /** Raw generator step. Everything else is built on this. */
  nextUint32(): number {
    let a = this.a | 0;
    let b = this.b | 0;
    let c = this.c | 0;
    const d = this.d | 0;

    const t = (((a + b) | 0) + d) | 0;
    this.d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;

    this.a = a;
    this.b = b;
    this.c = c;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.nextUint32() / UINT32;
  }

  /** Uniform integer in [0, maxExclusive). Returns 0 for non-positive bounds. */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(this.float() * maxExclusive);
  }

  /** Uniform integer in [min, maxExclusive). */
  range(min: number, maxExclusive: number): number {
    return min + this.int(maxExclusive - min);
  }

  /** Uniform float in [min, max). */
  rangeFloat(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** A uniformly chosen element. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with an empty array');
    return items[this.int(items.length)];
  }

  /** In-place Fisher-Yates. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  save(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  restore(state: RngState): void {
    this.a = state.a;
    this.b = state.b;
    this.c = state.c;
    this.d = state.d;
  }

  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.restore(state);
    return rng;
  }
}
