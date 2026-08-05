# Pawns and movement

How a colonist gets from one tile to another, and why the parts are split the way they are.

## The pawn

A pawn occupies exactly one tile. `pos` is discrete and authoritative — every other system (job
targets, reservations, line of sight, "who is standing here") reads it and never has to deal with
fractions. Sliding between tiles is separate state: `moveTarget`, plus a tick countdown.

```
pos ──────── the tile the pawn IS on
moveTarget ─ the adjacent tile being entered, or null
moveTicksElapsed / moveTicksTotal ─ progress into that step
path / pathIndex ─ the remaining route
```

`pawnVisualPos()` interpolates between `pos` and `moveTarget` for drawing. It lives in `sim/` because
it is derived from simulation state and must stay consistent with it, but nothing in `sim/` reads it.

Step duration is `moveCost × 1.3` ticks, so open ground (cost 10) takes 13 ticks — about 4.6 tiles per
second at 1x. Wading (cost 22) takes 28. Diagonals cost √2 more, kept in integers as `×141/100`.

**Appearance is stored as indices, not colours.** `sim/` rolls `skinTone: 2`; `render/` decides what 2
looks like. Character identity is saved state; art direction is not. `tests/pawn.test.ts` asserts the
renderer's palettes are at least as long as the counts in `sim/defs/pawnKind.ts` — otherwise a drift
would render pawns with `undefined` instead of failing.

## Pathfinding

A* over the walk-cost grid, 8-directional, no corner cutting.

**Scratch buffers live for the lifetime of the map.** A colony runs many searches per second;
allocating a few 64KB arrays per call would hand the GC a steady stream of garbage during exactly the
frames that are already busy. Buffers are never cleared either — each search bumps a generation
counter and a per-cell stamp records which search last touched a cell, so stale values are
recognisable in O(1) instead of clearing 62,500 cells per path.

**The heuristic is derived, not hardcoded.** Octile distance using the cheapest walk cost found in
`TERRAIN_DEFS`. If someone adds a faster terrain later, the heuristic stays admissible automatically
rather than silently degrading A* into something that returns non-optimal paths.

The open set is a binary heap over cell indices in an `Int32Array`. Nodes are re-pushed rather than
decrease-keyed; stale entries are skipped on pop by the closed check, which is simpler and cheaper
than maintaining heap positions.

## Reachability

A connected-components flood fill, rebuilt when passability changes.

This is the cheap half of pathfinding and the more important one. Without it, a pawn looking for work
runs a full A* against every candidate target and fails on each unreachable one — every think tick,
forever. With it, "is there any steel I can actually get to?" is an integer comparison.

**Both use `canStep()` from `pathfind/neighbours.ts`.** This is not incidental. If reachability were
ever more optimistic than A*, it would promise routes A* cannot deliver, and pawns would re-plan in a
loop. `tests/pathfind.test.ts` asserts the two agree across hundreds of sampled pairs on a generated
map.

## Orders

A right-click becomes a `moveTo` Command, drained at the start of the next tick like every other
mutation. Selection never enters the simulation — where the player is looking is not part of the
world.

**Orders plan from `moveTarget ?? pos`** — from where the pawn *will be*, not where it is. A pawn
caught mid-step is between two tiles and `pos` is the one it is leaving; routing from there would
double back or require snapping it backwards. Letting the current step finish and picking up from
there means a new order supersedes the old one without ever teleporting anyone. This is enforcement
rule 3 (hard preemption) in its simplest form; M2's job system generalises it.

Unreachable and impassable targets are rejected before a search runs.

## Rendering, and the cost of isometric

Draw layers split by whether a thing has height:

| Layer | Contents | Sorted? |
|---|---|---|
| `GroundLayer` | Flat terrain | **No** — flat diamonds tessellate exactly and never overlap |
| `ObjectLayer` | Raised terrain + pawns | Yes, by depth |

This split is the point: ground is the layer with thousands of sprites and it is the one that can skip
the sort entirely. Objects are a few hundred and get sorted together — a pawn walking behind a
bulkhead must be drawn before it and a pawn in front after it, a decision that cannot be made if they
live in separate containers.

Ground is cached and only reassigned when the visible rect changes. Objects are rebuilt every frame,
because their contents move every frame.

**Occlusion fade** is isometric's standing cost, paid back. A pawn behind a cliff is correctly drawn
behind it and therefore invisible — technically right, useless to the player. `render/occlusion.ts`
finds raised tiles whose sprite box overlaps a pawn's *and* whose depth is greater, and drops them to
32% alpha.

The depth check is what makes it look deliberate rather than broken: a tile *behind* a pawn is drawn
first and cannot hide anything, so fading it would dim the cliff a colonist is standing in front of.
Kept as pure functions over boxes so the rule is testable without a renderer — the failure modes are
symmetrical and subtle, and both are easy to miss in a screenshot.
