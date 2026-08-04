# 0002 — 2:1 isometric projection

**Status:** Accepted · 2026-08-04

## Context

M0 shipped a top-down orthogonal tile view. On review, the intended look was isometric — a decision
about the game's identity rather than its implementation, and one worth acting on immediately: every
sprite drawn after this point inherits the projection, so the cost of changing it only grows.

## Decision

Render in **2:1 dimetric projection** — tiles are 64×32 world pixels, twice as wide as tall — and give
solid terrain **vertical extent**: a top face plus two shaded side faces.

## Why 2:1 rather than true isometric

True 30° isometric needs a √3 width:height ratio, which never lands on whole pixels. 2:1 tessellates
exactly at integer coordinates, which matters because tile art is nearest-neighbour sampled: any
fractional offset shows up as a visible seam grid across the entire map. Essentially every 2D
isometric game uses 2:1 for this reason.

## Why solid terrain has height

Flat diamonds everywhere would be a *rotated top-down map* — paying all of isometric's costs for none
of its benefit. Raised faces are the entire point: they're what makes a base read as built rather than
drawn. Heights are kept modest (rock 14px, bulkheads 22px) because occlusion is the real cost.

## Consequences

**What this change touched:** only `src/render/`. Not one line of `src/sim/` moved — the simulation
works in tile coordinates and has no concept of a screen. This is enforcement rule 1 paying for itself
inside the first milestone, and it is the strongest evidence so far that the firewall is worth keeping.

**Accepted costs:**

- **Occlusion.** Tall things hide what's behind them; RimWorld and Space Haven avoid this entirely by
  being top-down. Expect to need fade-on-occlude once pawns can walk behind walls (Slice 1 M1+).
- **Coarser culling.** The viewport is a diamond in tile space, so its bounding box contains roughly
  twice the tiles actually visible. `TerrainLayer` rejects the corners with a cheap per-tile test,
  so the extra cost is arithmetic rather than draw calls.
- **More art per asset.** Every solid object needs a top and two side faces, and directional pawn
  facing will multiply sprite variants later.
- **Draw order is now load-bearing.** Overlapping sprites require a painter's algorithm. Row-major
  iteration happens to be a valid back-to-front order (the only tiles that can cover `(x, y)` are
  `(x+1, y)` and `(x, y+1)`, both later in the walk), so this is free — but it is now a constraint on
  how `TerrainLayer` may iterate, and it is asserted in `tests/iso.test.ts`.

**Two rendering settings became mandatory**, both found by looking at the running game rather than by
reasoning:

- Tile textures generate with `antialias: false`. Antialiased diamond edges are half-transparent, so
  where two tiles abut both contribute partial alpha and the dark background shows through as an
  outline around every single tile.
- The world container's position is rounded to whole pixels. Sub-pixel placement reintroduces the same
  seam grid more faintly. Costs sub-pixel pan smoothness; worth it.
