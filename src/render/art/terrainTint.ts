/**
 * The low-frequency brightness field that keeps large areas from reading as flat colour.
 *
 * Deliberately independent of terrain type, so a patch of shade crossing a grass/dirt
 * boundary carries across it — which is what makes it look like *light* rather than
 * like tinted tiles.
 *
 * Lives outside the tile art because variants are picked per cell by hash: baking tone
 * into a variant makes neighbouring cells maximally different and the ground reads as
 * a checkerboard. Shared by the ground and object layers so a raised rock is lit the
 * same as the dirt it sits in.
 */

import { makeNoise2D } from '../../sim/world/noise';
import type { TileMap } from '../../sim/world/tilemap';

/**
 * Darkest the field may push a tile, as a fraction of full brightness. Tint can only
 * multiply, so it darkens and never brightens — the field runs from here up to 1.0.
 */
const TINT_FLOOR = 0.86;

/** Tiles per unit of noise. Large, so patches read as terrain rather than static. */
const TINT_SCALE = 1 / 15;

export class TerrainTintField {
  private field = new Uint8Array(0);
  private seed = Number.NaN;

  /** Rebuilds only when the world changed underneath it. */
  ensure(map: TileMap, seed: number): void {
    if (this.seed === seed && this.field.length === map.size) return;

    const noise = makeNoise2D(seed ^ 0x1a2b3c4d);
    const field = new Uint8Array(map.size);
    const floor = Math.round(TINT_FLOOR * 255);
    const span = 255 - floor;

    for (let z = 0; z < map.levels; z++) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          field[map.idx(x, y, z)] = floor + Math.round(noise(x * TINT_SCALE, y * TINT_SCALE, 3) * span);
        }
      }
    }

    this.field = field;
    this.seed = seed;
  }

  /** Greyscale tint for a cell, ready to assign to `sprite.tint`. */
  at(index: number): number {
    const level = this.field[index];
    return (level << 16) | (level << 8) | level;
  }
}
