# Roadmap

We build **vertical slices**. Each slice is playable and interesting on its own; each milestone inside
a slice ends at something you can look at and touch. The failure mode for a project this size is six
systems at 40% depth and nothing playable — slices are the defence against it.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Slice 1 — The colony spine ("a colony that survives a week")

Map, pawns, job scheduler, needs/mood, construction, save/load. This is the skeleton every later
slice hangs off.

### M0 — Skeleton
- [x] Vite + TS + React + Pixi scaffold
- [x] Enforcement rules: import firewall, no-`Math.random`, determinism test
- [x] Seeded RNG (sfc32) with serializable state
- [x] Fixed-tick loop decoupled from render, speed controls (pause/1x/2x/3x)
- [x] Command queue + `SimSnapshot` publisher
- [x] Tile grids, terrain defs, seeded worldgen (elevation / moisture / ruins)
- [x] Palette + `ArtProvider` procedural sprite generation
- [x] Viewport-pooled terrain rendering with two-stage culling, camera pan/zoom
- [x] Low-frequency tint field so large areas don't read as flat colour
- [x] Day/night wash — pulled forward from M1, because a ticking clock with no visual
      consequence made the HUD read as decoration
- [x] **2:1 isometric projection** with raised faces on solid terrain (ADR 0002).
      Converted after M0 review; touched only `src/render/`, no simulation code — the
      firewall paying for itself inside the first milestone
- **Playable check:** ✅ pan and zoom a colourful generated map at a stable 60fps.

### M1 — Pawns & movement
- [x] Pawn entity + generic entity store, ids saved so references can't be reused
- [x] Binary-heap A* with reused scratch buffers and a generation-stamp instead of clearing
- [x] Connected-component reachability, sharing `canStep()` with A* so the two can't disagree
- [x] Movement stepping, selection, right-click-to-move as a direct order
- [x] Procedural layered pawn art (skin / hair style / hair colour / apparel), colours by index
- [x] Seeded landing-site choice + colonist spawning, HUD colonist roster
- [x] Ground/object layer split with depth sorting, and **occlusion fade** for pawns behind cliffs
- [~] Per-cell light grid — **moved to M3**. Lamps and campfires don't exist until then, and a light
      grid with no light sources is the flat wash with extra machinery.
- **Playable check:** ✅ click a pawn, right-click the ground, they walk there and around obstacles.

See [`design/02-pawns-and-movement.md`](design/02-pawns-and-movement.md).

### M2 — The job system *(the big one)*
- [x] `WorkGiver` → `Job` → `JobDriver` → toils pipeline, with a reusable toil library
- [x] Reservation system, released through the single exit `endJob()`
- [x] **Hard preemption** — `interrupt(pawn, reason)` releases claims and drops carried goods
- [x] Staggered pawn thinking (`tick % 30 === id % 30`)
- [x] Per-pawn priority grid UI (1 most urgent, 0 disabled)
- [x] Ground item stacks with spill-on-overflow, stockpile painting, designation overlays
- [x] Tool modes (select / mine / stockpile / erase) with drag-rect preview
- [~] Work types: **Mine and Haul only.** Construct needs blueprints (M4) and Cook needs
      stoves (M3) — a column with no giver behind it is a lie told to the player. Each
      new type is now one giver + one driver.
- **Playable check:** ✅ designate rock, paint a stockpile, walk away — colonists mine,
  haul, and never fight over the same rock. Verified headless *and* in-browser.

See [`design/03-work-and-jobs.md`](design/03-work-and-jobs.md).

### M3 — Needs, mood, survival
- [x] Hunger + Rest, with need jobs that outrank *all* work unconditionally
- [x] Berry bushes that regrow + the **Harvest** work type — food as a loop, not a countdown
- [x] Eating (a meal, not a mouthful), starvation damage, death
- [x] Bedrolls carried by the landing party; sleeping rough costs mood
- [x] Thoughts and mood — mood is always a list of reasons, never a number
- [x] Mental break ("sad wander"), preempting whatever they were doing
- [x] Alerts panel and colonist inspector (needs, health, mood, thoughts)
- [x] Unique colonist names (a duplicate roster entry made every story ambiguous)
- [x] **Cooking moved to Slice 2** — and *landed* there, in M6. Cooking is production, and a
      one-off campfire recipe here would have been rewritten the moment bills existed. Raw
      food carried a mood penalty in the meantime, which is what made cooking worth building.
- [x] **Light grid followed cooking to Slice 2**, for the same reason: campfires are the
      first light source, and a light grid with nothing to light is the flat wash with extra
      machinery. Delivered in M6.
- **Playable check:** ✅ a colony feeds and beds itself unattended for 3 in-game days — asserted
  headless in `tests/survival.test.ts`, 180,000 ticks in under a second.

See [`design/04-needs-and-mood.md`](design/04-needs-and-mood.md).

### M4 — Construction & rooms
- [x] Architect menu with costs; blueprints that accumulate materials then labour
- [x] **Construct** work type; material delivery added as a second **Haul** giver
- [x] Walls, doors, and stone floors — one `Buildable` list covering building *and*
      terrain results
- [x] Buildings affect passability separately from terrain, and sealing separately from
      blocking, so a door is walkable *and* a room edge
- [x] Room flood-fill requiring a **built** boundary, not merely an enclosed one
- [x] "Slept under a roof" thought, stacking with the bed thought
- [x] Cancelling a blueprint refunds delivered materials
- [x] Harvest stops at a ~3-day food buffer — without it colonists harvest forever and
      never mine or build anything
- [x] **Deconstruction** — a designation, a second giver under Construct, and a driver
      that salvages half the original cost, rounded down. Added after Slice 1 closed,
      because until it existed a misplaced building was permanent. Brought a
      `naturalTerrain` grid with it (a floor has to give back the ground it was laid on)
      and with that the first real link in the save migration chain, v1 → v2.
- **Playable check:** ✅ order a hut; colonists deliver stone, raise the walls, hang the
  door, and the inside registers as a room — asserted headless in `tests/construction.test.ts`.
  Then mark it and walk away, and they take it down again for half the stone back —
  `tests/deconstruction.test.ts`, and watched in-browser.

See [`design/05-construction-and-rooms.md`](design/05-construction-and-rooms.md).

### M5 — Save/load & the survival test
- [x] Serialization to plain JSON, RLE-compressed terrain (~20KB per colony)
- [x] Version field and a migration chain that upgrades one step at a time
- [x] Named save slots in `localStorage`, owned by `app/` because `sim/` must stay headless
- [x] Pause menu with a save browser: name and create, load, overwrite, delete; the
      pre-naming single-slot save is migrated rather than lost
- [x] Headless **survive-a-week** regression test
- [x] Save mid-week, reload, finish the week — bit-identical to an uninterrupted run
- **Playable check:** ✅ save, play on, load, and the colony is exactly as you left it.

See [`design/06-save-and-load.md`](design/06-save-and-load.md).

---

## Slice 1 is complete

A colony that generates, works, feeds itself, builds, and persists. 328 tests at the time
it closed, 382 now; the simulation runs seven in-game days in about a second, headless.

---

## Slice 2 — The Frontier

*Renamed mid-slice.* It opened as **Production** and was going to close with a smelter and two
recipes. That plan died in design rather than in code: `scrap → refined → relic-tech` is a type
hierarchy — three nouns in a partial order — and no amount of implementation was going to make it
interesting. The production content survives; it lands in M10 as *what you carried home*.

What the slice is now: **the world gets big enough to have a somewhere else, and you can go there
and come back.** Exploration comes forward from Slice 4, and the smallest useful piece of Slice 5
comes with it, because you cannot travel without taking colonists out of the work pool. Formations,
morale and real tactical command stay where they were.

See ADR [0007](decisions/0007-world-shape.md) for the world shape, and
[`design/00-vision.md`](design/00-vision.md) for the specificity principle the whole slice serves.

### M6 — Cooking, and the first bills
- [x] **Recipes** in `defs/recipes.ts`, shaped like buildables — a cost list, labour, a
      result — so `outstanding` / `hasAllMaterials` / `missingMaterials` generalise over
      `(delivered, cost)` in `entities/materials.ts` and serve sites and benches alike
- [x] **Workbenches are buildings that carry bills and a ledger**, not a separate entity
      type with its own reservations, save section, and answer to "what is on this cell"
- [x] **Bills are suspended by arithmetic**, not a flag: the giver counts the product in
      the world and skips the bill when the colony has enough, so a bench idles when
      stocked and restarts when supplies drop with no state to keep in sync
- [x] Quotas come with a sensible default and are the player's to change — what counts as
      "enough" is a decision they own, per bench
- [x] **Cook** work type: one giver returning `stockBench` or `craft` depending on what the
      bench needs next. Stocking claims only the ingredients, crafting claims the bench, so
      several cooks can load one fire while only one consumes it
- [x] Campfire, Meal, and `nutrition`/`eatThought` moved onto `ItemDefinition` — colonists
      prefer the best food available and remember it accordingly
- [x] Per-cell light: campfires push back the night wash. Lives in `render/` and is derived,
      because darkness does not affect the simulation *yet*
- [x] Save v3: bills, bench ledgers, and a fifth work-type column, with a migration that
      pads old priority arrays rather than leaving `priorities[Cook]` undefined
- **Playable check:** ✅ build a fire, place one bill, walk away — colonists fetch berries,
  cook, and *stop at the quota*. Watched in-browser at nightfall; asserted headless in
  `tests/cooking.test.ts`.

See [`design/07-production.md`](design/07-production.md).

### M7 — The world gets big *(infrastructure with a view)*
- [x] `DEFAULT_MAP_SIZE` 128 → 512: sixteen times the area, roughly a quarter-hour to cross on foot
- [x] **Reachability chunked** into 16×16 local components joined by a cached cross-chunk link
      graph. A single-cell change went from 63.7 ms to **615 µs** — and because the residual cost
      scales with chunk count rather than cell count, 1024² fell from 195 ms to 2.2 ms. Guarded by
      a brute-force whole-map oracle run after every one of 220 random edits
- [x] **Biome worldgen** — four biomes from crossed warmth/damp fields, *parameterising* the
      existing per-cell choice rather than replacing it. Never stored: it is a pure function of
      seed and position, so it is derived state
- [x] **The local wavelengths had to grow too**, and this was the finding of the milestone.
      Biomes alone left the map *mottled* — elevation features were 26 tiles, tuned when that was a
      fifth of the map and not a twentieth. Rock speckled everywhere instead of gathering into
      ranges. Fields are now ordered longest-to-shortest so a range sits inside a region and a ruin
      sits on a hillside
- [x] The ruin noise field stays, demoted to *texture*, with a separate long-wavelength wreckage
      field deciding where the fallen civilization built thickly. Ruin fields cut across biomes
      rather than lining up with them
- [x] `MIN_ZOOM` 0.35 → 0.2, and a **zoom row in the debug panel** with a live readout
- [x] Two worldgen guarantees now asserted at the size the game generates: mostly walkable, and
      **one landmass** — largest district holds 97.5–99.8% of walkable ground across sampled seeds
- **Playable check:** ✅ a continent that reads as different places — a lake with shallow margins,
  green country, a grey massif with relic structures clustered in it, sand to the east. 60–64fps at
  3x with colonists mining. Watched in-browser; the terrain census and connectivity sweep that back
  it are in `tests/world.test.ts`.

### M8 — There is a somewhere else
- [x] POIs **placed by a constraint search and named once at generation**, then persisted —
      [ADR 0008](decisions/0008-places.md). The properties that make somewhere a destination are
      all *relational* (far from home, not in a lake, not on the last one, has a way in), and a
      threshold on noise has nothing to relate to
- [x] One **guaranteed relic vault** per world plus up to five listening posts. Only the vault
      re-runs its search on looser terms — an optional place that finds no good ground simply does
      not exist that seed, which beats one wedged somewhere implausible
- [x] Compounds are **stamped into the terrain**: bulkhead perimeter, plating interior, offset
      internal wall, doors on facing walls. Not a label on a dense patch of the ruin field
- [x] **Doors are chosen, not cut** — from wall cells facing open ground that connects to the
      colony. Random gaps gave seed 7 a sealed compound whose walkable interior became an isolated
      reachability district: a colonist sent there never arrives, and nothing on screen says why
- [x] **A minimap**, one pixel per tile, drawn flat rather than isometric. Camera diamond,
      colonists, home, and every named place; click the map or a name to jump. Terrain repaints
      only on `TileMap.revision`
- [x] Save v4 — places round-trip, and their **names are hashed**, so restoring the right compound
      under the wrong name fails instead of passing
- **Playable check:** ✅ ten seeds, ten worlds with named places 44–220 tiles out, every one of
  them walkable-into from the landing site — `tests/places.test.ts`. Watched in-browser: *Corvid
  Vault* 98 tiles north, found on the minimap, reached by clicking its name.

### M9 — You can go there
- [ ] **Draft** — a colonist out of the work pool, taking direct orders only. `interrupt()`'s
      `reason` parameter was written for exactly this, and `tickPawnAI`'s break → needs → work
      hierarchy has one obvious slot for it
- [ ] Multi-select, and a move order that applies to a party
- [ ] Needs tick on the road, so you sleep rough and get hungry and distance *costs* something —
      friction out of systems that already exist, with no combat required
- [ ] Settle where the player character lands. Cheap mechanically, but "you go and take people" is
      a different game from "you detach a squad"
- **Playable check:** four colonists travel 200 tiles and back while the colony keeps mining, and
  the trip is a real expense.

### M10 — You bring something back
- [ ] Relic-tech **recovered** at the ruin, not manufactured
- [ ] The refined tier, and a bench to make it at — the M6 bill system carrying its second and
      third recipe
- [ ] **Skills**: who can make what, gated by what they have learned. Arriving *after* there is a
      journey to survive, so the numbers get designed against something real
- [ ] Blueprints as found knowledge rather than a menu that unlocks
- **Playable check:** the thing you carried home changes what the colony can build.

---

## Later slices

Real, but not designed in detail yet. Each gets its own design pass when we reach it.

- **Slice 2 — The Frontier.** *In progress — see M6–M10 above.* Quality tiers and a power grid are
  still unscheduled, and stay deferred until something needs them.
- **Slice 3 — Threat.** Combat, body-part injury model (`hediffs`), raids, an event director that
  paces pressure. Where high-ground and cover modifiers land, since they need combat to modify.
  Now arrives with a world to be threatened *across*, and with enemy camps worth clearing to slow
  the pressure down.
- **Slice 4 — The world outside.** *Partly pulled into Slice 2.* Ruin exploration came forward as
  M8–M9. What remains: factions, trade, named NPCs, towns you can buy into, and the multi-level
  worldgen and cave dungeons that serve them.
- **Slice 5 — Command.** *Partly pulled into Slice 2.* Draft and party movement come forward in M9,
  because travel is impossible without them. Formations, morale, and genuine tactical control
  remain — the Bannerlord layer, riding on the preemption built in M2.

---

## Picking this up next

Slice 1 works and M6 gave it a production loop. It is still not a *game*: there is no pressure,
nowhere to go, and the colony's whole world is 128 tiles across.

**M7 and M8 are done. M9 is the current milestone.** The world is 512², reads as country, and has
named places on it that you can find and point the camera at. What it has not got is any way to
*go*: the only thing that moves a colonist eighty tiles is a direct order to one pawn, who then
walks there alone, hungry, and still nominally on the work roster.

M9 is draft, multi-select, a party move order, and needs ticking on the road. Then M10, then
**Slice 3 — threat**, which now has a world to be dangerous across and camps worth clearing. The
`hediff` array on pawns is already there waiting.

**What M8 taught, worth carrying into M9:** the bug that mattered was not in placement but in
*reachability's silence*. A sealed compound is not an inaccessible building — its interior is
walkable, so it becomes a legitimate district of its own, and `canReach` answers "no" perfectly
correctly while the player sees a colonist refuse an order for no visible reason. Anything M9 adds
that can strand a pawn — a travel order to somewhere across water, a party told to hold a spot
inside a ruin — needs to fail *loudly*, because the failure mode here is a colonist standing still.

**What M7 taught, worth carrying into M8:** the milestone's real finding was not biomes, it was
that *every* tuning constant in worldgen encoded the old map size. Biomes went in first and the map
still looked like static, because elevation was switching bands every 26 tiles. Anything that reads
"features per map" rather than "features per tile" is suspect at the new scale — the landing-site
search radius (28 tiles, unchanged) and `BUSH_DENSITY` are the next two to look at.

*Deconstruction is done* — it was the obvious hole in M4 and is ticked off there.

### Known gaps, honestly

- **No roofs.** "Indoors" means enclosed-by-something-built. Fine now; temperature or
  weather would need real roofs.
- **Every building is one tile, and sleeping colonists stand up.** A bedroll should be 2x1
  and a pawn should *lie on* it. The two halves are very different sizes: the lying-down
  pose is render-only (an asleep pawn drawn rotated or flattened onto the bed, reading the
  `asleep` flag the snapshot already carries), while **multi-tile footprints are a system**
  — placement legality, `buildingBlocks` and `buildingSealsRoom` across several cells,
  which cell a pawn reserves and walks to, room flood-fill, save shape, and deconstruct all
  currently assume one building occupies exactly one cell. Do the pose first; treat
  footprints as their own milestone rather than a polish item.
- **The best landing sites are the furthest from stone, and M7 made it worse.**
  `findLandingSite` maximises open, *storable* ground, and rock is neither passable nor
  storable — so the chooser actively walks away from it. With biome-scale regions the
  party can now land well inside a grassland with the nearest rock, and sometimes the
  nearest *anything else*, a long walk away. The search radius is still 28 tiles around
  the map centre, which was a meaningful fraction of a 128² map and is now 5% of one.
  Not a bug; due a pass when first-hour pacing is looked at.
- **Save size is now the constraint on world size**, where reachability used to be.
  475 KB at 512² against 1.9 MB at 1024², which starts crowding a multi-slot
  `localStorage` budget. Worth knowing before anyone raises `DEFAULT_MAP_SIZE` again.
- **A mine mark on rock is nearly invisible.** Designations draw on the ground plane, and
  rock is raised, so the mark sits at the base of the block it refers to. Deconstruction
  hit the same wall and solved it for *buildings* by tinting them; mining has no
  equivalent yet, and the honest fix is probably the same one.
- **`lookup.ts` scans linearly** over buildings and sites, and the work givers scan every item
  once per pawn per think tick. Fine at dozens, not at thousands — when it matters, put the index
  *inside* the store so it cannot desync. **Measured out of M7 rather than assumed out:** a
  five-colonist colony ticks in 29 µs at 512², against a 16,667 µs frame budget. It grows with item
  count, not with map size, so the bigger world did not move it.
- **No save thumbnails or autosave.** Saving is manual and the list shows text only.
- **Verticality is reserved, not built.** See ADR 0003; the data model takes a `z` today.
- **No sound, no main-menu-before-game, no settings.**

### The bugs that were invisible to tests

Every real defect in this project passed a green suite and was obvious within a minute of
watching the game. Budget for looking at it.

| Bug | Symptom |
|---|---|
| Cached ground layer | Mined rock left black holes in the map |
| Colonists eating one berry per trip | "Eats when hungry" was *technically* true |
| Deliverers entombed in walls | Seven of sixteen walls silently never built |
| Landing site scored by `isPassable` | The party landed in the middle of a lake |
| A deconstruct mark drawn under the wall | Marking a wall showed the player nothing at all |

The landing-site one is the sharpest example so far of a rule being right and applied to
the wrong question. Openness was measured with `isPassable`, and shallow water is passable
— so an open lake scored *maximum* openness, and the heuristic written to avoid the worst
possible site went looking for the second worst. Nothing is storable there, so the bedrolls
the party carried were silently never placed and everyone slept rough for the rest of the
game with a permanent mood penalty and no visible cause. Three of thirty-one sampled seeds.
Both halves are now swept across seeds in `tests/water.test.ts`, because a single lucky
seed passing is exactly how it survived a green suite the first time.

### Where the load-bearing knowledge lives

- **`CLAUDE.md`** — the three enforcement rules and the invariants that fail silently.
  Read first.
- **The debug panel (`` ` `` in a dev build)** — skip to a time of day, hand out resources, place
  finished structures. Documented in `CLAUDE.md`. Reach for it before spending twenty minutes
  arranging a situation by hand; that cost is exactly why it was built.
- **`.claude/skills/add-work-type`** — the checklist for a new kind of colonist work.
  Written after M2 from real code, extended by M3, M4, deconstruction, and Cook.
- **`.claude/skills/art-pass`** — drawing or improving a procedural sprite. The shared shape
  language, the one light direction, and the geometry rules that break tile alignment
  without ever raising an error. Written after the M6 art pass from the mistakes it made.
- **`docs/decisions/`** — eight ADRs covering the stack, the projection, verticality,
  water, controls, deconstruction, the shape of the world, and how places differ from texture.

## Verticality — reserved, not built

The data model supports stacked z-levels; nothing generates or renders a second one yet. See ADR
[0003](decisions/0003-verticality.md) for why this split, and for the height-field model that was
rejected.

**Already reserved** (costs one unused field per position, and one multiply-by-zero per index):
- [x] `TilePos {x, y, z}` defined before the first pawn exists — the retrofit that would actually
      have been expensive
- [x] `TileMap.levels` with level-major indexing, exercised by tests on a real 3-level map
- [x] Level-aware `tileToWorld` / `worldToTile`; `hashWorld` covers `levels`

**Deliberately deferred**, each to the slice where it has something to serve:
- [ ] Vertical connectivity — ramps/stairs in pathfinding *(M1, alongside reachability)*
- [ ] Cross-section rendering: hide roofs, walls, levels above the cut plane *(when a second level
      exists to look at — this is a draw-loop filter, not a data-model change)*
- [ ] High-ground damage bonus, cover and trench defence bonuses *(Slice 3)*
- [ ] Multi-level worldgen, caves, relic-tech dungeons *(Slice 4)*
- [ ] Reconcile decorative terrain relief with `LEVEL_HEIGHT` — currently a raised rock tile and a
      genuine level above would look identical while behaving completely differently
