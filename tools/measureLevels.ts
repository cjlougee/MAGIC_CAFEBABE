/**
 * What does a z-level cost in the save file?
 *
 * Slice 4 gives the world five levels, and save size has been *the* constraint on world
 * size since M7 — 475 KB at 512² against a multi-slot `localStorage` budget. Levels
 * multiply the terrain grid, and this project is two-for-two on constants nobody measured,
 * so the number is owed before anything is designed around it.
 *
 * The measurement models what M18's worldgen will actually produce rather than a uniform
 * stack, because a uniform stack is the trivially cheap case and would flatter the answer:
 *
 *   z <  surface   Rock          (the mass a cliff is cut from)
 *   z == surface   real terrain  (whatever flat worldgen chose for that column)
 *   z >  surface   Open          (nothing; one RLE run per level, in principle)
 *
 * Surface level comes from the *existing* elevation field at the existing wavelength, so
 * the run counts reflect the real feature scale rather than an invented one. Caves are
 * measured separately, because they are the pessimistic case: carving floors out of the
 * solid mass is what turns a two-run level into a many-run one.
 *
 * Writes directly into the typed arrays rather than through `setTerrainAt`, because the
 * stand-in for `Terrain.Open` has no entry in `TERRAIN_DEFS` yet and the setters derive
 * walk cost from it. Nothing here is game code; it reads the game's RNG-free noise and the
 * game's own RLE encoder, and that is the whole point — a second encoder would measure
 * itself.
 *
 *   npx vite-node tools/measureLevels.ts
 */

import { Terrain } from '../src/sim/defs/terrain';
import { makeNoise2D } from '../src/sim/world/noise';
import { TileMap } from '../src/sim/world/tilemap';
import { createWorld } from '../src/sim/world/world';
import { TICKS_PER_DAY } from '../src/sim/core/constants';
import { Simulation } from '../src/sim/simulation';
import { encodeRle, serializeWorld } from '../src/sim/save/serialize';
import type { World } from '../src/sim/world/world';

/** Stands in for `Terrain.Open`, which does not exist until M16. */
const OPEN = 11;

/** The elevation field's wavelength, copied from worldgen. Changing it there changes this. */
const ELEVATION_SCALE = 1 / 70;
/** Cave field. Shorter than elevation — a cave system is smaller than a mountain range. */
const CAVE_SCALE = 1 / 45;
const CAVE_ABOVE = 0.62;

/** Overridable so the same tool can check the 1024² figure the roadmap also records. */
const SIZE = Number(process.env.MEASURE_SIZE ?? 512);
const SEEDS = (process.env.MEASURE_SEEDS ?? '1,7,12345').split(',').map(Number);
/** Skippable: a week of ticks is the slow part and says nothing at other sizes. */
const PLAY = process.env.MEASURE_PLAY !== '0';

interface Row {
  readonly label: string;
  readonly bytes: number;
  readonly terrainRuns: number;
  readonly naturalRuns: number;
}

/**
 * A layered map built the way M18 will build one.
 *
 * `surfaceBands` is how many of the levels are surface relief; the rest are underground.
 * With 5 levels and 3 bands, levels 0–1 are rock (or cave) and 2–4 carry the relief.
 */
function layered(flat: TileMap, seed: number, levels: number, surfaceBands: number, caves: boolean): TileMap {
  const map = new TileMap(flat.width, flat.height, levels);
  const elevation = makeNoise2D(seed);
  const cave = makeNoise2D(seed ^ 0x3c6ef372);
  const lowest = levels - surfaceBands;

  for (let y = 0; y < flat.height; y++) {
    for (let x = 0; x < flat.width; x++) {
      const e = elevation(x * ELEVATION_SCALE, y * ELEVATION_SCALE, 5);
      // Quantise the same field the flat generator thresholds, into level bands.
      const surface = lowest + Math.min(surfaceBands - 1, Math.floor(e * surfaceBands));
      const here = flat.terrain[flat.idx(x, y, 0)];

      for (let z = 0; z < levels; z++) {
        const index = map.idx(x, y, z);
        let id: number;
        if (z > surface) id = OPEN;
        else if (z === surface) id = here;
        else if (caves && cave(x * CAVE_SCALE, y * CAVE_SCALE, 3) > CAVE_ABOVE) id = Terrain.Gravel;
        else id = Terrain.Rock;

        map.terrain[index] = id;
        map.naturalTerrain[index] = id;
      }
    }
  }

  return map;
}

function measure(world: World, label: string): Row {
  const save = serializeWorld(world);
  return {
    label,
    bytes: JSON.stringify(save).length,
    terrainRuns: save.map.terrain.length / 2,
    naturalRuns: save.map.natural.length / 2,
  };
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

const rows: Row[] = [];

/*
 * A colony that has been lived in, not just generated.
 *
 * The roadmap records 475 KB at 512² and a fresh world measures well under that, so the
 * gap is either play or a stale figure — and "save size is the constraint on world size"
 * is load-bearing enough to be worth one week of ticks to settle.
 */
if (PLAY) {
  const played = new Simulation({ seed: SEEDS[0], width: SIZE, height: SIZE });
  played.run(TICKS_PER_DAY * 7);
  rows.push(measure(played.world, `seed ${SEEDS[0]} · 1 level, played a week`));
}

for (const seed of SEEDS) {
  const world = createWorld(seed, { width: SIZE, height: SIZE });
  const flat = world.map;

  rows.push(measure(world, `seed ${seed} · 1 level`));
  rows.push(measure({ ...world, map: layered(flat, seed, 3, 2, false) }, `seed ${seed} · 3 levels`));
  rows.push(measure({ ...world, map: layered(flat, seed, 5, 3, false) }, `seed ${seed} · 5 levels`));
  rows.push(measure({ ...world, map: layered(flat, seed, 5, 3, true) }, `seed ${seed} · 5 levels + caves`));
}

const baseline = rows.filter((r) => r.label.endsWith('1 level'));
const meanBaseline = baseline.reduce((sum, r) => sum + r.bytes, 0) / baseline.length;

console.log('');
console.log(`  save size at ${SIZE}², terrain modelled the way M18 will generate it`);
console.log('  ' + '─'.repeat(72));
console.log('  variant                        bytes      vs 1 level   terrain runs  natural runs');
for (const row of rows) {
  const ratio = (row.bytes / meanBaseline).toFixed(2);
  console.log(
    `  ${row.label.padEnd(28)} ${kb(row.bytes).padStart(9)} ${(ratio + '×').padStart(12)}` +
      ` ${row.terrainRuns.toLocaleString().padStart(14)} ${row.naturalRuns.toLocaleString().padStart(13)}`,
  );
}
console.log('');

/*
 * The second table, and the one that actually answers the question.
 *
 * The first table holds `surfaceBands` at 3 and varies `levels`, which is the wrong knob:
 * levels are nearly free and relief bands are not. Eight levels at three bands costs what
 * five does; five levels at one band costs nothing at all. M18 is where "the existing
 * thresholds become level bands" gets decided, so that is the number it needs.
 *
 * Three bands is also a local *minimum* — a quantisation coincidence in
 * `Math.floor(e * bands)` — which is why the first table shows 5 levels coming out cheaper
 * than 3. An anomaly in a measurement is a thing to chase, not to pass over.
 */
console.log('  what it actually costs: relief bands, not levels');
console.log('  ' + '─'.repeat(72));
console.log('  levels  bands        bytes    vs 1 level');
{
  const seed = SEEDS[0];
  const flat = createWorld(seed, { width: SIZE, height: SIZE }).map;
  const world = createWorld(seed, { width: SIZE, height: SIZE });
  for (const [levels, bands] of [[5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [3, 2], [8, 3], [8, 6]]) {
    const row = measure({ ...world, map: layered(flat, seed, levels, bands, false) }, '');
    const ratio = (row.bytes / meanBaseline).toFixed(2);
    console.log(
      `  ${String(levels).padStart(6)}  ${String(bands).padStart(5)} ${kb(row.bytes).padStart(12)}` +
        ` ${(ratio + '×').padStart(13)}`,
    );
  }
}
console.log('');

// A uniform level, for contrast: this is what "empty levels are genuinely empty" costs.
const uniform = encodeRle(new Uint8Array(SIZE * SIZE).fill(OPEN));
console.log(`  one uniform level RLEs to ${uniform.length / 2} runs (${uniform.length} numbers),`);
console.log(`  because encodeRle caps a run at 0xffff. That is the floor an Open level pays.`);
console.log('');
