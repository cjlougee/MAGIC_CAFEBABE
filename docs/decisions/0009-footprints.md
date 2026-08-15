# 0009 — Multi-tile footprints: an anchor, a rotation, and cells derived from neither

**Status:** Accepted · 2026-08-10

## Context

Every building occupied exactly one cell, and eight systems had that baked in: placement legality,
`buildingBlocks`, `buildingSealsRoom`, which cell a pawn reserves, which cell a pawn walks to, room
flood-fill, the save shape, and deconstruct. A desk is not one tile and neither is a bed, so
"buildings that look like buildings" and "things that go in buildings" were both blocked behind this.

The question was not *whether* — it was what a placed structure stores, and what it works out.

## Decision

A structure stores **an anchor and a rotation**. Everything else is derived.

```ts
BuildingDef.footprint: { w, h }   // content: the shape, unrotated, w along +x
Building.pos: TilePos             // the anchor — min x and y of the ROTATED footprint
Building.rotation: 0 | 1 | 2 | 3  // quarter turns clockwise, saved and hashed
```

`sim/world/footprint.ts` is the only place that turns those three into a set of cells.

### Why an anchor rather than a centre

RimWorld stores a centre. A centre falls between cells for any even dimension, so it is either a
half-coordinate or a lie, and every consumer has to know the convention to recover the cells. The
minimum corner is a real cell, the rectangle extends right and down from it, and the arithmetic is
`x >= ax && x < ax + w`. The cell the player clicks becomes the anchor, which also makes the drag
preview's job obvious.

### Why cells are derived and never stored

The same rule the rest of the save obeys: derived state is never saved, because a stored copy can
disagree with what it came from and nothing can say which was right. Renumber the building table or
change the rotation convention, and a save carrying baked cell lists would be quietly wrong in a way
no test would catch — the cells would still *be* cells.

### Why four rotations when two would cover the cells

Rotations 0 and 2 occupy identical cells; so do 1 and 3. Keeping all four costs one integer and buys
**facing**, which is the difference between a bed you sleep at the head of and a bed you sleep in
the middle of. `headCellOf` is the only thing that can tell 0 from 2, and without it "rotate the bed"
would be a control that visibly does nothing.

### The cursor holds a structure by its facing cell

*Added in M13, from playing it.* The consequence of the paragraph above is that turning a 2×1 moved
its far end east, south, east, south — because the anchor is the minimum corner, so half of every
turn left the cells where they were and only mirrored the sprite. Each step is correct and the
control still feels broken: a player turning something expects it to keep going the same way round.

So the cell under the cursor is the **facing** cell, and the anchor is derived from it — `anchorFor`,
the exact inverse of `headCellOf`. The far end then goes east, south, west, north, and the thing the
player is pointing at stays put while the rest swings around it.

This is deliberately a fact about *where the pointer is* and not about the entity. The stored anchor
is still the minimum corner, `cellsOf` still extends right and down from it, and **no save changes
meaning** — which is why the conversion is applied at the input's edge rather than in the model. It
also gives `s.place(def, at, rotation)` a better reading in a scenario: `at` is where the head goes.

### Why rotation lands now rather than when something needs it

The same argument as `TilePos.z` in ADR 0003, and it is the reason that ADR exists. Rotation touches
the def, the instance, placement, the preview, the save, the hash, and every sprite. Adding it once
furniture exists is a migration plus an art rewrite; adding it before there is any furniture is one
field and a `switch`.

## What did not change, and why that is the test

**`rooms.ts` was not touched.** It reads `sealsRoomAt` off the grid, so stamping every footprint cell
into the grid is the whole of the fix. If room detection had needed to learn about footprints, the
shape of the change would have been wrong — that grid exists precisely so that questions about
"what is at this cell" never have to ask "what is this part of".

The same is true of reachability, A\*, and the light wash. Everything that already worked in terms of
cells kept working.

## Consequences

- **`buildingAt` and `siteAt` test containment**, not equality. Still linear over a few dozen
  structures; see the standing note in `lookup.ts` about putting the index inside the store when it
  matters.
- **Adjacency means adjacent to the footprint, and excludes the footprint.** A pawn on one end of a
  2×1 bed is genuinely next to the other end, and a naive any-cell test would call that "beside it"
  and let a deliverer park on the site it is about to be sealed into.
- **Legality is all-or-nothing.** A 2×2 with three good cells and one in a stream is refused, and the
  preview greys out the whole shape rather than one cell of it.
- **A structure is marked for demolition whole.** Buildings show the mark by tinting the sprite, so a
  half-marked hearth would tint completely while three of its cells carried no designation.
- **Multi-tile buildables place one per click**; rect-drag stays for 1×1. The simulation would tile
  them happily — the restraint is in the input layer, where the preview can show what will happen.
- **Save v6.** The v5 → v6 step widens existing bedrolls, and has to turn one rather than drop it on
  a wall the player built after landing. It reads the save's own blocking grid and frozen literals,
  never a live def.

## Alternatives rejected

**Arbitrary cell sets instead of rectangles.** L-shaped and hollow footprints are expressible and
nothing has asked for one. A rectangle is two integers and its containment test is four comparisons;
a set is an allocation and a hash lookup on a path that runs inside loops that already walk the map.
Revisit if a building ever genuinely wants a notch in it.

**A separate `MultiTileBuilding` type.** The same argument M6 made about workbenches: a parallel type
needs its own reservation keys, its own save section, and its own answer to "what is standing on this
cell", all of which already exist. A 1×1 footprint is just a footprint.

**Storing the occupied cells on the instance.** Faster lookups, and it violates the derived-state
rule for a saving no measurement asked for.
