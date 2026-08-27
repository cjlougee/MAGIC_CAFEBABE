# Slice 4 — Verticality

**Status:** agreed, not yet built · 2026-08-26 · ADR [0003](../../decisions/0003-verticality.md)

A working plan, not a design doc. When the code lands,
[`design/08-the-world.md`](../../design/08-the-world.md) and
[`design/02-pawns-and-movement.md`](../../design/02-pawns-and-movement.md) gain the durable
description and this file stops being interesting.

---

## The problem

The data model has taken a `z` since before the first pawn existed and nothing has ever
generated or drawn a second level. M14 is what finally scheduled this: a wall draws 22px
against a level's 24, so the first genuinely tall building makes a one-storey hut and a real
second floor pixel-identical while behaving nothing alike. Capping decorative relief was
rejected as a half measure, and then M14 was deferred *whole* — because two of its four items
were shaped by the absence of levels rather than by the art.

Build the levels; then decide what a building looks like.

## Confirmed, not assumed

Everything ADR 0003 said was reserved, checked against the code rather than trusted:

| Claim | Reality |
|---|---|
| `TilePos` has taken a `z` since M0 | ✅ `sim/core/position.ts`, exercised on a real 3-level map in `tests/position.test.ts` |
| `TileMap.levels` indexes level-major | ✅ `z * layerSize + y * width + x`, and `xOf/yOf/zOf` already decode it |
| `tileToWorld` / `worldToTile` are level-aware | ✅ and `tests/iso.test.ts` asserts the `z = 0` case is byte-identical to the flat projection |
| `hashWorld` covers `levels` | ✅ — but not the *positions*. See finding 1 |

Two more that were not on the list and are better news than expected:

- **`ReachabilityMap` is already z-indexed.** `chunk = (z * chunksY + cy) * chunksX + cx`, and
  `chunkBounds` already carries a `z`. Chunks are 16×16×1 *today*. What is missing is vertical
  links, not a rewrite.
- **`RoomMap.rebuild` already loops `for z`.** Rooms come along for free, exactly as they did
  for footprints in M10.

---

## The model

### A cell is one of three things

```
Open    nothing here. Impassable, unstorable, draws nothing, supports nothing.
Solid   fills the cell. Impassable. Its top face is the floor of the level above.
Floor   a floor at the bottom of the cell, air above. You stand here.
```

`Open` is a new `TerrainId`, which is the cheap answer and also the right one: it inherits
`walkCost: IMPASSABLE`, so every existing passability check refuses it with no new code; it
inherits `storable: false`; and **a level of pure `Open` is one RLE run**, which is what keeps
empty levels genuinely empty in the save.

`Solid` is the existing `TerrainDef.solid` flag — Rock and RuinWall — doing a job it was
already shaped for. Everything else is a Floor, including DeepWater: a floor you cannot walk
on, which is not the same thing as nothing.

A column with surface level `s` is `z < s` Solid, `z == s` Floor, `z > s` Open. A cliff is a
column whose `s` is higher than its neighbour's; you see the side faces of the solids below it
and stand on the floor on top.

**A pawn never stands on top of a Solid.** They stand on the Floor cell at `s`, which is a
different cell. That distinction is what makes the model consistent rather than nearly
consistent — "walk onto the rock" has no meaning, and there is no second rule for it.

A cave is a Floor carved into the solid mass with Solid above it, which is ADR 0003's own
sentence unchanged.

### The vertical rule — stair columns

```ts
// pathfind/neighbours.ts — the only place vertical connectivity exists.
if (dz !== 0) {
  if (dx !== 0 || dy !== 0) return false;              // no diagonal in z
  if (!map.inBounds(x, y, z + dz)) return false;
  if (!map.connectsVertically(x, y, z)) return false;
  if (!map.connectsVertically(x, y, z + dz)) return false;
  return map.isPassable(x, y, z + dz);
}
```

One new terrain, `Terrain.Stair`, carrying `connectsVertically: true`. A staircase is a
*column* of Stair cells.

**The rule is symmetric by construction** — the failure mode where up works and down does not
is not expressible. That matters more here than anywhere else in the codebase: A\* and
reachability share `canStep`, and the 220-edit oracle guards *chunking*, not `canStep` itself
(`bruteForceComponents` calls the same function). Nothing in the suite would notice a one-way
step, and that was **checked rather than argued**: patching `canStep` to refuse the NE diagonal
out of ~1% of cells — the same shape as "up works and down does not" — leaves all 809 tests
green, including `reachability > agrees with A* on every sampled pair`.

### The symmetry sweep has to be conditioned, or it cannot pass

Written as "`a→b` iff `b→a`" the sweep **fails on the existing 2D rule**, because `canStep`
checks `isPassable` on the *destination* only: at every boundary between a passable and an
impassable cell, one direction is legal and the other is not. That asymmetry is benign — neither
consumer ever expands *from* an impassable cell (`refloodChunk:240` skips them,
`recomputeLinks:311` skips impassable slots) — but a test asserting the unconditioned form goes
red on arrival, and the tempting fix is to weaken `canStep`.

So the assertion is: **for passable `a` and passable `b`, `a→b` iff `b→a`.** This is M12.5's
"test that could not fail" through the mirror — a test that cannot *pass*, specified in a plan
and therefore checked by nobody until it is written.

Two smaller things the signature change drags in:

- **`stepCost` must be given the destination level.** A\* calls it with the search's fixed `z`
  (`pathfinder.ts:144`); a vertical step priced off the origin level charges for the wrong cell.
- **`MIN_STRAIGHT` is derived from the cheapest `walkCost > 0`** (`pathfinder.ts:26`), currently
  9. `Terrain.Open` is excluded for free, but a `Terrain.Stair` cheaper than 9 would lower it and
  weaken every heuristic in the game. Climbing should cost *more* than walking anyway.

A staircase is legible from both levels: the upper cell draws as an opening with steps
descending, the lower as steps rising into the ceiling. That is what ruled out the cheaper
"carve a notch one level down at the cliff edge" model — the plateau's own surface tile would
draw over the notch, and a staircase invisible from above is not a staircase.

A constructed staircase is a **terrain-result buildable**, like StoneFloor — not a Building.
No third grid, no new building flag, and `naturalTerrain` already handles taking it back up.

**Edge ramps are staged, not rejected.** DF-style diagonal ramps read better for natural relief
and cost real geometry in `canStep`: the destination is a different column, and diagonal
shoulders move into 3D. The decision point is inside M18, where generated relief is looked at
for the first time. It is a judgement, not a measurement, so it needs the picture before the
call.

### A solid **is** a level

The specific thing ADR 0003 left open. `terrainHeight` stops being a table and becomes one
derived line:

```ts
terrainHeight(id) = TERRAIN_DEFS[id].solid ? LEVEL_HEIGHT : 0
```

Rock 14 → 24px, bulkhead 22 → 24px. A solid cell's top face is the floor of the level above,
so anything else is a lie about geometry. Cliffs read as storeys. This is a visible change to
every map in the game and it is what the slice exists to settle.

`language.ts` already states every building proportion as a fraction of `LEVEL_HEIGHT`, so
**no furniture number changes**. That was the point of writing them that way in M12.

### Walls stay where they are

Slice 4 builds the machinery — levels, floors that need support, stairs, and one multi-storey
structure that proves it. `BUILDING_HEIGHT[Wall]` stays 22, and wall, door and hearth stay on
the vector path. M14 then picks proportions, materials and ornament with a real second storey
on screen to measure against, which is the order the roadmap has argued for since the slice
was scheduled.

### Five levels

`WORLD_LEVELS = 5` in `sim/core/constants.ts`. Two cave bands, three surface bands, so relief
can read as country rather than as a single step and Slice 6's dungeons have somewhere to go.

**`GROUND_LEVEL = 0` stays 0 and stops meaning "the surface".** ADR 0003 says "underground is
negative", and that was never representable: `inBounds` requires `z >= 0`, so the grid has
always been `0 .. levels-1`. Level 0 is the bottom of the world. The surface is
`map.surfaceLevelAt(x, y)`, which varies per column. ADR 0003 gains an amendment saying so.

---

## What reading the code found

Seven things, each of which fails silently.

### 1. `hashWorld` ignores the position on **8 of the 11** things that carry one

Established by mutating one field at a time on a live world and re-hashing, not by reading.

| notices | ignores |
|---|---|
| `pawn.pos.z` | `building.pos.z` · `site.pos.z` · `plant.pos.z` · `item.pos.z` |
| `poi.pos.z` | `landingSite.z` · `pawn.draftTarget.z` |
| | `pawn.moveTarget` — *entirely*, not just its `z` |
| | `pawn.path` — only `.length` is hashed (`hash.ts:83`) |
| | `pawn.job` — `kind`/`toilIndex`/`workDone`/`attempts` only, and **five `Job` variants embed a `TilePos`** (`job.ts:30,36,54,60,87`) |
| | `world.reservations` — saved, never hashed at all |

Two saves identical except that every building moved from level 0 to level 4 **hash
identically**. The round-trip test cannot see it.

**`serialize.ts` is not part of this problem** — `at()` (`serialize.ts:183`) already writes `z`
for every position. The gap is entirely in the hash, which makes it worse rather than better:
serialization is *correct* and unguarded, so nothing would fail if it stopped being correct.

The four riskiest carriers are the ones a level-blind test would leave out — job targets,
`moveTarget`, `path`, reservations. A test covering only the six obvious `pos.z` fields is the
mirror of M12.5's test that could not fail: specified in a plan, and therefore checked by nobody.

### 2. Default-`z` parameters are the new "the cell" vs "every cell"

`map.isPassable(x, y)`, `canStep(map, x, y, dx, dy)`, `stepCost(...)`, `pos(x, y)` — every one
silently means level 0. **14 default parameters**, in `render/iso.ts` (×3),
`sim/core/position.ts`, `pathfind/neighbours.ts` (×2), `world/footprint.ts`, `world/spawn.ts`
and `world/tilemap.ts` (×6).

**Delete every default**, and the typechecker enumerates the work: measured in a scratch
worktree, **399 compile errors**. That is not the small blast radius it first looked like, but
it is the *right shape* — a silent wrong-level bug becomes a compile error — and it is
lopsided in the direction that matters:

- **`src/sim/` has exactly three real call sites** — `world/spawn.ts:154`, `world/spawn.ts:264`,
  `world/worldgen.ts:128`. The simulation is essentially already level-clean.
- **20 in `render/`**, and **371 in `tests/`**, which is mechanical.

### 3. `collectOccluders` is worse than recorded, and the cut plane is the same question

It reads `terrainHeight(map.terrainAt(index))` and nothing else. Buildings are not in it at all
— a colonist behind a 22px wall is *already* partly hidden today with no fade — and it cannot
see a cut plane. Answering these separately is how two callers end up disagreeing about what
hides what, so one module owns both:

```ts
// render/visibility.ts
computeVisibility(world, cut, subjects) -> {
  cut: number,                      // highest level drawn
  fadedTiles: Set<number>,          // map indices
  fadedBuildings: Set<EntityId>,    // buildings were never in this set
}
```

Occluder depth becomes `(z, x + y)` compared lexicographically. Levels above `cut` are not
drawn; levels below draw progressively dimmed, so the active plane reads.

### 4. Reachability has *two* 2D assumptions, and the second one is invisible

The known one: `recomputeLinks` walks only a chunk's border ring (`reachability.ts:306-308`) on
the premise that "interior cells cannot reach another chunk in one step". True laterally,
**false vertically** — an interior stair cell reaches the chunk above. `refloodChunk` already
visits every cell, so it sets a per-chunk `hasVertical` flag for free and `recomputeLinks` walks
the interior only when that flag is set.

**The one that would have shipped:** `reachability.ts:316` is

```ts
if (nx >= x0 && ny >= y0 && nx < x1 && ny < y1) continue; // same chunk
```

A vertical neighbour has *identical* `nx, ny`, so it passes this test and is discarded as "same
chunk" — **every vertical link silently dropped**, even with `hasVertical` set and the interior
walked. It needs a `dz === 0 &&` term, and `floodWithinChunk:282` has the same shape. The
symptom is pessimistic reachability: `canReach` says no to a route A\* can walk, so a colonist
refuses an order with nothing on screen to explain it — the ADR 0008 failure shape, not the
one CLAUDE.md warns about, and just as invisible.

`neighbourChunks` gains `z ± 1` — but only the **two vertically aligned** chunks, since a
vertical step requires `dx === dy === 0`. A dirty chunk touches **11**, not 27. Diagonal
shoulders stay lateral and same-level, so the existing 8-neighbourhood argument still covers
them.

**Both budgets measured before the work, since `ReachabilityMap` is already z-indexed:**

| 512² | 1 level | 5 levels |
|---|---|---|
| `markDirtyAt` + `ensureFresh` | 548 µs | **574 µs** (+5%) |
| `markDirty()` + full rebuild | 54.7 ms | **65.1 ms** (+19%) |

Both land far inside the ≤2 ms / ≤150 ms budgets *before* any optimisation, so `hasVertical` is
not what keeps `markDirty()` survivable — its job is avoiding 256 interior cells per chunk in
`recomputeLinks`, which a chunk-count measurement cannot see.

### 5. Four searches rank candidates in 2D, and the two that matter most are need jobs

`roughDistance` (`workGivers.ts:47`) and `bestCellBeside` (`toils.ts:72`) are the obvious pair.
The two that matter more:

- **`needs.ts:78`** — the food search.
- **`needs.ts:142`** — the bed search.

Need jobs "outrank all work, unconditionally" and cannot be switched off, so a meal or a bed
directly overhead scores distance 0 and beats one three tiles away. `canReach` gates all four,
so nobody strands — and in `MineGiver` a candidate failing `bestAdjacentCell` `continue`s
*without* updating `bestDistance`, so an unreachable overhead rock is skipped rather than
poisoning the choice. The bad pick only happens when the overhead target genuinely is reachable
by a distant stair, which is the common case underground.

Cleared: `isAdjacentToFootprint` (`footprint.ts:194`) already guards `cell.z !== from.z`. And
`tileDistance` / `sameLevel` are **dead code** — never called outside tests — so ADR 0003's
`Infinity`-across-levels trap does not currently bite anything.

### 6. `escapeIfTrapped` only searches sideways

A pawn on an `Open` cell — a floor deconstructed under them at `z > 0` — is in the worst state
the simulation has, and the backstop searches its own level only. It gains a downward search:
**fall to the nearest floor below.** That is also the minimum viable version of falling.

### 7. Designations, zones and reservations key on flat cell indices

`Designations`, `Zones.stockpileCells` and `Reservations.cellOwner` all store `y * width + x`.
In a 5-level level-major grid those indices now mean *level 0*. The v7 → v8 migration must
remap all three, or an old colony's mine marks silently move to the bottom of the world.

---

## The v7 → v8 migration

A v7 save has `levels: 1` and every position at `z = 0`. Leaving it at one level would give an
old colony a world it cannot participate in, so the step **expands to five**, putting the old
surface at level 2:

- `map.levels` — set to 5. Stated, because it is the field the rest of this list assumes.
- `terrain` / `natural` — prepend `[ROCK, 2 * layerSize]`, append `[OPEN, 2 * layerSize]`,
  emitted as ≤`0xffff`-length pairs. Pure RLE surgery with no decode, exactly as
  `addNaturalTerrain` does at v1 → v2. Underburden is stone, which is not an invention.
- `blocks` / `seals` — the same, with zeros.
- Every `SavedPos` gains `z: 2` — pawns, `moveTarget`, `path`, `draftTarget`, items, plants,
  buildings, sites, POIs, `landingSite`.
- **`pawn.job`** — `serialize.ts:211` saves an `ActiveJob` verbatim, and five of eleven `Job`
  variants embed a `TilePos` (`MineJob.cell`, `HaulJob.to`, `SleepJob.spot`, `WanderJob.to`,
  `DeconstructJob.cell`). A colonist migrated mid-job to `z: 2` whose `job.cell` stays at
  `z: 0` is pointing into the underburden this step just invented: `bestCellBeside` finds
  nothing, and a restored `SleepJob.spot` sends someone to walk into rock. Same class as the
  bedroll widening — a saved sub-object nobody enumerated — and per finding 1 the hash cannot
  see it either, so the round-trip test would not catch the omission.
- Designation, stockpile and reservation cell indices: `i` → `2 * layerSize + i`.

**Every literal frozen with a stated reason**, per the rule at the top of `migrate.ts`:
`V7_ROCK = 6`, `V8_OPEN = 11`, `V8_LEVELS = 5`, `V8_SURFACE = 2`, `V8_MAX_RUN = 0xffff`. No
`Terrain.Rock`, no `WORLD_LEVELS`, and no `decodeRle` for the run cap.

**`V8_OPEN = 11` is a literal frozen before the value exists**, which is the one thing freezing
is supposed to prevent. M16 adds *two* terrains. Declare them `Stair: 11, Open: 12` and this
step writes `Stair` into every cell above the surface — **every empty level becomes a staircase
filling the sky**, on every migrated save, silently. So either `Open` is declared first and the
spec says so as a constraint, or the step is written after the enum and freezes what it finds.
The former; it is one line of ordering against a whole class of unrecoverable save corruption.

---

## Milestones

Slice 3 keeps **M14** (buildings pass) and **M15** (a world with things in it), both still
deferred behind this slice, so Slice 4 takes **M16–M20**. Odd to run M16 before M14, and
cheaper than renumbering every commit message and roadmap paragraph that names them.

### M16 — The third axis *(sim only)*

**Task 0 — measure the save cost. ✅ Done**, `tools/measureLevels.ts`, three seeds at 512² and
confirmed at 1024². The terrain is modelled the way M18 will generate it — rock below the
surface, real terrain at it, `Open` above — from the *existing* elevation field at the existing
wavelength, because a uniform stack is the trivially cheap case and would have flattered the
answer.

| variant | 512² | vs 1 level |
|---|---|---|
| 1 level | 289–294 KB | 1.00× |
| 1 level, played a week | 295 KB | 1.01× |
| 3 levels | 358–366 KB | 1.23–1.25× |
| **5 levels** | **352–363 KB** | **1.20–1.24×** |
| **5 levels + caves** | **443–466 KB** | **1.52–1.60×** |

**Five levels is comfortably affordable** — the worst case measured, 466 KB with caves carved,
is *below* what the roadmap recorded as the cost of a flat world. **A uniform level RLEs to 5
runs**, five rather than one only because `encodeRle` caps a run at `0xffff`. Empty levels
really are empty.

**But the table above varies the wrong knob, and it says so if you read it: 5 levels comes out
cheaper than 3.** That anomaly is worth chasing rather than passing over. Sweeping the *bands*
instead:

| levels | relief bands | 512² | vs flat |
|---|---|---|---|
| 5 | 1 | 295 KB | **1.00×** |
| 5 | 2 | 366 KB | 1.24× |
| 5 | 3 | 352 KB | 1.20× |
| 5 | 4 | 381 KB | 1.30× |
| 5 | 5 | 406 KB | 1.38× |
| 8 | 3 | 352 KB | **1.20×** |
| 8 | 6 | 425 KB | 1.44× |

**The cost is not in levels at all — it is entirely in how many levels carry relief.** Eight
levels costs exactly what five does at the same band count; five levels over one band is free.
Three bands is a local *minimum*, a quantisation coincidence in `Math.floor(e * bands)`, which
is why the first table inverts. So `WORLD_LEVELS = 5` is close to costless, and the number that
actually spends the budget is M18's — *"the existing thresholds become level bands"*. At five or
six bands the answer is 1.38–1.44×, still affordable, but it is a decision rather than a
consequence and the spec has to name it as one.

And a finding that was not the question asked:

- **`localStorage` quota is counted in UTF-16 code units**, so a save occupies roughly double
  its JSON character length. "A multi-slot `localStorage` budget" has been the stated
  constraint since M7 and nobody had written the doubling down.

### The 475 KB, explained — and the first explanation was wrong

The recorded baseline does not reproduce: 294 KB measured at 512² against 475 KB, and 1,131 KB
at 1024² against 1.9 MB. The first pass called this "a difference in **method**, not a stale
seed", reasoning that both pairs were internally 4× apart. **That reasoning was unsound and the
conclusion was wrong.** Every candidate method is linear in cell count, so 4× discriminates
nothing; the measured pair is 3.85×, not 4.00×, which is the opposite of the inference drawn;
and no encoding tested lands near 1.62× (UTF-8 1.00, UTF-16 2.00, `encodeURIComponent` 1.93,
base64 1.33, pretty-printed 3.50).

The decisive experiment was to check the commit out, and it settles it. The figures come from
ADR 0007's table, introduced by **`4ebd163`** — measured against *that* commit's worldgen,
`elevationScale: 1/26` and `moistureScale: 1/19`, with no biome or wreckage fields. Measured
there: 490 KB at 512², and **473 KB on seed 12345** against the recorded 475. The very next
commit, **`bd46e95` (M7)**, copied the table into `ROADMAP.md` *and* lengthened those
wavelengths to 1/70 and 1/40 — the retune that turned a mottled map into a regional one, and
which halved the terrain run count (42,485 → 21,875 at seed 1). RLE size follows run count.
`serialize.ts` and `encodeRle` are byte-identical between then and now, so it is the terrain
change and nothing else.

**The figure was invalidated by the same commit that wrote it down**, and stood for six
milestones. That makes this the *fourth* instance of the pattern the roadmap is now
four-for-four on — a constant measured once, at a scale that then moved — and the sharpest,
because the scale moved under its own author. ADR 0007 carries the correction; the reachability
column of that table is correctly historical and is left alone.

- `Terrain.Open`, `Terrain.Stair`, `TerrainDef.connectsVertically`. **`Open` is declared first**
  — see the migration's frozen literal
- `TileMap.surfaceLevelAt(x, y)` — derived, maintained in `setTerrainAt` / `setSurfaceAt`
- **Every default `z` deleted** from `TileMap`, `canStep`, `stepCost`, `pos()` — 14 of them,
  399 compile errors, 3 real call sites in `sim/`
- `STEPS` (8 lateral + 2 vertical); `canStep(map, x, y, z, dx, dy, dz)`; `stepCost` takes the
  **destination** level
- A\* over `STEPS`; heuristic gains `MIN_STRAIGHT * |dz|`; the `start.z !== goal.z` bail goes
- Reachability: vertical links, the **`dz === 0` term on both same-chunk guards**, per-chunk
  `hasVertical`, `neighbourChunks` yields the two vertically aligned chunks
- All four 2D searches gain a level penalty — `workGivers.ts:47`, `toils.ts:72`, and the two in
  `needs.ts`; `escapeIfTrapped` falls
- Save v8: the migration above, plus the **eight** position carriers `hashWorld` ignores,
  reservations included. `serialize.ts` needs nothing
- Tests: the 220-edit brute-force oracle on a 3-level map with stairs; the **conditioned**
  symmetry sweep (*for passable `a` and `b`*, `a→b` iff `b→a`); one hash assertion per ignored
  carrier, **including a job target and a reservation**; determinism unchanged on a flat world

Stairs exist here only as scenario and worldgen fixtures. **The player cannot build one until
M20** — a terrain-result buildable placed one cell at a time makes a lone `Stair` connected to
nothing, so the buildable needs the `d` in a footprint. Staged deliberately; stated because the
model section reads as though it ships here.

**Playable check: there isn't one, and that is correct** — the renderer cannot draw a second
level yet. M12's precedent. Verified headless: a colonist walks level 0 → level 2 and back.

### M17 — Seeing it *(render)*

- `for z { for y { for x } }` as **per-level sub-containers** in Ground and Object layers.
  `tileDepth` stays a within-level comparison and no combined key that depends on map size is
  invented, which is what ADR 0003 asked for
- The **exposure rule**, so five levels is not five times the sprites: draw a non-`Open` cell
  only when the cell above is `Open`-or-cut (a top surface), or a screen-forward neighbour
  column is `Open` at that level (an exposed face). Prunes the interior of every rock mass
- **`terrainHeight` derived from `solid`**, the `TERRAIN_HEIGHT` table deleted, solids rising
  `LEVEL_HEIGHT`. *Here, not M16* — it lives in `render/art/terrainArt.ts`, so a milestone
  labelled "sim only" cannot own it, and doing it early would degrade occlusion for a whole
  milestone: `SEARCH_RADIUS = 3` in `occlusion.ts` is tuned to a 22px maximum, and 24px solids
  would out-reach it until `visibility.ts` replaces the module. `tests/occlusion.test.ts`
  asserts on the 14/22px reach and moves with it
- `Open` draws nothing; contact shadows and the tint field take a level
- **Stair art** — an opening from above, steps from below. On `manifest.ts`, measured by
  `tests/art.test.ts`, seeded per `(id, variant)` like every other terrain
- **`render/visibility.ts`** — cut plane and occlusion in one place, buildings included, which
  kills the live occlusion bug
- **Level-aware picking**: cast from `cut` downward, first non-`Open` cell wins. One function,
  because `worldToTile` takes a level precisely so the cut plane can decide
- Cut-plane controls and a HUD level readout, inside ADR 0005 (a gesture means one thing)
- Minimap paints `surfaceLevelAt` per column
- Scenarios: `two-level-plateau`, `stair-column`, `cut-plane` — two calls each

**Playable check:** stand a colonist on a plateau, cut the plane, and watch them walk down the
stair and out from under it.

### M18 — Relief *(worldgen)*

- Elevation noise selects a **surface level per column** rather than a terrain band; the
  existing thresholds become level bands
- **Natural stair columns guaranteed at step boundaries.** The guarantee is the *existing*
  one-landmass test in `tests/world.test.ts` extended across levels — a relief generator that
  makes mesas fails it loudly
- `findLandingSite` picks a level. It does **not** get its 28-tile radius fixed; that is
  confirmed broken and belongs to M15
- Water at a level; POI stamping gains one
- **The constant sweep, on a new axis**: every worldgen wavelength re-examined, and anything
  phrased as an absolute count rather than a fraction of the world named and measured
- **The edge-ramp decision**, made here against a picture rather than in advance

**Playable check:** ten seeds, ten worlds, every one walkable end to end, with relief you route
around rather than relief you notice.

### M19 — Caves *(the downstairs)*

- Cave generation below the surface — floors carved from the solid mass, with stair columns up
- Mining downward: a mine designation at a level, and what `minedInto` means when the cell
  above is Solid
- Cave lighting. The light grid has existed since M6, and a cave with no lamp in it is the
  first place in the game that is genuinely dark

**Playable check:** walk down into a cave and back out.

### M20 — A second storey *(the M14 inheritance)*

- Constructed floors that **require support**: `solid` below, or a building that supports
- Footprints gain a `d`, which is where `Stairs` (1×1×2) lands
- One multi-storey structure that proves the machinery
- Roofs are explicitly *not* here; "indoors" stays enclosure-based, which is a known gap

**Playable check:** build a second storey and stand a colonist on it.

---

## What this must not break, and what guards each

| Invariant | Guard |
|---|---|
| A\* and reachability never disagree | `canStep` is the only vertical rule; the 220-edit oracle runs on a 3-level map; a **conditioned** symmetry sweep, which is the only thing that would catch a one-way step |
| `markDirtyAt` stays cheap | **Measured: 548 µs → 574 µs at 5 levels**, against a ≤2 ms budget |
| `markDirty()` stays survivable | **Measured: 54.7 ms → 65.1 ms at 5 levels**, against ≤150 ms. `hasVertical` is not what buys this — its job is the 256 interior cells in `recomputeLinks` |
| Save fits `localStorage` | M16 Task 0 — measured, and the driver turned out to be relief bands rather than levels |
| `TerrainLayer` stays row-major within a level | Per-level containers; the level term never enters `tileDepth` |
| Saved state is in both `hashWorld` and `serialize.ts` | Six missing `z` fixed; one test per field |
| No pawn on an impassable cell | `escapeIfTrapped` falls; `Open` is impassable, so it is already in scope |
| No pawn sealed into a district | `buildAlerts` unchanged, and now fires more often — correctly |
| A migration imports no live definition | Four frozen literals with stated reasons |
| `sim/` is pure, and no `Math.random()` anywhere | `tests/architecture.test.ts` unchanged; stair art seeds a hash |

## Verification

`npm run art` before a dev server on any art change. Game states through scenarios, two calls
each — and the existing six must all capture **unchanged** after the solid-height change, since
they are flat worlds and any movement in them is a regression. `npm run check` before calling
anything done. Implement inline; hand each finished commit to a subagent with the brief and
orders to verify claims rather than trust them.

## Out of scope

- High-ground and cover combat modifiers — Slice 5, arriving with a world that has high ground
- Relic-tech dungeons — Slice 6, riding on M19's caves
- Roofs, temperature, weather
- `findLandingSite`'s 28-tile search radius — confirmed broken, and M15's
- Wall, door and hearth model conversion, materials and ornament — M14's, deliberately
