/**
 * Deterministic 2D value noise with fBm layering, used by worldgen.
 *
 * Hand-rolled rather than pulled from a library so we control exactly which float
 * operations run — see the determinism note in core/rng.ts. Integer hashing plus
 * multiply/add only.
 */

export type Noise2D = (
  x: number,
  y: number,
  octaves?: number,
  frequency?: number,
  persistence?: number,
) => number;

/** Smoothstep. Softens the lattice so interpolation doesn't look like a grid. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Returns an fBm sampler in [0, 1]. Same seed always yields the same field, and it
 * is stateless — sampling in any order gives identical results, which matters
 * because worldgen and any later re-generation must agree.
 */
export function makeNoise2D(seed: number): Noise2D {
  const hash = (x: number, y: number): number => {
    let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const value = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);

    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);

    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  };

  return (x, y, octaves = 4, frequency = 1, persistence = 0.5) => {
    let amplitude = 1;
    let freq = frequency;
    let sum = 0;
    let norm = 0;

    for (let i = 0; i < octaves; i++) {
      sum += value(x * freq, y * freq) * amplitude;
      norm += amplitude;
      amplitude *= persistence;
      freq *= 2;
    }

    return sum / norm;
  };
}
