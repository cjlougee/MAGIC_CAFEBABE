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
reachability share `canStep`, and the 220-edit oracle guards *chunking*, not `canStep` itself.
Nothing in the suite would notice a one-way step.

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

### 1. `hashWorld` does not hash `z` for six of the eight things that carry one

Mixed: `pawn.pos.z`, `poi.pos.z`. **Not mixed:** `building.pos`, `site.pos`, `plant.pos`,
`item.pos`, `landingSite`, `pawn.draftTarget`. A bed restored on the wrong *level* round-trips
perfectly by every other measure — exactly the M10 rotation argument arriving through a
different door. Fixed in v8, with a test that mutates each `z` and asserts the hash moves.

### 2. Twenty-two default-`z` parameters are the new "the cell" vs "every cell"

`map.isPassable(x, y)`, `canStep(map, x, y, dx, dy)`, `stepCost(...)`, `pos(x, y)` — every one
silently means level 0.

**Delete every default.** The typechecker then enumerates all 77 `GROUND_LEVEL` sites, and each
becomes a decision rather than an assumption. Mechanical, and it converts a class of silent
wrong-level bug into a compile error. Only **6** `idx()` calls in the whole codebase omit `z`,
so the blast radius is small and known.

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

### 4. `recomputeLinks` walks only a chunk's border ring, and that premise dies

The comment says "interior cells cannot reach another chunk in one step". True laterally,
**false vertically** — an interior stair cell reaches the chunk above.

The fix is not to walk all 256 cells of every chunk. `refloodChunk` already visits every cell,
so it sets a per-chunk `hasVertical` flag for free, and `recomputeLinks` walks the interior only
when that flag is set. In open country and inside rock, that is never. `neighbourChunks` gains
`z ± 1`, so a dirty chunk touches up to 27 instead of 9 — and only when it holds a connector.

### 5. `roughDistance` ignores `z` entirely

`workGivers.ts:48` is 2D Manhattan and so is `bestAdjacentCell` in `toils.ts:72`. A rock
directly above a colonist scores distance 0 and ranks best, while actually requiring a walk to
a staircase. `canReach` gates it, so nobody strands — they just choose badly, forever, with no
visible cause. Both gain a level penalty.

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

- `terrain` / `natural` — prepend `[ROCK, 2 * layerSize]`, append `[OPEN, 2 * layerSize]`,
  emitted as ≤65535-length pairs. Pure RLE surgery with no decode, exactly as
  `addNaturalTerrain` does at v1 → v2. Underburden is stone, which is not an invention.
- `blocks` / `seals` — the same, with zeros.
- Every `SavedPos` gains `z: 2` — pawns, `moveTarget`, `path`, `draftTarget`, items, plants,
  buildings, sites, POIs, `landingSite`.
- Designation, stockpile and reservation cell indices: `i` → `2 * layerSize + i`.

**Every literal frozen with a stated reason**, per the rule at the top of `migrate.ts`:
`V7_ROCK = 6`, `V8_OPEN = 11`, `V8_LEVELS = 5`, `V8_SURFACE = 2`. No `Terrain.Rock`, no
`WORLD_LEVELS`. A renumbered terrain table must still read an old file correctly.

---

## Milestones

Slice 3 keeps **M14** (buildings pass) and **M15** (a world with things in it), both still
deferred behind this slice, so Slice 4 takes **M16–M20**. Odd to run M16 before M14, and
cheaper than renumbering every commit message and roadmap paragraph that names them.

### M16 — The third axis *(sim only)*

**Task 0 — measure the save cost and report it.** Generate 512² at `levels` 1/3/5, serialize,
compare bytes and RLE ratio. Five levels is decided; the number is still owed, because this
project is two-for-two on constants nobody measured and a new axis is a new place for one.
Baseline is 475 KB at 512²×1. Expectation is ~1.5–2× rather than 5×: the current grid's run
count is dominated by the ruin field at wavelength 1/11, which upper levels do not have, and a
pure-`Open` level is one run. **If it lands past ~1.2 MB, that is a finding to bring back, not
a cap to apply quietly.**

- `Terrain.Open`, `Terrain.Stair`, `TerrainDef.connectsVertically`
- `terrainHeight` derived from `solid`; the `TERRAIN_HEIGHT` table deleted
- `TileMap.surfaceLevelAt(x, y)` — derived, maintained in `setTerrainAt` / `setSurfaceAt`
- **Every default `z` deleted** from `TileMap`, `canStep`, `stepCost`, `pos()`
- `STEPS` (8 lateral + 2 vertical); `canStep(map, x, y, z, dx, dy, dz)`
- A\* over `STEPS`; heuristic gains `MIN_STRAIGHT * |dz|`; the `start.z !== goal.z` bail goes
- Reachability: vertical links, per-chunk `hasVertical`, `neighbourChunks` yields `z ± 1`
- `roughDistance` and `bestAdjacentCell` gain a level penalty; `escapeIfTrapped` falls
- Save v8: the migration above, plus the six missing `z` in `hashWorld` **and** `serialize.ts`
- Tests: the 220-edit brute-force oracle on a 3-level map with stairs; a **`canStep` symmetry
  sweep** (`a→b` iff `b→a`) over random 3D maps; each of the six `z` fields mutated against the
  hash; determinism unchanged on a flat world

**Playable check: there isn't one, and that is correct** — the renderer cannot draw a second
level yet. M12's precedent. Verified headless: a colonist walks level 0 → level 2 and back.

### M17 — Seeing it *(render)*

- `for z { for y { for x } }` as **per-level sub-containers** in Ground and Object layers.
  `tileDepth` stays a within-level comparison and no combined key that depends on map size is
  invented, which is what ADR 0003 asked for
- The **exposure rule**, so five levels is not five times the sprites: draw a non-`Open` cell
  only when the cell above is `Open`-or-cut (a top surface), or a screen-forward neighbour
  column is `Open` at that level (an exposed face). Prunes the interior of every rock mass
- Solids rise `LEVEL_HEIGHT`; `Open` draws nothing; contact shadows and the tint field take a
  level
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
| A\* and reachability never disagree | `canStep` is the only vertical rule; the 220-edit oracle runs on a 3-level map; a new symmetry sweep |
| `markDirtyAt` stays cheap | Per-chunk `hasVertical`; measure against 615 µs, budget ≤2 ms |
| `markDirty()` stays survivable | All-impassable chunks skip link recomputation; measure against 50 ms, budget ≤150 ms |
| Save fits `localStorage` | M16 Task 0 — reported, not assumed |
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
