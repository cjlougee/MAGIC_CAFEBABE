# 0006 — Deconstruction, and the ground under a floor

**Status:** Accepted · 2026-08-06

## Context

M4 shipped construction without its inverse. `Erase` cancelled an unbuilt blueprint, but a finished
wall had no way out of the world at all, so a misplaced building was permanent. Closing that hole
looked like a half-day job — a designation, a giver, a driver — and it was, except for one question
it could not avoid answering: **when you lift a floor, what is underneath?**

A floor is not an object standing on a cell. It *is* the cell: `completeConstruction` overwrote the
terrain with `StoneFloor`, and that overwrite destroyed the only record of what had been there. By
the time anyone asks to remove it, the sand it was laid on is gone.

## Decision

**A finished structure may be marked for demolition, costs half the build labour to remove, and
returns half its materials rounded down. `TileMap` carries a `naturalTerrain` grid so a floor can
give back the ground it covered.**

### Half, rounded down, read from the original cost

The refund is computed from the buildable's own `cost` list rather than a separate yield declared on
the building. One number in one place: a wall's price and its salvage cannot drift apart when the
price changes.

Rounding **down** is load-bearing. Rounding up would let a player build and deconstruct in a loop to
manufacture materials out of labour, which is a free resource generator wearing a construction
costume. A one-stone building refunds nothing, and that is the correct answer to "what is half of
one".

### Only what the colony put up

The eligibility rule is "**something a blueprint produced**", not "something solid". That single
sentence settles three questions that would otherwise each be a special case:

- **Natural rock** has no blueprint and therefore no cost to refund. Removing it is *mining*, which
  already exists and already yields stone.
- **Bedrolls** arrived with the landing party. Nothing in the architect menu makes one.
- **A half-built wall** is a mark, not a structure. Clearing it is Erase's job and it is instant.

Implemented as two reverse indices built once from `BUILDABLE_DEFS`, so the answer is a map lookup
rather than a linear scan inside a loop that already walks the map.

### The natural-terrain grid

`TileMap` gains a fourth `Uint8Array`: the ground beneath any surface the colony has laid. It equals
`terrain` everywhere except under a constructed floor.

Two setters now exist where there was one, and the distinction is the whole point:

| Setter | Means | `naturalTerrain` |
|---|---|---|
| `setTerrainAt` | the ground itself changed — worldgen, or mining through it | updated too |
| `setSurfaceAt` | something laid *over* the ground, or lifted off it | left alone |

Mining updates both, because mined-out rock does not come back — gravel *is* the new ground. Laying
a floor updates only the surface.

This grid is **not derivable** and so, unlike `walkCost`, it is saved. A stone floor tells you
nothing about what it covers. That is what took the save format to version 2.

## Why not derive it, or default it

- **Default to dirt on removal.** Cheapest, and it makes the map quietly stop matching the world it
  was generated from: lay a floor on sand, lift it, get dirt. Do that across a colony's lifetime and
  the terrain becomes a record of where the player has built rather than of what the world is.
- **Store the covered terrain on a per-cell object.** Only floors need it, so a sparse map looks
  frugal — but it is a second source of truth for "what is this cell", living beside a grid that
  already answers that question, and the two can disagree. A parallel array cannot.
- **Forbid deconstructing floors.** Dodges the question entirely and leaves the player unable to
  undo the cheapest, most-placed, most-misplaced thing in the game.

The grid costs one byte per cell — 2,304 bytes on a 48×48 map — and RLE-compresses to almost nothing
in a save, because it is even more repetitive than `terrain`.

## A mark on a wall has to be drawn on the wall

`OverlayLayer` sits *below* the object layer, deliberately: designations are marks on the floor and
pawns and buildings should cover them. Correct for mining and stockpiles, and completely wrong here.
A wall hid its own mark, so marking one for demolition gave the player **no feedback whatsoever** —
the order had registered, work was queued, and nothing on screen said so.

Buildings marked for demolition are therefore **tinted in the object layer**, where nothing can
cover them. Floors, being flat, keep the ordinary overlay marker. The alternative — hoisting all
designations above objects — would draw stockpile zones and mine marks over the colonists standing
on them, trading a real problem for a worse one.

This was invisible to a green test suite and obvious within seconds of watching the game, which is
now the fifth entry in that particular table.

## Consequences

- **Deconstruction is a second giver under Construct**, listed after `ConstructGiver`, so a colony
  with both queued finishes what it started before tearing anything down. A half-built wall left
  standing while colonists demolish elsewhere reads as the build order being ignored.
- **The driver needs no `canProgress` guard**, unlike construction. Demolition only ever *adds*
  passability — a wall's cell opens, and a floor reverts to ground that was walkable or the floor
  could not have been placed. Nobody can be sealed in by it.
- **The job addresses a cell, not a building id**, because the same job removes a wall (an entity)
  and a floor (terrain), and only the cell describes both. The driver re-reads what stands there
  each tick, so the job cannot go stale against the world.
- **It claims the structure as well as the cell.** Those are different reservation keys, and a
  colonist asleep in a bed holds the *entity* — without the second claim, someone could dismantle
  the bed out from under them.
- `migrate.ts` has its first real step, and with it the rule that **a step must never import a live
  definition**. The terrain ids in the v1 → v2 step are frozen literals, because they describe a
  file as it was, not the game as it is.
