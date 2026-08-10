/**
 * The isometric projection is pure maths, so it gets tested directly rather than by
 * squinting at screenshots. A wrong sign here shows up as a subtly sheared map that is
 * genuinely hard to diagnose by eye.
 */

import { describe, expect, it } from 'vitest';
import { HALF_TILE_H, HALF_TILE_W, LEVEL_HEIGHT, TILE_H, TILE_W } from '../src/render/constants';
import { footprintBounds, tileDepth, tileToWorld, worldDeltaToTile, worldToTile } from '../src/render/iso';
import { GROUND_LEVEL } from '../src/sim/core/position';

describe('isometric projection', () => {
  it('puts the origin tile at the world origin', () => {
    expect(tileToWorld(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('sends +x down-right and +y down-left', () => {
    // This is the whole projection in two assertions. If either flips, the map mirrors.
    expect(tileToWorld(1, 0)).toEqual({ x: HALF_TILE_W, y: HALF_TILE_H });
    expect(tileToWorld(0, 1)).toEqual({ x: -HALF_TILE_W, y: HALF_TILE_H });
  });

  it('round-trips tile → world → tile', () => {
    for (let y = -20; y <= 20; y += 3) {
      for (let x = -20; x <= 20; x += 3) {
        const world = tileToWorld(x, y);
        const back = worldToTile(world.x, world.y);
        expect(back.x).toBeCloseTo(x, 10);
        expect(back.y).toBeCloseTo(y, 10);
      }
    }
  });

  it('round-trips fractional positions, which picking depends on', () => {
    const world = tileToWorld(3.25, 7.75);
    const back = worldToTile(world.x, world.y);
    expect(back.x).toBeCloseTo(3.25, 10);
    expect(back.y).toBeCloseTo(7.75, 10);
  });

  it('tessellates: diagonal neighbours sit exactly one tile apart', () => {
    const origin = tileToWorld(4, 4);
    const right = tileToWorld(5, 4);
    const down = tileToWorld(4, 5);

    expect(right.x - origin.x).toBe(HALF_TILE_W);
    expect(right.y - origin.y).toBe(HALF_TILE_H);
    expect(down.x - origin.x).toBe(-HALF_TILE_W);
    expect(down.y - origin.y).toBe(HALF_TILE_H);
  });

  it('separates same-depth tiles by exactly one tile width, so they abut without overlap', () => {
    // Tiles sharing a depth must not overlap, or the painter's algorithm would need a
    // tie-break rule that row-major iteration does not provide.
    const a = tileToWorld(5, 3);
    const b = tileToWorld(6, 2);
    expect(tileDepth(5, 3)).toBe(tileDepth(6, 2));
    expect(a.y).toBe(b.y);
    expect(Math.abs(a.x - b.x)).toBe(TILE_W);
  });

  it('treats deltas as pure directions with no origin offset', () => {
    const from = tileToWorld(10, 10);
    const to = tileToWorld(12, 13);
    const delta = worldDeltaToTile(to.x - from.x, to.y - from.y);
    expect(delta.x).toBeCloseTo(2, 10);
    expect(delta.y).toBeCloseTo(3, 10);
  });

  it('maps a downward screen delta onto both tile axes', () => {
    // Moving straight down the screen advances x and y equally — this is what makes
    // WASD feel screen-aligned instead of sliding along the tile grid.
    const delta = worldDeltaToTile(0, TILE_H);
    expect(delta.x).toBeCloseTo(1, 10);
    expect(delta.y).toBeCloseTo(1, 10);
  });
});

describe('levels', () => {
  it('is identical to the flat projection at ground level', () => {
    // Nothing currently passes z. If the default ever stopped being a no-op, the whole
    // map would shift and it would look like a camera bug.
    expect(tileToWorld(5, 9, 0)).toEqual(tileToWorld(5, 9));
    expect(worldToTile(120, 64, 0)).toEqual(worldToTile(120, 64));
  });

  it('draws higher levels further up the screen', () => {
    const ground = tileToWorld(4, 4, 0);
    const above = tileToWorld(4, 4, 1);
    expect(above.x).toBe(ground.x);
    expect(ground.y - above.y).toBe(LEVEL_HEIGHT);
  });

  it('puts underground levels below the surface', () => {
    const below = tileToWorld(4, 4, -1);
    expect(below.y - tileToWorld(4, 4, 0).y).toBe(LEVEL_HEIGHT);
  });

  it('round-trips on any level', () => {
    for (const z of [-2, -1, 0, 1, 3]) {
      const world = tileToWorld(6, 11, z);
      const back = worldToTile(world.x, world.y, z);
      expect(back.x).toBeCloseTo(6, 10);
      expect(back.y).toBeCloseTo(11, 10);
    }
  });
});

describe('draw order', () => {
  it('row-major iteration is a valid back-to-front order', () => {
    // TerrainLayer relies on this: the only tiles that can overlap (x, y) are (x+1, y)
    // and (x, y+1), and both must be drawn after it. If this breaks, tall terrain
    // renders through whatever stands in front of it.
    const width = 12;
    const indexOf = (x: number, y: number) => y * width + x;

    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 11; x++) {
        expect(indexOf(x + 1, y)).toBeGreaterThan(indexOf(x, y));
        expect(indexOf(x, y + 1)).toBeGreaterThan(indexOf(x, y));
        expect(tileDepth(x + 1, y)).toBeGreaterThan(tileDepth(x, y));
        expect(tileDepth(x, y + 1)).toBeGreaterThan(tileDepth(x, y));
      }
    }
  });
});

describe('footprint bounds', () => {
  it('reduces to a single tile at 1x1', () => {
    // The check the whole multi-tile generalisation rests on: every existing single-tile
    // sprite must land exactly where it always did. `ObjectLayer` used to position
    // buildings at `(centre.x - HALF_TILE_W, centre.y - HALF_TILE_H - height)` with a
    // frame of `TILE_W x (TILE_H + height)`, so that is what 1x1 has to produce.
    for (const [x, y, rise] of [
      [0, 0, 0],
      [7, 3, 22],
      [40, 41, 14],
    ]) {
      const centre = tileToWorld(x, y);
      const box = footprintBounds(x, y, 1, 1, GROUND_LEVEL, rise);

      expect(box.left).toBe(centre.x - HALF_TILE_W);
      expect(box.top).toBe(centre.y - HALF_TILE_H - rise);
      expect(box.width).toBe(TILE_W);
      expect(box.height).toBe(TILE_H + rise);
    }
  });

  it('grows along both screen diagonals, not along one tile axis', () => {
    // A 2x1 and a 1x2 occupy the same *area* and the same bounding box size, because in
    // 2:1 isometric both are one tile along each screen diagonal. Getting this wrong
    // gives a rotated bed a frame that crops it.
    const along = footprintBounds(10, 10, 2, 1);
    const across = footprintBounds(10, 10, 1, 2);

    expect(along.width).toBe(3 * HALF_TILE_W);
    expect(along.height).toBe(3 * HALF_TILE_H);
    expect(across.width).toBe(along.width);
    expect(across.height).toBe(along.height);

    // They are not in the same place, though: the 1x2 reaches further down-left.
    expect(across.left).toBeLessThan(along.left);
  });

  it('covers every cell of the footprint it describes', () => {
    const w = 2;
    const h = 2;
    const box = footprintBounds(5, 6, w, h);

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const centre = tileToWorld(5 + dx, 6 + dy);
        expect(centre.x - HALF_TILE_W).toBeGreaterThanOrEqual(box.left);
        expect(centre.x + HALF_TILE_W).toBeLessThanOrEqual(box.left + box.width);
        expect(centre.y - HALF_TILE_H).toBeGreaterThanOrEqual(box.top);
        expect(centre.y + HALF_TILE_H).toBeLessThanOrEqual(box.top + box.height);
      }
    }
  });
});
