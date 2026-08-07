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
- [~] **Cooking moved to Slice 2.** Cooking is production, and production is Slice 2 with the
      bill system; a one-off campfire recipe here would be rewritten immediately. Raw food
      carries a mood penalty instead, which motivates cooking rather than pre-empting it.
- [~] **Light grid follows cooking to Slice 2.** It was deferred here because campfires would be
      the first light source. No campfires, so still nothing to light.
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
- **Playable check:** ✅ order a hut; colonists deliver stone, raise the walls, hang the
  door, and the inside registers as a room — asserted headless in `tests/construction.test.ts`.

See [`design/05-construction-and-rooms.md`](design/05-construction-and-rooms.md).

### M5 — Save/load & the survival test
- [x] Serialization to plain JSON, RLE-compressed terrain (~20KB per colony)
- [x] Version field and a migration chain that upgrades one step at a time
- [x] `localStorage` slot, owned by `app/` because `sim/` must stay headless
- [x] Pause menu: resume / save / load / start over, on `Esc`
- [x] Headless **survive-a-week** regression test
- [x] Save mid-week, reload, finish the week — bit-identical to an uninterrupted run
- **Playable check:** ✅ save, play on, load, and the colony is exactly as you left it.

See [`design/06-save-and-load.md`](design/06-save-and-load.md).

---

## Slice 1 is complete

A colony that generates, works, feeds itself, builds, and persists. 328 tests; the
simulation runs seven in-game days in about a second, headless.

---

## Later slices

Real, but not designed in detail yet. Each gets its own design pass when we reach it.

- **Slice 2 — Production.** Workbenches and bills, recipe chains, quality tiers, power grid.
  Delivers the *scrap → refined → relic-tech* ladder. Also picks up **cooking** (the first real
  bill) and the **per-cell light grid** (campfires being the first light source), both deferred
  from M3 for want of the systems they depend on.
- **Slice 3 — Threat.** Combat, body-part injury model (`hediffs`), raids, an event director that
  paces pressure. Where high-ground and cover modifiers land, since they need combat to modify.
- **Slice 4 — The world outside.** World map, caravans, exploration of ruins, factions, trade.
  Where multi-level worldgen and cave dungeons land, since they serve exploration.
- **Slice 5 — Command.** Squad selection, formations, orders, morale — the Bannerlord layer, riding
  on the preemption support built in M2.

---

## Picking this up next

Slice 1 works. It is not yet a *game* — there is no pressure, no reason to build beyond a
mood bonus, and nothing to spend materials on. Ranked by what unlocks the most:

### Next, in order

1. **Deconstruction.** The only obvious hole in M4. `Erase` cancels blueprints but cannot
   remove a finished wall, so a misplaced building is permanent. Small: a designation, a
   giver under Construct, and a driver that refunds half the cost.
2. **Slice 2 — production.** The largest unlock. Workbenches with **bills** ("cook until
   10 meals"), which is the system cooking was deferred for, plus the *scrap → refined →
   relic-tech* ladder that gives mining a point beyond walls. Brings the per-cell light
   grid with campfires.
3. **Slice 3 — threat.** Raids give walls a reason to exist and the event director gives
   the colony a shape over time. The `hediff` array on pawns is already there waiting.

### Known gaps, honestly

- **No deconstruction** (above).
- **No roofs.** "Indoors" means enclosed-by-something-built. Fine now; temperature or
  weather would need real roofs.
- **`lookup.ts` scans linearly** over buildings and sites. Fine at dozens, not at
  thousands — when it matters, put the index *inside* the store so it cannot desync.
- **One save slot.** Multiple slots are a UI change, not a technical one.
- **Verticality is reserved, not built.** See ADR 0003; the data model takes a `z` today.
- **No sound, no main-menu-before-game, no settings.**

### The three bugs that were invisible to tests

Every real defect in this project passed a green suite and was obvious within a minute of
watching the game. Budget for looking at it.

| Bug | Symptom |
|---|---|
| Cached ground layer | Mined rock left black holes in the map |
| Colonists eating one berry per trip | "Eats when hungry" was *technically* true |
| Deliverers entombed in walls | Seven of sixteen walls silently never built |

### Where the load-bearing knowledge lives

- **`CLAUDE.md`** — the three enforcement rules and the invariants that fail silently.
  Read first.
- **`.claude/skills/add-work-type`** — the checklist for a new kind of colonist work.
  Written after M2 from real code, extended by M3 and M4.
- **`docs/decisions/`** — five ADRs covering the stack, the projection, verticality,
  water, and controls.

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
