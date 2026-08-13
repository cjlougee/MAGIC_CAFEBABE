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
- [x] **Buildings are click targets**, and a `StructurePanel` describes the selected one.
      `selectedBenchId` became `selectedStructureId`; a bench now gets two panels stacked in the
      rail, because "what is this" and "what should it make" are different questions
- [x] A red ✕ on that panel, going through the **ordinary designate command** over a one-cell area
      rather than a private path — so it cannot mean anything different from the tool, and it
      already spreads across a footprint and already refuses what the colony did not build. Marked
      structures say so: the button becomes *"Marked — cancel"*
- [x] **Doors that look and act like doors** — two jambs continuing the wall, a threshold across the
      gap, and ground visible between them. `orientToNeighbours` faces a door along the run it
      interrupts, which is not a convenience: a door is one cell, so no Rotate button is offered
      and there is otherwise *no way* for the player to say which way it runs
- [x] **Barring a door** flips `buildingBlocks` and leaves `buildingSealsRoom` alone — the clearest
      use yet of the pair M4 kept separate. A locked hut is still indoors. Save v7
- [x] **"X is cut off from the colony"**, because locking is the first thing that lets the player
      seal a colonist in *on purpose*. `escapeIfTrapped` only catches a pawn on an impassable cell;
      someone shut inside a room is standing somewhere perfectly walkable in a district of their
      own, and `canReach` answers "no" correctly to everything while they quietly starve
- [x] **Drag the minimap** to scrub the camera, with pointer capture so it survives leaving the
      canvas. On a 512-tile map, jumping in discrete hops meant losing your bearings between each
- [x] **A mine mark you can see.** Raised rock is tinted, exactly as deconstruction tints a
      building, and mixed with the terrain tint field rather than replacing it — that field is what
      stops large areas reading as flat colour, so overwriting it would trade one invisible thing
      for another
- [x] An empty marquee **no longer clears the party**. Consistent with clicking bare ground, and
      wrong in practice: once the marquee made drag-select inviting, a drag that missed by a tile
      threw away a party built up over several clicks, with no undo
- [x] **The build tool shows what it is about to do**, on hover rather than only mid-drag: the
      footprint cells, and a translucent **ghost of the sprite** tinted red when the placement would
      be refused. The outline alone can say *where* but never *which way* — rotations 0 and 2 cover
      the same cells, so half of every turn would look like it did nothing
- [x] **Q and E turn it**, and the Rotate button is gone — the ghost already shows the facing, so a
      button was a second way to do what the keys do better, with the hand off the map — as was the
      facing readout that briefly replaced it. **The build menu holds buildable things and nothing
      else**, which matters more the moment M13 gives it categories and forty entries. Q means
      "select tool" everywhere else; that is inside ADR 0005 rather than in breach of it, because
      the rule is about state the player *cannot see* and the active tool is the most visible state
      there is. The hint bar swaps to say so
- [x] Rotation is offered for anything **`orientable`**, which is not the same question as "more
      than one cell": a door is one cell in every rotation and still has to face its wall run, and a
      2×2 hearth is four cells and looks identical from every side. This is also the answer to a
      door placed *before* its wall — auto-orientation is a starting guess, not a rule
- [x] **A selected structure is tinted**, since a ring on the ground would sit under the very thing
      it points at — the same problem, and the same answer, as a demolition mark in M4
- **Playable check:** ✅ click a wall, see what it is, press ✕, watch it tint and a colonist take it
  down. Doors placed into runs on both axes each faced their own run. Locked one and watched the bar
  appear; colonists path around it and the room stays indoors. Held a bed over the map, pressed E,
  watched the ghost swing onto the other axis before committing. Asserted headless in
  `tests/footprint.test.ts`.

### M12 — The asset pipeline *(process, not content)*

**Two things were wrong, with different causes, and conflating them would have got the answer wrong.**
Judging art was expensive — edit, navigate, screenshot, squint, several round trips per iteration, and
seven bugs shipped anyway. And the detail looked basic: measured, a bedroll was **five distinct
colours** across 96×48 and a wall seven across 64×54. Terrain never had that problem because it got a
texture pass in M0 that buildings never did, and the pipeline was vector-only, so occlusion and surface
were not expressible at all.

- [x] **Pixi builds a `Graphics` with no GPU, canvas or DOM.** `context.instructions` is the
      painter-ordered draw list and every shape answers `contains` / `strokeContains`, so a 25-line
      rasterizer measures the whole sprite set headless — six buildings in 7 ms. The milestone rests
      on that fact, so it was checked before anything was designed on top of it
- [x] **Geometry assertions in vitest** — `tests/art.test.ts`, 240 of them, each named after a bug that
      shipped: self-intersecting polygons (the bow-tie capsule), ink outside the footprint diamonds
      (the hearth a storey up), aspect bounds (the six-times-too-long pose), ink detached from what it
      rests on (the head off the blanket, twice), marks under a visible-ink floor (the lock bar's two
      pixels), and the facing end being the end `headCellOf` names
- [x] **Two contract levels**, because the bugs split cleanly along them. *Sprite* contracts measure
      ink against its own frame; *placement* contracts measure the sprite against the world cells it
      claims. The hearth and the sleeping pose were both placement, and no sprite-level check would
      ever have caught either
- [x] Exceptions are **declared with a reason and an exact count**, never tolerated. The bed's far leg
      is meant to be invisible; the door's jambs are meant to overhang, by a measured 13%, because a
      door continues the wall run it interrupts. Exact equality makes each a ratchet in both directions
      — a leg that *reappears* fails as loudly as a bar that vanishes
- [x] **`npm run art`** — 49 sprites to `art/contact-sheet.png` in ~180 ms, at 3×, over an outline of
      the cells each claims, plus per-sprite PNGs and a JSON report. One command and one image, with no
      dev server, no browser and no screenshot. `vite-node` plus a 60-line PNG encoder over
      `node:zlib`; **no new dependencies**
- [x] **The design language stated as numbers** — `src/render/art/language.ts`. Sun direction, tone
      ramp, occlusion depth and reach, bevel width, minimum feature size, heights **as fractions of
      `LEVEL_HEIGHT`** so Slice 4 does not invalidate every proportion, and a material table whose
      tiers are the crafting ladder made visible. `art-pass` points at the file instead of describing it
- [x] **A solid model layer** — sprites as boxes in tile space with materials, rendered with surface
      texture, contact occlusion and a one-pixel bevel. **Rotation and footprint containment become
      correct by construction**: turning a model turns its coordinates, and a solid inside the
      footprint's tile range cannot project outside its diamonds. Two of the seven bugs stop being
      *expressible*
- [x] **The rasterizer ships** — modelled structures upload the exact buffer the tests measured, not a
      GPU re-render of the same instructions that could differ at the edges and pass anyway.
      [ADR 0010](decisions/0010-procedural-art.md)
- [x] **Bedroll and Bed converted**, with the old drawings kept on the sheet as `— before` rows until
      M13 signs the models off. Measured, same ink area: **bed 10 tones → 55, bedroll 5 → 38**
- [x] **A sleeping colonist lies on the middle of their bed** — and *on* it. Two corrections, in
      `render/placement.ts`: centred on the footprint rather than the pawn's own cell (a pawn sleeps at
      `headCellOf`, one end of a 2×1), and lifted by the structure's rise onto its surface. Render-only;
      the pawn does not move, because `spot` is saved and hashed. *Discharged from M13, where it was
      listed*
- [x] **The sleeper is drawn on the bed on the contact sheet**, composed at the offsets the layer
      really uses. Both halves were reviewable alone and both looked fine — the bug lived in the
      relationship between them, and they were never on the same page
- [x] **Both call sites share one function.** They did not at first, and that is how the *second*
      correction got missed: the layer placed the sleeper on the ground plane while the sheet derived
      the offset from the sprite frame, whose top already carries `-rise`. Same intent, expressed
      twice, differing by exactly a bed's 11px — so the review surface drew a colonist lying neatly on
      a bed while the game drew one on the floor underneath it, head off the end. A bedroll's 3px made
      the same error nearly invisible, which is why it read as *"beds are broken, bedrolls are fine"*
- [x] `sprites.html` rebuilt on the shared manifest, so one edit reaches the tests, the bake and the
      page together
- [x] **The harness was shown red before being trusted.** Four historic bugs reintroduced on purpose;
      each failed a named assertion with a number in it
- **Playable check:** *there isn't one, and that is the point.*

**What it found on its own, in its first hour:**

- **The pawn head's sunward crescent is drawn and then covered outright by hair** — a larger ellipse at
  the same centre, drawn after it. Zero visible pixels on three of the five hair styles, under 16 on
  the other two. The shape language's own worked example, invisible on the most-looked-at sprite in the
  game. **Scheduled in M13**, and recorded in the pawn's contract so it cannot get worse quietly.
- The bed's comment said "the two at the back" are hidden. Measured: one whole leg and most of another
  — and once leg tops were correctly suppressed, exactly one. Close, and never checked.
- Three hex literals in `buildingArt.ts` sitting outside the palette.

See [`superpowers/specs/2026-08-11-asset-pipeline-design.md`](superpowers/specs/2026-08-11-asset-pipeline-design.md)
and [ADR 0010](decisions/0010-procedural-art.md).

### M13 — The architect grows up, and rooms get contents *(items 4, 9)*
- [ ] A **categorised** build menu with real sprites rendered into DOM. The current architect list is
      one undivided `BUILDABLE_DEFS`; it works at four and will not at forty, and M13 creates the
      forty
- [ ] **Furniture** — chairs, desks, tables, shelves, lamps, safes, supplies. Carpet is a surface and
      `setSurfaceAt` already handles it
- [ ] Whatever ownership and interaction furniture turns out to need — a desk you sit at is a bench
      by another name, and the M6 bill system should absorb it rather than growing a sibling
- [x] ~~**The sleeping pose centred on the bed**~~ — *done in M12*, which is where the harness needed a
      real defect to go green on. A harness that is green on arrival validates nothing
- [ ] **The pawn head's crescent, buried under hair** — found by M12's harness: zero visible pixels on
      three of five styles. A genuine one-liner, and worth doing early because colonists are the
      most-looked-at sprite in the game
- **Playable check:** furnish a hut and it stops being a box.

### M14 — Buildings that look like buildings *(item 8, minus the storeys)*

*Split from what was one milestone.* Roughly 70% of "buildings that look like buildings" has nothing
to do with levels — materials, ornament, silhouette — and exactly one part collides with
`LEVEL_HEIGHT`: being genuinely taller than one storey. Building tall in a one-level world and then
converting it when levels land is building it twice, which is the rework the verticality decision
exists to refuse. So the tall half moves to Slice 4 and everything else ships here, on schedule.

- [ ] Materials and ornament: brick versus wood versus scrap, windows, awnings, trim, doorframes.
      A hovel should not be a shorter skyscraper — and until levels land it is not a *shorter*
      anything, it is a differently-built one
- [ ] Silhouette variety within the one-storey budget. Decorative relief stays below `LEVEL_HEIGHT`
      **for now, as a consequence rather than a rule** — nothing is capped by decree, there is simply
      nothing yet for a second storey to be
- [ ] **Buildings enter the occlusion system.** `collectOccluders` only ever inspects
      `terrainHeight`, so buildings are not in it at all and a colonist behind a 22px wall is
      *already* partly hidden today with no fade. That is a live bug independent of levels, it gets
      much worse with them, and it needs M10's footprints to know which cells a structure covers
- **Playable check:** a street of buildings that read as different buildings, and a colonist walking
  behind one who does not disappear.

### M15 — A world with things in it *(item 5, the biome half of item 7)*
- [ ] Biome-specific flora and fauna, rocks, trees, flowers — biomes exist as of M7 and currently
      change only terrain, so they are the natural place to hang what grows and lives here
- [ ] Scrap and abandoned objects lying on the map; **hidden caches** in M8's places, which is the
      cheapest possible reward for exploring and gives those places something to *contain*
- [ ] `findLandingSite`'s 28-tile search radius. **Measured in M10 and confirmed**: it is 1.2% of a
      512² map, and the nearest rock from home runs to a median of 19 tiles and a max of 73.
      `BUSH_DENSITY` was measured too and is *cleared* — it is a probability per grass cell and
      scaled exactly as phrased
- **Playable check:** walk 200 tiles and the ground keeps telling you where you are.


---

## Slice 4 — Verticality ("there is an upstairs, and a downstairs")

**Reserved since ADR 0003, and now scheduled rather than deferred again.** The data model has taken a
`z` since before the first pawn existed; nothing has ever generated or drawn a second level.

The trigger was M14. A wall already draws 22px against a level's 24, so the first genuinely tall
building makes a one-storey hut and a real second floor pixel-identical while behaving nothing alike.
The cheap answer was to cap decorative relief below `LEVEL_HEIGHT` and write it into a new ADR —
**rejected as a half measure.** Capping buys a milestone and costs the rework anyway, and three later
slices are already waiting on levels: multi-storey buildings here, high-ground and cover modifiers in
Threat, caves and relic-tech dungeons in The world outside. Build it once, properly.

Not designed in detail yet; it gets its own pass when we reach it. What it has to cover:

- **Worldgen picking a surface level per column**, so terrain has relief that is *structural* rather
  than decorative
- **Vertical connectivity in pathfinding** — ramps and stairs, sharing `canStep()` with reachability
  exactly as the flat case does, or A\* and reachability disagree and pawns re-plan forever
- **Cross-section rendering**: the draw loop becomes `for z { for y { for x } }`, plus a cut plane
  that hides roofs, walls and levels above it. This is a draw-loop filter, not a data-model change
- **Multi-storey buildings**, carried over from M14 — the half of "buildings that look like
  buildings" that genuinely needs a level to stand on
- **Reconciling decorative terrain relief with `LEVEL_HEIGHT`**, which is the specific thing ADR 0003
  left open and the reason this slice is here rather than later
- **Caves and what is under the ground**, which is what makes a downstairs worth having
- **Playable check:** build a second storey and stand a colonist on it; walk down into a cave and
  back out.

See [ADR 0003](decisions/0003-verticality.md) for the model — discrete z-levels, not a height field —
and for the reasoning that has held since M0.

---

## Later slices

Real, but not designed in detail yet. Each gets its own design pass when we reach it.

- **Slice 5 — Threat.** Combat, body-part injury model (`hediffs`), raids, and an event director that
  paces pressure *(item 16)*. High-ground and cover modifiers land here, and they arrive with a world
  that genuinely has high ground in it. Per-pawn abilities *(item 11)* and weapon mods *(item 12)*
  hang off it — 12 needs combat to mean anything, and 11 wants pawn skills, which are still
  unscheduled.
- **Slice 6 — The world outside.** *Partly pulled into Slice 2.* Ruin exploration came forward as
  M8–M9. What remains, in dependency order: **other-people AI** *(item 17)* first, because pawns have
  exactly one behaviour tree and no notion of a stranger and everything else here needs one; then
  friendly and enemy bases, towns, villages *(items 10, 15)*, which arrive through M8's
  constraint-search placement as POI kinds with bigger stamps and inhabitants; then reputation and
  trading *(items 13, 14)*. Relic-tech dungeons ride on Slice 4's caves.
- **Slice 7 — Command.** *Partly delivered in Slice 2.* Draft, multi-select and party movement landed
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
crafting ladder. That was the seventeen-item detail pass in [`BACKLOG.md`](BACKLOG.md); it is now six
milestones in a committed order, and the backlog keeps only what is genuinely unscheduled.

**M10 is done.** Buildings can be bigger than a cell, colonists lie down to sleep, and the two
constants the last three milestones warned about have been measured rather than assumed.

**M11 is done** — walls are click targets with a panel and a ✕, doors read as doors and can be
barred, mine marks are visible, and the minimap scrubs.

**M12 is done, and it was deliberately not content.** Judging a sprite is now `npm run art` and one
image on disk — 49 sprites in ~180 ms, no dev server, no browser, no screenshot — with 240 headless
assertions holding the geometry, each named after a bug that shipped. The generation half gained a
solid model layer with materials, contact occlusion and a bevel; measured, the bed went from 10 tones
to 55 and the bedroll from 5 to 38, which is what "the detail looks basic" actually *was*.

**Next is M13**, and it is the first real test of whether the pipeline paid: forty sprites, and the
question is whether each costs visibly less than M10's did.

**Slice 4 is verticality**, scheduled at last rather than deferred a fifth time. See the section
below for what finally triggered it and why capping decorative height was refused.

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
- ~~**A sleeping colonist lies on half their bed.**~~ *Fixed in M12.* `ObjectLayer` positions the
  pose at the **footprint's centre** rather than the pawn's own cell, exactly as `LightingLayer`
  does for a hearth's glow. The pawn was not moved: `spot` is a job field, saved and hashed, so
  moving a colonist to make a picture line up would trade a render bug for a determinism one.
  The contact sheet now draws the sleeper *on* the bed, because both halves were reviewable
  alone and both looked fine — the bug lived in the relationship between them.
- **The best landing sites are the furthest from stone, and M7 made it worse.**
  `findLandingSite` maximises open, *storable* ground, and rock is neither passable nor
  storable — so the chooser actively walks away from it. With biome-scale regions the
  party can now land well inside a grassland with the nearest rock, and sometimes the
  nearest *anything else*, a long walk away. The search radius is still 28 tiles around
  the map centre, which was a meaningful fraction of a 128² map and is now 5% of one.
  **Measured in M10** — 2×1 bedrolls need more room at the landing site than 1×1 ones did,
  so it is in that milestone's blast radius. Confirmed: 1.2% of the map's area, and the nearest
  rock from home runs to a median of 19 tiles and a max of 73 across 24 seeds. Fixed in M15.
- **Save size is now the constraint on world size**, where reachability used to be.
  475 KB at 512² against 1.9 MB at 1024², which starts crowding a multi-slot
  `localStorage` budget. Worth knowing before anyone raises `DEFAULT_MAP_SIZE` again.
- ~~**A mine mark on rock is nearly invisible.**~~ *Fixed in M11* — raised rock is tinted,
  the same answer deconstruction reached for buildings a milestone earlier.
- **`lookup.ts` scans linearly** over buildings and sites, and the work givers scan every item
  once per pawn per think tick. Fine at dozens, not at thousands — when it matters, put the index
  *inside* the store so it cannot desync. **Measured out of M7 rather than assumed out:** a
  five-colonist colony ticks in 29 µs at 512², against a 16,667 µs frame budget. It grows with item
  count, not with map size, so the bigger world did not move it.
- **No save thumbnails or autosave.** Saving is manual and the list shows text only.
- **Verticality is reserved, not built.** *Now scheduled as Slice 4* rather than deferred again.
  See ADR 0003; the data model takes a `z` today.
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
- **`docs/decisions/`** — nine ADRs covering the stack, the projection, verticality, water,
  controls, deconstruction, the shape of the world, how places differ from texture, and
  multi-tile footprints.
- **`npm run art`** — the whole sprite set to `art/contact-sheet.png` in one command, with the
  geometry checked on the way. Reach for it before a dev server. `sprites.html` is the same
  manifest live, for reload-as-you-edit and the night wash; `filmstrip.html` is for animation.
  Judging a sprite at play zoom is how every art bug in this project survived.
- **`docs/BACKLOG.md`** — everything wanted and not scheduled, grouped and annotated with what the
  code already has to say about it. Read before proposing a new milestone; it is probably in there.

## Verticality — reserved, and now scheduled

The data model supports stacked z-levels; nothing generates or renders a second one yet. See ADR
[0003](decisions/0003-verticality.md) for why this split, and for the height-field model that was
rejected.

**The deferred half is [Slice 4](#slice-4--verticality-there-is-an-upstairs-and-a-downstairs).** It
was deferred four times, each time to "the slice where it has something to serve", and the trigger
that finally landed it was M14 wanting buildings taller than one block: a wall already draws 22px
against a level's 24, so a one-storey hut and a real second floor would be pixel-identical while
behaving nothing alike. Capping decorative relief below `LEVEL_HEIGHT` was the cheap answer and was
**rejected as a half measure** — it buys one milestone and pays the rework anyway, and three slices
are already waiting on levels.

**Already reserved** (costs one unused field per position, and one multiply-by-zero per index):
- [x] `TilePos {x, y, z}` defined before the first pawn exists — the retrofit that would actually
      have been expensive
- [x] `TileMap.levels` with level-major indexing, exercised by tests on a real 3-level map
- [x] Level-aware `tileToWorld` / `worldToTile`; `hashWorld` covers `levels`

**Deliberately deferred**, each to the slice where it has something to serve:
- [ ] Vertical connectivity — ramps/stairs in pathfinding *(Slice 4)*
- [ ] Cross-section rendering: hide roofs, walls, levels above the cut plane *(Slice 4 — a
      draw-loop filter, not a data-model change)*
- [ ] High-ground damage bonus, cover and trench defence bonuses *(Slice 5 — Threat)*
- [ ] Multi-level worldgen and caves *(Slice 4)*; relic-tech dungeons ride on them *(Slice 6)*
- [ ] Reconcile decorative terrain relief with `LEVEL_HEIGHT` — currently a raised rock tile and a
      genuine level above would look identical while behaving completely differently *(Slice 4, and
      the specific thing that scheduled it)*
