# The world

One continuous map, 512×512, generated from a seed. Everything is on it — the colony, the ruins,
and eventually the camps and towns. There is no overworld and no loading seam. Why that shape and
not the cheaper ones is [ADR 0007](../decisions/0007-world-shape.md); this describes how it works.

## Worldgen is two tiers of noise, ordered by wavelength

Six fields decide every cell. What makes them a design rather than a pile of knobs is that their
wavelengths are **strictly ordered**, longest first:

| Field | Wavelength | Decides |
|---|---|---|
| warmth | 1/150 | biome, crossed with damp |
| damp | 1/120 | biome, crossed with warmth |
| wreckage | 1/100 | how thickly the fallen civilization built here |
| elevation | 1/70 | water, gravel, rock |
| moisture | 1/40 | which of the biome's three grounds |
| ruin | 1/11 | individual plating and bulkheads |

The ordering *is* the design: a biome region is larger than a mountain range, which is larger than a
damp patch, which is larger than a ruin. So a range sits **inside** a region and a ruin sits **on** a
hillside, instead of each carving up the other.

These are absolute, not relative to map size, because the things they describe have physical sizes.
A mountain range is a range whatever the map is; a bulkhead is about ten tiles across either way.

**This is where scale bit.** Elevation and moisture were 1/26 and 1/19, tuned when the map was 128
tiles and a 26-tile feature spanned a fifth of it. At 512 the same number is a twentieth, so the map
came out *mottled* — rock speckled uniformly from corner to corner instead of gathering into ranges
you route around. Adding biomes did not fix it, and could not have: biomes shift where the bands
fall, but the bands themselves were still switching every twenty tiles. Sixteen times more map with
identical statistics is just more of the same.

## A biome parameterises the decision, it does not replace it

Local variation is what makes ground look natural close up, and it was never the problem. So
`BiomeDef` supplies the inputs to the *existing* per-cell choice rather than overriding it:

- `dryGround` / `midGround` / `lushGround` — what the moisture field resolves to here
- `reliefShift` — moves the gravel and rock thresholds together; negative means rockier
- `waterShift` — moves both waterlines together, so a wet region grows its ponds rather than
  turning its shallows into deeps

Four biomes, chosen by crossing warmth and damp: **Saltflats**, **Steppe**, **Badlands**, **Fen**.
Two fields rather than one quantised field, because banding a single field gives stripes across the
map — a gradient someone applied, not country. Crossed fields interlock.

**A biome is worldgen-time only and is never stored.** It is a pure function of seed and position,
so saving it would be saving derived state, and a stored copy could disagree with the terrain it
produced with nothing able to say which was right. Terrain is the durable record.

Wreckage density is deliberately *not* a biome. It is its own field, so a dead city can sit in any
climate — which is both truer to the fiction and better looking, since ruin fields then cut across
biome boundaries instead of lining up with them.

## Reachability is chunked

`ReachabilityMap` answers "could a pawn walk from here to there" in O(1), and every work giver calls
it in a loop. It used to flood the entire map whenever terrain changed. That does not survive a big
world:

| Map | Full rebuild | One cell changed |
|---|---|---|
| 128² | 3.3 ms | 148 µs |
| 512² | 50.3 ms | 615 µs |
| 1024² | 203 ms | 2.2 ms |

Terrain changes constantly — five colonists mining produce about 13 changes per in-game hour, one
every three seconds of real time at 1x and one per second at 3x. A 64 ms stall on that rhythm, from
inside the AI sweep, is not survivable.

So the map is cut into fixed 16×16 chunks:

- Each chunk floods **itself** into local components, ignoring everything outside it. A slot id is
  `chunk * 256 + local`; 256 is the worst case rather than a guess, since a checkerboard of walls
  gives every cell its own component.
- Each chunk caches the **cross-chunk links** its own border cells produce, as slot pairs. Interior
  cells cannot reach another chunk in one step, so only the ring is walked.
- Districts are the connected components of that graph, via union-find. `canReach` compares roots.

A single-cell change re-floods one chunk, recomputes links for it and its eight neighbours, then
re-unions a few thousand edges. The eight-neighbourhood is not incidental: a diagonal step between
two chunks has *shoulders* that can lie in a third, and that third chunk is always a diagonal
neighbour of both.

`markDirty()` still exists and still rebuilds everything — it means "I don't know what changed", for
loads and bulk edits. `markDirtyAt(index)` is the one every single-cell change should use.

### The guard

Chunking replaces a correct-by-construction algorithm with a lot of bookkeeping, and every way of
getting it wrong has the same symptom: a pawn that believes in a route nobody can walk. So
`tests/pathfind.test.ts` compares it against a **brute-force whole-map flood fill after every one of
220 random edits**, across both sources of passability, plus the chunk corners specifically. The
comparison is of *partitions*, not ids — the two labellings have no reason to agree on numbering,
only on which cells are grouped together.

## What the shape of the world has to guarantee

Two properties, both asserted in `tests/world.test.ts` at the size the game actually generates:

1. **Mostly walkable** — between 50% and 99% of cells passable. Measured across seeds, because a
   96-tile sample of a world with 150-tile features is a look at one region, and a region is allowed
   to be badlands.
2. **One landmass** — the largest district holds over 90% of walkable ground. This is the property
   the first one was only ever standing in for: a world can be 80% open and useless if it is 80%
   open in forty pockets, and a walkable-cell count cannot tell the difference. Measured seeds come
   out at 97.5–99.8%.

## Places

Six or so named compounds per world, sited by a **constraint search** rather than by a threshold on
noise — the reasoning is [ADR 0008](../decisions/0008-places.md), and it is the difference between
scenery and a destination. Scattered plating is weather; `Corvid Vault` is somewhere you went.

- `defs/pois.ts` — two kinds. **Listening posts** (span 7–11, five attempted) and one **relic
  vault** (span 15–21), which is `guaranteed`: its search re-runs on progressively looser terms
  rather than give up, because a world with nowhere to walk to has failed at the only thing this
  milestone was for.
- `world/poiPlacement.ts` — samples candidate sites from the world RNG, rejects any with water in
  the footprint, too much rock, too close to the landing site or to another place, or with no door
  that faces connected open ground. Survivors are scored by nearby wreckage, so compounds sit in
  country the old civilization actually built in.
- The winner is **stamped into the terrain grid**: bulkhead perimeter, plating interior, an offset
  internal wall with a gap, and one or two doors on facing walls.

Three details that are load-bearing rather than incidental, each of which was a bug first:

1. **Doors are chosen, not cut.** A door needs open ground on the other side *and* that ground has
   to connect to the colony. Random gaps produced a sealed compound whose walkable interior became
   an isolated reachability district — a colonist sent there never arrives and nothing says why.
2. **The centre stays standable.** `pos` is the place's address; the internal wall is offset so it
   never lands on it.
3. **The name is saved, not recomputed.** It is the one thing about a place that cannot be derived,
   and it is in `hashWorld` so a round trip that restores the right compound under the wrong name
   fails rather than passes.

`tests/places.test.ts` sweeps ten seeds for all of it: a guaranteed vault, distinct names that never
contain their own category, a real distance from home, no water underneath, and — the one that
caught a genuine bug — that every place can actually be walked into from the landing site.

## Seeing it

`MIN_ZOOM` is 0.2, loosened from 0.35 — that value showed a useful fraction of a 128-tile map and is
a keyhole on a 512-tile one. It is deliberately not loosened far enough to fit the world on screen:
at that zoom a tile is under eight pixels and the art is mush.

**The answer to "where am I in the world" is the minimap.** One canvas pixel per tile, painted flat
with no isometric transform — a plan, where up is up, because the player already has one isometric
view and needs the other kind here. It carries the camera's footprint as the diamond it actually is,
the colonists, the landing site, and every named place; clicking jumps the camera, and so does
clicking a name in the list beside it.

Terrain is painted to an offscreen canvas and repainted only when `TileMap.revision` changes, while
the markers redraw each snapshot. Mining one rock should not cost a 262,144-pixel repaint, and
neither should a colonist taking a step. It is derived render state: a pure function of the terrain
grid, never saved. Colours come from `terrainColour()`, shared with the world itself, because a map
whose colours disagree with the terrain it depicts is worse than no map.

The debug panel (`` ` ``) has a zoom row with a live readout, because finding a specific zoom by
wheel is fiddly and comparing two changes at *different* zooms is not a comparison.
