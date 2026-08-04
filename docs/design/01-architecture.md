# Architecture

How the program is put together, and the reasoning behind the parts that aren't obvious.

See [`../../CLAUDE.md`](../../CLAUDE.md) for the three enforcement rules. This document assumes them.

## Layers

```
src/
  sim/       pure TS — the game. Deterministic, headless, fully unit-testable.
  render/    PixiJS. Reads sim state; never mutates it.
  ui/        React overlay in the DOM, above the canvas.
  input/     user intent → Command objects.
  app/       bootstrap, game loop, UI store. The only place the layers meet.
```

Dependencies point one way: `app → {sim, render, ui}`, `render → sim`, `ui → app`. Nothing points
back into `sim`.

## Data flow

```
 input / UI ──dispatch(Command)──▶ CommandQueue
                                       │  drained at the start of each tick
                                       ▼
                                  Simulation.tick()  ──▶  World (mutated here, only here)
                                       │
             ┌─────────────────────────┴──────────────────────┐
             ▼                                                ▼
    buildSnapshot(world)  ──10Hz──▶ UiStore ──▶ React    GameRenderer.render(world)
```

Three properties fall out of this shape, and all three are load-bearing:

- **Mutation is ordered.** Every change enters through the queue and is applied at a known point in
  the tick. There is no "and also this thing changed halfway through".
- **UI cannot corrupt the simulation.** It holds a snapshot, not the world.
- **React doesn't run at 60fps.** Snapshots publish at 10Hz, which is imperceptible for a clock and
  roughly six times less React work.

## The tick

The simulation advances in fixed steps of 1/60s of game time. The render loop advances once per
animation frame. `GameLoop` bridges them with an accumulator:

```
accumulator += realElapsed × speed
while accumulator ≥ MS_PER_TICK and ticks < MAX_TICKS_PER_FRAME:
    sim.tick(); accumulator -= MS_PER_TICK
```

Speed is 0–3 and multiplies elapsed time, so speed control never changes the *size* of a step — only
how many run. That is what keeps a run at 3x identical to the same run at 1x.

`MAX_TICKS_PER_FRAME` exists to stop the death spiral: after a long stall (alt-tab, breakpoint, GC
pause) the accumulator holds thousands of ticks, processing them takes even longer, which queues more.
We drop the excess. Losing game time is strictly better than locking the browser.

## Determinism

The rule is enforcement rule 2, but the mechanics are worth stating:

- One `Rng` (sfc32, 128-bit state) lives in `World` and is saved with it.
- Worldgen noise is seeded separately from gameplay randomness, so terrain and events don't correlate.
- Only exactly-specified float operations are used (`+ - * /`, shifts, `Math.imul`, `Math.floor`).
  `Math.sin`, `Math.pow`, and friends have implementation-defined precision and are avoided anywhere
  the simulation branches on the result — this is why the daylight curve is piecewise linear.
- `hashWorld()` fingerprints saved state. **When you add persistent state to `World`, add it to the
  hash** — a hash that ignores a field silently stops guarding it.

## Grids

Per-cell data lives in flat typed arrays indexed `y * width + x`, not objects. At 250×250 that's 62,500
cells per field; anything allocated per cell would dominate both memory and GC. Access goes through
`TileMap.idx()` / `terrainAt()`.

`walkCost` is derived from terrain and kept in sync by `setTerrain`. Impassable is the sentinel `0`,
which lets pathfinding test passability with one array read and no branch into definitions.

## Rendering

**The projection is 2:1 dimetric isometric**, defined in exactly one place: `render/iso.ts`. Tiles are
64×32 world pixels; `+x` runs down-right, `+y` runs down-left, so screen depth is `x + y`. Everything
that converts between tile space and screen space goes through those pure functions, which is why they
can be unit-tested without a renderer (`tests/iso.test.ts`). See ADR
[0002](../decisions/0002-isometric-projection.md).

**Draw order is load-bearing.** Solid terrain has vertical extent, so sprites overlap and need a
painter's algorithm. Row-major iteration (y outer, x inner) is already a valid back-to-front order:
the only tiles whose sprites can cover `(x, y)` are `(x+1, y)` and `(x, y+1)`, and both come later in
that walk. Pixi draws children in index order and the pool fills from index 0 in iteration order, so
correctness is free — but iterating `TerrainLayer` differently would make tall terrain render through
whatever stands in front of it.

**Terrain uses a viewport-sized sprite pool**, not one sprite per cell and not pre-baked chunk render
textures. A fully baked map is tens of megabytes of VRAM and grows quadratically with map size; a
viewport pool is bounded by screen area, so it costs the same at 500×500. Sprites are reassigned only
when the visible rect actually changes.

**Culling is two-stage.** The viewport is a diamond in tile space, so its bounding box holds roughly
twice the tiles actually on screen. `Camera.visibleTiles()` returns that box as a *search* space and
`TerrainLayer` rejects the corners per-tile against `Camera.visibleWorld()` — arithmetic instead of
draw calls.

**Art is generated, not loaded.** `ArtProvider` hands out textures by key and caches them; today they
are drawn procedurally from `palette.ts`. The indirection exists so a real artist's atlas can replace
the generator later without touching a single layer or gameplay file.

**Tonal variation is a tint field, not baked into textures.** Cells pick their art variant by hash, so
baking brightness into variants makes neighbours maximally different and the ground reads as a
checkerboard. A separate low-frequency noise field drives `sprite.tint`, which varies smoothly across
space — and because it ignores terrain type, a patch of shade carries across a grass/dirt boundary and
reads as light rather than as tinted tiles.

**Lighting is a screen-space multiply sprite** tinted between white at noon and cool blue at midnight.
It sits outside the world container so it doesn't pan or scale. M1 replaces the flat wash with a
per-cell light grid so lamps and fires can cut into the dark; the interface stays the same.

**Two settings exist purely to stop isometric seams**, and both were found by looking at the running
game rather than by reasoning about it. Tile textures generate with `antialias: false`, because
half-transparent diamond edges let the background show through as an outline around every tile. And
`Camera.applyTo` rounds the world container's position to whole pixels, because nearest-neighbour
sampling turns any sub-pixel offset back into a faint seam grid.

## Testing

`sim/` being pure is what makes the interesting parts testable at all.

| Test | Guards |
|---|---|
| `architecture.test.ts` | Enforcement rules 1 and 2, by scanning source |
| `determinism.test.ts` | Same seed → same world, batched or stepped; RNG save/restore |
| `world.test.ts` | Terrain def/table alignment, grid indexing, worldgen sanity, time maths |
| `iso.test.ts` | Projection round-trip, tessellation, and the draw-order invariant |

The highest-value test in the project doesn't exist yet: the M5 headless harness that fast-forwards
seven in-game days and asserts *nobody starved, nobody slept on the floor, the stockpile is non-empty*.
Unit tests catch broken functions; that one catches a broken **game**.
