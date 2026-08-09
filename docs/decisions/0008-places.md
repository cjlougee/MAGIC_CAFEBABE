# 0008 — Noise makes texture, constraints make places

**Status:** Accepted · 2026-08-08

## Context

The world already had ruins in it. A noise field thresholded at 0.7 lays down relic plating
and at 0.79 lays down bulkheads, and M7 added a second, longer-wavelength field so the
wreckage thickens in some country and thins to nothing in others. It works: the map reads
as *inherited* from the first minute.

It also produces nowhere to go. Scattered plating is scenery — you walk past it, you mine
it for scrap, and it never becomes a destination, because every patch is the same patch
with different edges. M8's job was the opposite of texture: **one place worth crossing the
map for**, and the temptation was to get it cheaply by finding the densest blob in the
existing ruin field and putting a label on it.

That would have been a type wearing a name. See
[`design/00-vision.md`](../design/00-vision.md) — the whole design rests on things being
particular, and the generator's job is to produce particulars rather than variety.

## Decision

**A place is sited by a constraint search and named once at generation; texture is a
threshold on noise. They are separate mechanisms and neither is expressed in terms of the
other.**

### Why a threshold cannot do it

Not a matter of taste. The properties that make somewhere a destination are *relational*,
and a per-cell noise sample has nothing to relate to:

| Requirement | What it needs to know |
|---|---|
| Far enough away to be a journey | where the colony landed |
| Not standing in a lake | the whole footprint, not this cell |
| Not on top of the last one | the other places |
| Has a way in | that a door faces open ground **connected to home** |
| Guaranteed to exist | whether the search has already succeeded |

Every row is a fact about the map as a whole. A threshold sees one number at one cell.

So `poiPlacement.ts` samples candidate sites from the world RNG, rejects the ones that
fail, scores the survivors by how much wreckage is nearby — the old builders built where
they built — and stamps a walled compound into the terrain grid at the winner.

### Three relaxation passes, and only one kind gets them

A world with nothing to walk to is the M8 version of a bigger screensaver, so the vault is
`guaranteed` and its search runs again on looser terms if the first pass finds nothing:
more rock tolerated, then the distance requirement halved. Listening posts get one pass —
an optional place that cannot find good ground simply does not exist this seed, which is
better than one wedged somewhere implausible.

### The name is the point, and so it is saved

Position and footprint could in principle be recomputed by re-running placement against
the seed. The name could not be *relied* on to come back the same the moment placement is
ever tuned, and a vault that is called something different next session is not a place —
it is a re-roll. So places round-trip through the save (v4) and their names are in
`hashWorld`, where a restored compound in the right spot under the wrong name fails
the test rather than passing it.

Three name shapes, all of which avoid describing the thing: `Kessler Relay`,
`Vault Nine`, `The Pale Mast`. The type noun comes from the `PoiDef` so a vault is never
called a mast, and the rest comes from word lists. `tests/places.test.ts` asserts that no
generated name contains its own category.

## Why not the alternatives

- **Label the densest blob in the ruin field.** Cheapest by far, and it fails every row of
  the table above — most fatally the last two. Nothing would guarantee a way in, and
  nothing would guarantee one exists at all on a given seed.
- **Hand-author a fixed set of places at fixed coordinates.** Genuinely particular, and it
  throws away the reason the world is generated: every seed would have the same vault in
  the same valley, and the second playthrough would have no frontier in it.
- **Generate the name on demand from the position.** Removes the save change, and quietly
  makes the name a function of the current build rather than of the world. Tune the word
  lists and every place in every existing colony is renamed.

## Consequences

- **Placement runs after the landing site is chosen and before plants are scattered.** The
  distance constraint needs the first; the second stops a berry bush growing on ground a
  compound is about to be stamped over.
- **A `ReachabilityMap` is built once during worldgen** to answer "is this approach
  connected to home", and deliberately not refreshed between places. Stamping a walled ring
  into open ground cannot disconnect the ground around it — you walk around a building —
  and each interior reaches the outside through a door chosen from already-connected
  ground. Rebuilding per place would cost a full re-flood each time for nothing.
- **Doors are chosen, not cut.** The first version cut gaps at random positions, and seed 7
  produced a compound whose openings both faced rock. That is worse than an inaccessible
  building: its interior is walkable, so it becomes an isolated district that reachability
  reports as unreachable forever, and a colonist sent there simply never arrives with
  nothing on screen to say why. Doors are now picked from wall cells that face open ground,
  preferring facing walls so the place has a through-route.
- **The compound's centre is kept standable.** It is the place's address — the minimap
  marker points at it and M9's travel order will path to it — so the internal cross-wall is
  offset rather than laid through the middle. A wall on the centre row made the middle of
  the building solid, and the only symptom was a colonist who would not go there.
- **Save v4.** The v3 → v4 step gives old saves *no* places, which is the honest answer
  rather than a shortfall: a v3 world's terrain has no compounds stamped in it, so records
  for them would describe buildings that are not there.
- **A minimap became mandatory, not optional.** Six named places eighty to two hundred
  tiles away are worth nothing if the player cannot see that they exist. See
  [`design/08-the-world.md`](../design/08-the-world.md).
