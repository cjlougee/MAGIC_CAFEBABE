# MAGIC_CAFEBABE

A colony simulation with RimWorld's systemic depth, Kenshi's scavenger-frontier feel, Space Haven's
colorful look, and Bannerlord-style direct squad command.

**Setting:** a fallen-tech frontier. You colonize a world littered with the wreckage of a collapsed
high-tech civilization. The crafting ladder is **scrap → refined → salvaged relic-tech**, and the top
tier can only be found in ruins — which is what gives exploration, crafting, and faction motives a
shared spine.

**Control model:** hybrid. Pawns self-organize off a work-priority grid for day-to-day labour; the
player takes *direct* control for combat and expeditions.

---

## The three enforcement rules

These are not style preferences. Each is cheap to hold now and brutally expensive to retrofit, and
each is backed by an automated gate. **Do not weaken them to make a feature easier.**

### 1. `src/sim/` is pure — it imports nothing from `render/`, `ui/`, `app/`, Pixi, React, or the DOM

The simulation is plain TypeScript that runs headless. This is what buys us the headless test harness
(fast-forward seven in-game days in a unit test), deterministic save/load, and reproducible bug
reports.

*Gate:* `tests/architecture.test.ts` scans every file under `src/sim/` for forbidden imports.
ESLint's `src/sim/**` override gives the same feedback faster.

### 2. No `Math.random()` anywhere in `src/sim/`

One seeded RNG instance lives in world state and is serialized with the save. Every random decision
draws from it. A world built from seed *S* and ticked *N* times must produce a byte-identical result
every time, on every machine.

*Gate:* `tests/architecture.test.ts` (scan) and `tests/determinism.test.ts` (behavioural).

### 3. The job scheduler supports hard preemption

`interrupt(pawn, reason)` cleanly ends the current job, releases its reservations, drops anything
carried, and hands the pawn back to the AI. Combat lands in Slice 3 and squad command in Slice 5,
but both depend on this existing in the core.

**Work is a pool, not an assignment**, and that is what makes this rule load-bearing *today* rather
than in Slice 3. Any pawn allowed to do a job can join it, leave the moment something outranks it,
and rejoin later with no memory of having been pulled away — two colonists stocking one workbench
is the ordinary case, not a race. Being pulled off work is normal, not an error path, so a job must
come apart cleanly at *any* point. See `docs/design/07-production.md`.

**`endJob()` is the single exit.** Completion, failure, and preemption all route through it, so
cleanup cannot be remembered on one path and forgotten on another. Never release a reservation
anywhere else.

*Gate:* preemption and reservation-leak tests in `tests/jobs.test.ts`.

---

## Commands

```bash
npm run dev        # Vite dev server on :5173
npm run check      # typecheck + lint + test — run this before calling anything done
npm run test       # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # typecheck + production build
```

Claude: prefer the `run` skill or `preview_start` (`.claude/launch.json` defines the `game` config) to
launch the dev server, then verify visually with the browser tools. **Look at the running game — test
output alone is not verification for a rendering change.**

### The debug panel — press `` ` ``

**Use it. It exists so that looking at the game is cheap.** Dev builds only (`import.meta.env.DEV`),
so it ships nowhere.

- **Skip to** Dawn / Noon / Dusk / Night — moves the clock forward without simulating. For seeing
  something *at* a time of day.
- **Simulate** +1h / +6h — actually runs those ticks, so colonists eat, build, and finish jobs. For
  seeing what a colony *does*.
- **Give** stone, scrap, raw food, meals — dropped at the landing site.
- **Place finished** — the Build tool raises completed structures instead of blueprints, free and
  instantly. **Finish queued** completes every blueprint already placed.

Without it, checking a campfire at night meant mining rock, waiting for a wall to be hauled and
built, and then waiting out an in-game day. That is not testing the change in front of you.

Instant placement still refuses a blocking structure on an occupied cell — skipping the wait must
not mean skipping the check, because a pawn sealed into an impassable cell is the worst state in
the simulation.

---

## Layout

```
src/
  sim/          pure TS — the game. Deterministic, headless, fully unit-testable.
    core/       tick, seeded RNG, entity store, command queue, constants
    world/      tile grids, terrain, worldgen, rooms, time-of-day
    pathfind/   A*, reachability
    ai/         work givers, jobs, job drivers, toils, reservations, needs, mood
    entities/   pawn, item, building
    defs/       content as typed TS objects
    save/       serialize / deserialize / migrate / hash
  render/       PixiJS. Reads sim state; NEVER mutates it.
    iso.ts      THE isometric projection — tile space <-> world pixels. One definition.
    occlusion.ts  which raised tiles fade because a pawn is behind them
    art/        palette, shape language, procedural sprite generation
    layers/     ground (flat, unsorted), objects (raised + pawns, depth-sorted), lighting
    camera/     pan, zoom, culling
  ui/           React overlay (DOM, not Pixi)
  input/        user intent → Command objects
  app/          bootstrap, game loop, snapshot store
docs/           see docs/README.md
tests/          vitest; mirrors src/sim structure
```

**Things that must agree or pawns break in ways that look like haunting**, all currently held by
tests rather than by structure:

- `pathfind/neighbours.ts` `canStep()` is used by *both* A\* and reachability. If reachability is ever
  more optimistic, it promises routes A\* can't deliver and pawns re-plan forever.
- Appearance is indices in `sim/`, colours in `render/`. `sim/defs/pawnKind.ts` declares how many of
  each; `render/art/palette.ts` must have at least that many.
- Changing terrain must invalidate reachability, and **which call you use matters at 512²**.
  `markDirtyAt(index)` re-floods one 16×16 chunk (615µs); `markDirty()` re-floods the whole map
  (50ms) and means "I don't know what changed" — for loads and bulk edits only. Reaching for the
  blanket one in a single-cell path is a stall every time a colonist finishes a rock.
  `TileMap.revision` bumps automatically and is what keeps render caches honest — without it,
  mining leaves a hole where the rock was. See `docs/design/08-the-world.md`.
- **A pawn on an impassable cell is the worst state in the simulation.** Reachability
  reports their own position as unreachable, so `canReach` fails for *every* target and
  they idle forever with no visible cause. Never complete a structure on an occupied cell
  (`toilWork`'s `canProgress` waits rather than fails), and `escapeIfTrapped` in
  `ai/movement.ts` is the backstop.
- **Blocking, sealing, and terrain cost are three separate questions.** `walkCost` is
  terrain; `buildingBlocks` is obstruction; `buildingSealsRoom` is room edges. A door is
  walkable *and* a room edge, which is why the last two can't be one flag.
- **Need jobs outrank all work, unconditionally.** Eating and sleeping never enter the priority
  grid and can't be switched off — otherwise a colonist with Haul at priority 1 starves beside a
  stockpile. The hierarchy lives in `tickPawnAI`: break → needs → work. See ADR-free notes in
  `docs/design/04-needs-and-mood.md`.
- **Mood is never assigned, only computed** as `BASE_MOOD + sum(active thoughts)`. Any mood change
  that can't be stated as a thought doesn't belong in the system — that rule is what lets the UI
  explain a mood instead of just showing it.
- **`passable` is not `storable`.** A colonist can wade a shallow ford but must not leave goods in
  it. Anything placing items on the ground filters on `storable`; only movement uses `passable`. The
  rules live once in `sim/world/placement.ts`, consulted by both the command handlers and the drag
  preview, so the preview can never promise what the sim will refuse. See ADR 0004.
  **This one keeps coming back in disguise.** The trap is not forgetting the rule, it is applying
  it to the wrong question: `findLandingSite` scored "openness" with `isPassable`, so an open lake
  scored maximum and the party landed in the middle of it with nowhere to put their bedrolls. Any
  time you ask "how good is this ground", the answer involves `storable`, not `passable`.
- **`setTerrainAt` and `setSurfaceAt` are different questions**, and picking the wrong one corrupts
  the map slowly enough that nothing catches it. `setTerrainAt` means *the ground itself changed* —
  worldgen, or mining cutting through — and updates `naturalTerrain` too, because mined-out rock
  does not come back. `setSurfaceAt` lays something *over* the ground and leaves `naturalTerrain`
  alone, so lifting a floor gives back the sand it was laid on rather than a default we invented.
- **A migration step must never import a live definition** — no `Terrain.StoneFloor`, no
  `ITEM_DEFS.length`. Those describe the game as it is *now*; a step describes a file as it was
  *then*. Renumber a table and every step that reached for a live constant starts quietly
  misreading old saves. Freeze the literal in the step and say what it was.
- Anything added to saved state must be added to **both** `hashWorld()` and
  `save/serialize.ts`. The round-trip test compares hashes, so a field missing from both passes
  silently — the tests stay green while guarding nothing.
- **Derived state is never saved.** Pathfinder scratch, reachability, rooms, and `walkCost` are
  rebuilt on load. A stored copy could disagree with what it came from, and nothing could say
  which was right. Reservations are the exception and *are* saved — a pawn restored mid-job is
  still holding its targets.

## Skills

- **`add-work-type`** — adding a kind of colonist work (Construct, Cook, Clean…). Walks the
  `WorkGiver → Job → JobDriver → toils` pipeline and the invariants above that fail *silently*.
  Written after M2, once the pattern was real rather than predicted.
- **`art-pass`** — drawing or improving a procedural sprite. The shared shape language, the one
  light direction, and the geometry rules that break tile alignment without an error. Written
  after the M6 art pass, from the mistakes it actually made.

**Data flow is a one-way loop.** UI never mutates sim state. Input dispatches `Command` objects onto a
queue the sim drains at the start of each tick. The sim publishes a read-only `SimSnapshot` at ~10Hz
(and immediately on selection change) that React renders from — React never re-renders at 60fps.

---

## Conventions

- **Content lives in `src/sim/defs/` as typed TS objects**, not XML or JSON. We want autocomplete,
  refactorability, and compile-time errors on typos. Data-driven modding can layer on later.
- **Grids are flat typed arrays**, level-major: `z * layerSize + y * width + x`. Always index through
  `TileMap.idx(x, y, z?)`. This is where performance actually lives.
- **Positions carry a `z`, and always have.** Use `TilePos` from `src/sim/core/position.ts` — never
  a bare `{x, y}`. The map is one level deep today, so every z is `GROUND_LEVEL` and this costs one
  unused field. It exists because widening the position type *after* pawns, job targets, reservation
  keys, and save files depend on it is a rewrite, whereas adding levels to a grid is a constructor
  change. See `docs/decisions/0003-verticality.md`.
- **A gesture means one thing, never a mode-dependent thing.** Right button is always the
  camera, left button is always the active tool. Adding an input that changes meaning
  based on state the player can't see is how the first scheme became unusable. See
  `docs/decisions/0005-controls.md`.
- **Colours come from `src/render/art/palette.ts`.** Never hardcode a hex value in a layer or
  component. The palette is the art direction; keeping it in one file is what makes the game look
  coherent.
- **The view is 2:1 isometric, and `src/render/iso.ts` is its only definition.** Never write
  `(x - y) * 32` inline in a layer. Two things follow from the projection and are easy to break
  accidentally: solid tiles overlap, so `TerrainLayer` must iterate row-major (y outer, x inner) to
  stay a valid painter's order; and tile art is nearest-neighbour sampled, so textures generate with
  `antialias: false` and the world container's position is rounded to whole pixels. Undo either and
  a seam grid appears over the whole map. See `docs/decisions/0002-isometric-projection.md`.
- Prefer small, focused files with one clear purpose. When a file grows past ~300 lines, that is
  usually a signal it is doing too much.
- Tests live in `tests/` and mirror the `src/sim/` structure.

---

## Keeping docs current

`docs/` and this file are load-bearing — they are how the next session (human or Claude) gets up to
speed without re-deriving decisions. **Treat them as part of the change, not as follow-up work.**

When you finish a piece of work, update in the same commit:

- **`docs/ROADMAP.md`** — tick off the milestone item, or add what actually happened if it diverged.
- **`docs/design/`** — if you changed how a *system* works (job pipeline, needs, pathfinding), the
  design doc describing it must match the code. A design doc that lies is worse than no doc.
- **`docs/decisions/`** — if you made a call that a future reader would otherwise ask "why on earth is
  it like this?" about, write a short ADR. Cheap to write now, irreplaceable in three months.
- **This file** — if you added a command, moved a directory, changed a convention, or introduced a new
  enforcement rule.

If a doc is now wrong, fixing it is not optional cleanup — it is part of finishing the task.
