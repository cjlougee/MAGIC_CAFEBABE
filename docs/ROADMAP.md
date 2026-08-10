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
- [x] **Draft**, and the discovery that direct orders had *never worked*. Movement is a path, not a
      job, and `startJob` clears the path — so every direct order since M1 had a lifetime of one
      think interval before a work giver silently threw it away
- [x] `draftTarget` is a **standing order**, kept until arrival, because eating clears the path and
      an order that lived only in `pawn.path` ended wherever hunger struck
- [x] **Needs still outrank draft.** A drafted pawn that ignored hunger would starve on an
      expedition with a corpse as the only feedback
- [x] Multi-select — shift-click, drag a rectangle, or shift-click the roster — and `moveParty`,
      which fans the party out over distinct cells rather than stacking them on one
- [x] **Travel to a named place** from the party panel. The places existed since M8 and were
      effectively unusable without it
- [x] **A player character**, rolled at worldgen. A ◆ in the roster and nothing else yet
- [x] Save v5, with draft state hashed — a restored colonist resumes their walk
- [x] Failing loudly: an impossible order is kept and alerted rather than dropped, and
      `pawnActivity` separates **travelling** from **holding** from **idle**
- [x] **A\*'s node budget was a flat 20,000** — more cells than a 128² map contains, so it could
      never bind, and at 512² it binds on any long walk. A drafted colonist stood in a meadow for
      five in-game hours: reachability said yes, A\* said no, nothing said anything. Now the whole
      map, with `canReach` doing the job the budget was pretending to
- **Playable check:** ✅ three colonists sent to *Mast Five*, 176 tiles out, walked ~340 tiles,
  arrived on three distinct cells inside the compound, and stood there **holding** — off the work
  roster the whole way. Watched in-browser; asserted headless in `tests/command.test.ts`.

See [`design/09-command.md`](design/09-command.md).

*The view does not change in M9 and is not expected to later.* Isometric, recruit pawns for direct
control, send them by clicking. Settled — see [`design/00-vision.md`](design/00-vision.md).

---

## Slice 2 is complete

The world got big enough to have a somewhere else, that somewhere else got a name, and a party can
be sent to it and brought home. 417 tests; the simulation still runs seven in-game days in about a
second, headless, on a map sixteen times the size Slice 1 shipped.

---

## Slice 3 — The Built World ("the colony gets an inside")

*This is the old "detail pass", scheduled.* **M10 as written is retired** — the crafting ladder was
going to be next, and the detail work matters more to whether this is worth playing. What was a
seventeen-item wish list in [`BACKLOG.md`](BACKLOG.md) is now five milestones in a committed order;
that file keeps only what is genuinely unscheduled.

The slice's argument: the colony can build, but everything it builds is a one-cell grey cube. A room
is four walls and a floor with nothing in it, a door is a passable square, and the architect menu is
an undivided list that already strains at four entries. **Footprints come first because a desk is
not one tile** — items 8 and 9 are both gated on it.

### M10 — Footprints *(item 6)*
- [x] `BuildingDef.footprint {w, h}`; `Building` and `ConstructionSite` carry a saved `rotation`,
      with cells **derived** in one new `sim/world/footprint.ts` and never stored — [ADR
      0009](decisions/0009-footprints.md)
- [x] Placement legality, occupancy lookup, grid stamping, walk-adjacent and deconstruct all move
      from "the cell" to "every cell" — `markDirtyAt` per cell, never the blanket `markDirty()`
- [x] Room flood-fill changed **not at all**, which is the test that the shape of the fix was right:
      it reads `sealsRoomAt` off the grid, so stamping every cell is the whole of it. Reachability,
      A\* and the light wash came along for free for the same reason
- [x] Save v6, rotation in **both** `serialize.ts` and `hashWorld()`. Two of the four rotations
      cover identical cells, so a bed restored facing backwards round-trips perfectly by every
      other measure — the hash is the only thing that would notice
- [x] The v5 → v6 step widens existing bedrolls and **turns one rather than dropping it on a wall
      the player built after landing**, reading the save's own blocks grid and frozen literals
- [x] **Bedroll → 2×1**, plus a buildable **Bed** (2×1, on legs) and **Hearth** (2×2, impassable,
      does not seal, carries the campfire's recipes). Without one impassable multi-cell structure
      nothing exercises blocking across cells or a footprint correctly failing to cut a room in two
- [x] **`sprites.html`** — the filmstrip's companion, every structure at every rotation over an
      outline of the cells it claims. It found both real art bugs in the milestone within a minute
      of existing, and both were invisible at play zoom: a capsule that drew as a bow-tie for two
      of four facings, and a hearth drawn a whole storey above its own footprint
- [x] **Sleeping colonists lie down** — render-only, off the `asleep` flag that has been on the
      pawn since M3. A separate change from the footprint work, landed after it. Deliberately not
      the standing sprite rotated: nearest-neighbour sampling shreds rotated pixel art, and a
      rotated front-on figure reads as someone who has fallen over. It is a blanket with a head at
      one end, which is simpler *and* a better read, and it lies along the bed's own rotation so
      the head lands on the same end as the pillow
- [x] A sleeper **sorts with the bed**, not with their own cell. A building takes the depth of its
      footprint's nearest corner, so a colonist on the head cell of a 2×1 bed has a strictly
      smaller depth and would be covered by the very bed they are lying on
- **Playable check:** ✅ placed a bed, rotated it before committing, watched two colonists deliver
  scrap and stone and raise it — 200/100 stone/scrap went to 196/92, exactly its cost. Hearth lights
  a night camp from the middle of its four cells rather than a corner. Asserted headless in
  `tests/footprint.test.ts`; the projection's 1×1 equivalence in `tests/iso.test.ts`.

**The constant sweep, run and reported.** Third milestone running that this has caught something,
so both outstanding suspects were measured rather than assumed, over 24 seeds at 512²:

- **`BUSH_DENSITY` is cleared.** It is a probability *per grass cell* (0.045), not a count per map,
  and it measured 0.0451 — so it scaled with the world exactly as phrased. The suspicion was wrong,
  which is worth as much as a finding.
- **The landing-site search radius is confirmed, with a number.** `SEARCH_RADIUS` is 28 around the
  map centre: a 57×57 box, **1.2% of the map's area**, so the chooser cannot even see a better site.
  The consequence is measurable — nearest rock from the landing site has a median of 19 tiles and a
  **max of 73**, and a quarter of seeds put the first stone 50+ tiles from home. Fix is M14's.

See [`superpowers/specs/2026-08-10-multi-tile-footprints-design.md`](superpowers/specs/2026-08-10-multi-tile-footprints-design.md).

### M11 — Things you can point at *(items 2, 3, 1)*
- [ ] **Buildings as click targets** and a small panel for the selected structure. Pawns and benches
      already are; a wall is not, which is why deconstructing one misplaced wall means dragging a
      rectangle over it
- [ ] A red ✕ on that panel, driving the existing `Designation.Deconstruct`
- [ ] **Doors that look and act like doors** — a real sprite in the frame of the wall, a style
      submenu *before* placing, and states: leave open, closed, locked. The data model is already
      ready: `buildingSealsRoom` and `buildingBlocks` were split for exactly this
- [ ] **Drag the minimap** to scrub the camera, rather than click-to-jump only
- [ ] **A mine mark you can see.** Designations draw on the ground plane and rock is raised, so the
      mark sits at the base of the block it refers to. Deconstruction solved this for buildings by
      tinting them; mining gets the same treatment
- [ ] Dragging over empty ground no longer clears the party — correct and consistent, and far too
      easy to do by accident now the marquee makes drag-select inviting
- **Playable check:** click a wall, see what it is, press ✕, watch it come down. Lock a door and
  watch a colonist route around it.

### M12 — The architect grows up, and rooms get contents *(items 4, 9)*
- [ ] A **categorised** build menu with real sprites rendered into DOM. The current architect list is
      one undivided `BUILDABLE_DEFS`; it works at four and will not at forty, and M12 creates the
      forty
- [ ] **Furniture** — chairs, desks, tables, shelves, lamps, safes, supplies. Carpet is a surface and
      `setSurfaceAt` already handles it
- [ ] Whatever ownership and interaction furniture turns out to need — a desk you sit at is a bench
      by another name, and the M6 bill system should absorb it rather than growing a sibling
- **Playable check:** furnish a hut and it stops being a box.

### M13 — Buildings that look like buildings *(item 8)*
- [ ] Height, ornamentation, windows, awnings, roofs; brick versus wood versus scrap. A hovel should
      not be a shorter skyscraper
- [ ] **`LEVEL_HEIGHT` versus decorative relief, settled in a new ADR.** A wall already draws 22px
      against a level's 24, so the first genuinely tall building makes a one-storey hut and a real
      second floor pixel-identical while behaving nothing alike. ADR 0003 named this as a
      consequence and left it; M13 is where it comes due. ADRs here are immutable, so this is a new
      one that extends 0003 rather than an edit to it
- [ ] **Buildings enter the occlusion system.** `collectOccluders` only ever inspects
      `terrainHeight` — buildings are not in it at all, so a colonist behind a 22px wall is *already*
      partly hidden today with no fade. Taller buildings make it much worse. Needs M10's footprints
      to know which cells a structure covers
- **Playable check:** a street of buildings that read as different buildings, and a colonist walking
  behind one who does not disappear.

### M14 — A world with things in it *(item 5, the biome half of item 7)*
- [ ] Biome-specific flora and fauna, rocks, trees, flowers — biomes exist as of M7 and currently
      change only terrain, so they are the natural place to hang what grows and lives here
- [ ] Scrap and abandoned objects lying on the map; **hidden caches** in M8's places, which is the
      cheapest possible reward for exploring and gives those places something to *contain*
- [ ] The two constants still phrased as absolute counts: `findLandingSite`'s 28-tile radius and
      `BUSH_DENSITY`. Measured in M10, fixed here if measuring says so
- **Playable check:** walk 200 tiles and the ground keeps telling you where you are.

---

## Later slices

Real, but not designed in detail yet. Each gets its own design pass when we reach it.

- **Slice 4 — Threat.** Combat, body-part injury model (`hediffs`), raids, and an event director that
  paces pressure *(item 16)*. Where high-ground and cover modifiers land, since they need combat to
  modify. Arrives with a world to be threatened *across* and camps worth clearing to slow the
  pressure down. Per-pawn abilities *(item 11)* and weapon mods *(item 12)* hang off it — 12 needs
  combat to mean anything, and 11 wants pawn skills, which are still unscheduled.
- **Slice 5 — The world outside.** *Partly pulled into Slice 2.* Ruin exploration came forward as
  M8–M9. What remains, in dependency order: **other-people AI** *(item 17)* first, because pawns have
  exactly one behaviour tree and no notion of a stranger and everything else here needs one; then
  friendly and enemy bases, towns, villages *(items 10, 15)*, which arrive through M8's
  constraint-search placement as POI kinds with bigger stamps and inhabitants; then reputation and
  trading *(items 13, 14)*. Multi-level worldgen and cave dungeons — the verticality half of item 7 —
  serve this slice.
- **Slice 6 — Command.** *Partly delivered in Slice 2.* Draft, multi-select and party movement landed
  in M9, because travel was impossible without them. Formations, morale, stances and genuine tactical
  control remain — the Bannerlord layer, riding on the preemption built in M2. Note that draft as
  built lets needs interrupt a held position, which combat will have to revisit.

---

## Picking this up next

Slice 1 works and M6 gave it a production loop. It is still not a *game*: there is no pressure,
nowhere to go, and the colony's whole world is 128 tiles across.

**M7, M8 and M9 are done, and Slice 2 is closed.** The world is 512², reads as country, has named
places on it, and you can take a party to one and bring them home. That is the whole loop the slice
was reframed around.

**Next is [Slice 3 — The Built World](#slice-3--the-built-world-the-colony-gets-an-inside)**, not the
crafting ladder. That was the seventeen-item detail pass in [`BACKLOG.md`](BACKLOG.md); it is now
five milestones in a committed order, and the backlog keeps only what is genuinely unscheduled.

**Start at M10 — footprints**, because a desk is not one tile and items 8 and 9 are both gated on it.
Everything currently assumes one building occupies exactly one cell: placement legality,
`buildingBlocks` and `buildingSealsRoom`, which cell a pawn reserves and walks to, room flood-fill,
save shape, and deconstruct. The 2×1 bedroll is the natural first case — it already exists and is
already wrong. **Slice 4 — Threat** follows the slice, with a world to be dangerous across and camps
worth clearing; the `hediff` array is already there waiting.

**What M9 taught, and it is now three for three:** every milestone since the map grew has been
undone by a constant tuned to the *old* map size, and every one of them passed a green suite.
Worldgen wavelengths in M7. A\*'s node budget in M9 — a flat 20,000 cells, more than a 128² map
contains, so it had never once bound. The landing-site search radius (28 tiles) and `BUSH_DENSITY`
are still sitting there unexamined. Anything phrased as an absolute count rather than a fraction of
the world is a suspect until measured.

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
- **Every building is one tile, and sleeping colonists stand up.** *Both scheduled in M10.*
  The two halves are very different sizes and stay separate changes: the lying-down pose is
  render-only (an asleep pawn drawn flattened onto the bed, off the `asleep` flag the
  snapshot already carries), while **multi-tile footprints are a system**.
- **The best landing sites are the furthest from stone, and M7 made it worse.**
  `findLandingSite` maximises open, *storable* ground, and rock is neither passable nor
  storable — so the chooser actively walks away from it. With biome-scale regions the
  party can now land well inside a grassland with the nearest rock, and sometimes the
  nearest *anything else*, a long walk away. The search radius is still 28 tiles around
  the map centre, which was a meaningful fraction of a 128² map and is now 5% of one.
  **Measured in M10** — 2×1 bedrolls need more room at the landing site than 1×1 ones did,
  so it is in that milestone's blast radius — and fixed in M14 if measuring says so.
- **Save size is now the constraint on world size**, where reachability used to be.
  475 KB at 512² against 1.9 MB at 1024², which starts crowding a multi-slot
  `localStorage` budget. Worth knowing before anyone raises `DEFAULT_MAP_SIZE` again.
- **A mine mark on rock is nearly invisible.** *Scheduled in M11.* Designations draw on the
  ground plane, and rock is raised, so the mark sits at the base of the block it refers to.
  Deconstruction hit the same wall and solved it for *buildings* by tinting them; mining has
  no equivalent yet, and the honest fix is probably the same one.
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
| A compound stamped inside a ruin field | The named place was invisible against its own scenery |
| A\* node budget from the 128² map | A drafted colonist stood in a meadow for five in-game hours |

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
- **`docs/BACKLOG.md`** — everything wanted and not scheduled, grouped and annotated with what the
  code already has to say about it. Read before proposing a new milestone; it is probably in there.

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
