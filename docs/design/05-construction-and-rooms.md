# Construction and rooms

Turning an order into a structure, and working out what that structure encloses.

## Blueprints are one entity, not two

RimWorld keeps blueprints and frames separate; this merges them into a `ConstructionSite`
with two phases, because the only real difference is whether the materials have arrived.
One entity means one reservation, one cancel path, and one place to ask "what is being
built here".

```
place blueprint  →  Haul delivers materials  →  Build does the labour  →  it exists
```

**Delivery is Haul, not Construct.** One work type can have many givers; the player
schedules *who carries things*, and carrying stone to a wall is carrying things. Adding a
column for it would be a lever nobody asked for.

**Sites are passable while under construction.** A colonist has to be able to walk over a
planned wall to reach the far side of it, or a half-drawn house becomes a cage before it
is ever a shelter.

**Cancelling refunds.** Whatever was delivered goes back on the ground. Otherwise every
misclick quietly costs materials with no way to recover them.

## Buildings are not terrain

`TileMap` grew two grids alongside `walkCost`:

| Grid | Question |
|---|---|
| `walkCost` | How expensive is this ground? (terrain) |
| `buildingBlocks` | Does a structure stop movement here? |
| `buildingSealsRoom` | Does a structure form a room edge here? |

Three separate questions with three separate owners. Folding a wall into `walkCost` would
mean deconstructing it had to *guess* what the ground underneath used to be. And blocking
is separate from sealing because **a door is walkable and still seals a room** — without
that split, a house with a door has no interior, which is the whole point of building one.

## Taking it back down

`Erase` clears *marks* — a designation, a stockpile, an unbuilt blueprint. It never
touches anything finished, or a drag across the base to tidy up zones would quietly
demolish the base. Removing a standing structure is real work with a real cost, so it gets
its own designation, its own giver under **Construct**, and a driver that ends by
salvaging part of what it cost.

```
mark for deconstruct  →  Construct does the labour  →  it is gone, half the cost back
```

**Half, rounded down.** Rounding *up* would let a player build and deconstruct in a loop
to manufacture materials out of labour. A one-stone building refunds nothing, which is the
right answer to "what is half of one".

**The refund reads the original cost list** rather than a separate yield declared on the
building. One number in one place, so a wall's price and its salvage cannot drift apart
when the price changes.

**You may only take down what the colony put up.** The rule is "something a blueprint
produced", not "something solid", and it settles three questions at once: natural rock is
*mined* (no blueprint, so no cost to refund), bedrolls arrived with the landing party, and
a half-built wall is a mark rather than a structure — that is Erase's job, and it is
instant.

The giver is listed *after* `ConstructGiver`, so a colony with both queued finishes what it
started before tearing anything down. A half-built wall left standing while colonists
demolish elsewhere looks like the build order was ignored.

### Floors remember what they were laid on

A floor overwrites the surface, so `TileMap` carries a fourth grid:

| Grid | Question |
|---|---|
| `naturalTerrain` | What is the ground *under* any surface we laid? |

Without it, lifting a floor would have to invent an answer, and the map would slowly stop
matching the world it was generated from — lay a floor on sand, remove it, get dirt. The
distinction is carried by two setters that are easy to confuse and must not be:

- `setTerrainAt` — **the ground itself changed.** Worldgen deciding it, or mining cutting
  through it. Updates `naturalTerrain` as well, because mined-out rock does not come back.
- `setSurfaceAt` — **something laid over the ground, or lifted back off it.** Leaves
  `naturalTerrain` untouched.

It is not derivable from `terrain` — a stone floor says nothing about what it covers — so
unlike `walkCost` it has to be saved, and it is why the save format went to version 2.

### A mark on a wall has to be drawn on the wall

Designation marks live in `OverlayLayer`, which sits *below* objects so pawns and walls
cover the floor. That is right for mining and stockpiles and exactly wrong here: a wall hid
its own mark completely, so marking one gave the player no feedback at all — the order had
registered, and nothing on screen said so. Buildings marked for demolition are therefore
**tinted**, in the object layer, where nothing can cover them. Floors, being flat, keep the
ordinary floor marker.

## A building may be bigger than a cell

A structure stores **an anchor and a rotation**; which cells it stands on is worked out
from its def. `sim/world/footprint.ts` is the only place that arithmetic lives, and the
cells are never stored — see [ADR 0009](../decisions/0009-footprints.md) for why an anchor
rather than a centre, and why all four rotations are kept when only two shapes exist.

```
BuildingDef.footprint {w, h}   the shape, unrotated, w along +x
Building.pos                   the anchor: min x and y of the ROTATED footprint
Building.rotation              0-3 quarter turns, saved and hashed
```

Rotations **0 and 2 cover identical cells** and differ only in *facing* — which end of a
bed you sleep at. `headCellOf` is the only thing that can tell them apart, and without it
"rotate the bed" would be a control that visibly does nothing.

**The three grids did not change, and that is the test that the fix is shaped right.**
`walkCost`, `buildingBlocks` and `buildingSealsRoom` are per-cell, so a multi-tile
structure stamps every cell it stands on and everything downstream — rooms, reachability,
A\*, the light wash — keeps working without knowing footprints exist. If room detection had
needed to learn about them, the change would have been in the wrong place.

What *did* have to change is everything that used to say "the cell":

- **Legality is all-or-nothing.** A 2×2 with three good cells and one in a stream is
  refused. `canPlaceFootprint` checks every cell, and the drag preview greys out the whole
  shape rather than the one offending cell — half-placing is not a thing that can happen,
  so showing it would be a lie.
- **Adjacency means beside the *footprint*, and excludes it.** A pawn standing on one end
  of a 2×1 bed is genuinely next to the other end, and an any-cell test would call that
  "beside it" — which is exactly how a deliverer ends up parked on the site it is about to
  be sealed into. `isAdjacentToFootprint` returns false for anyone inside.
- **A structure is marked for demolition whole.** Buildings show the mark by tinting the
  sprite, so a hearth with one cell marked would tint entirely while three of its cells
  carried no designation — a finished order to the player, a quarter of one to the givers.
- **Deconstruct refunds once**, not once per cell, and clears every cell's grid entry and
  every cell's designation.
- **Multi-tile blueprints place one per click.** The simulation would happily tile them
  across a drag; the restraint lives in the input layer, where the preview can show what
  will actually happen. Rect-drag stays for anything 1×1, because walls are laid in runs.

**Bedrolls arrive 2×1 and have to be laid out as pairs.** `placeBedrolls` passes a fit test
*into* the ring search rather than filtering its results — taking the nearest N cells and
discarding the ones that don't fit returns fewer bedrolls than the party brought instead of
looking further out, which is the same shape as the bug that once landed everyone in a lake.

## A door is an opening, and can be barred

Until M11 a door was `drawRaised` with a coloured strip on it — a wall of a different
shade. In a run of walls, the one you could walk through was findable only by looking for
the colour. It is now drawn as what it is: two jambs continuing the wall either side, a
threshold across the gap, and the ground visible between them.

**A door orients itself to the run it interrupts.** `orientToNeighbours` counts sealing
neighbours on each axis and faces the door along the busier one. This is not a
convenience: a door is one cell, so the toolbar offers no Rotate button for it, and
without this there is no way for the player to say which way it runs at all. Ties keep
whatever was asked for, so a free-standing door is still placed rather than refused.

**Locking flips `buildingBlocks` and leaves `buildingSealsRoom` alone** — the clearest
possible use of the pair M4 kept separate. A barred door is a wall to a colonist and still
a door to the room, so a hut with its door locked is still indoors and everyone sleeping
in it keeps the roof bonus. `setLocked` sits beside `completeConstruction` and
`deconstruct` for the same reason those two are neighbours: they are the only places the
built shape of the world changes, and the invalidations they owe belong where a reader can
see one is missing. Locking owes reachability, per cell, and owes rooms *nothing*.

There is **no "hold open"**. It would have to mean walkable and non-sealing, and with no
temperature and no cost to opening a door the only thing it could do is take the roof
bonus away. A setting whose sole effect is to make things worse is a control nobody would
ever use, and offering it is the same lie as a work column with no giver behind it.

### Locking is the first thing that can seal a colonist in on purpose

Bar the only door of an occupied hut and the colonist inside is not standing on an
impassable cell — `escapeIfTrapped` sees nothing wrong — they are in a perfectly
legitimate reachability district with nothing in it. `canReach` answers "no" correctly to
every target the colony has, and they stop working, cannot eat, and eventually die with
nothing on screen having said a word. This is the M8 lesson exactly, and M11 is the first
milestone to hand the player a button that causes it.

So `buildAlerts` gains **"X is cut off from the colony"**, measured against the landing
site, at one O(1) district comparison per colonist. The lock is still allowed — sealing a
room is a legitimate thing to want — it simply cannot happen silently.

## Selecting a structure

A wall was not a click target until M11. Everything selectable either moved or carried
bills, so taking down one misplaced wall meant picking the deconstruct tool and dragging a
rectangle over it: reaching for the tool built for tidying a whole area to express a single
mistake, and hoping the drag caught nothing else.

`selectedBenchId` became `selectedStructureId`, and the snapshot publishes a
`StructureSummary` per building. The panel's ✕ goes through the **ordinary designate
command** over a one-cell area rather than a private path, so it cannot mean anything
different from the tool — it already spreads a mark across a multi-tile footprint and
already refuses anything the colony did not build. A bench gets two panels stacked in the
rail, because "what is this" and "what should it make" are different questions and the
second is much longer.

## Rooms

A flood fill over open ground, stopping at anything that seals. A space is a room when
**both** hold:

1. the fill cannot escape to the map edge, and
2. its boundary includes at least one thing a colonist built.

The second condition is not obvious and matters a lot. Terrain encloses plenty of pockets
by itself — a clearing ringed by rock, a lagoon ringed by deep water. Counting those would
hand colonists the "slept under a roof" bonus for bedding down in a hollow, which is
precisely the reward that is supposed to make building a hut worth doing. Before the fix,
a fresh map reported eight rooms with nothing built.

The fill is **orthogonal only**. Diagonal spread would leak a room through the point where
two walls meet at a corner, and a house with a diagonal gap is not a house.

Rooms rebuild lazily on the same dirty-flag pattern as reachability, because both change
for exactly the same reason — a structure went up or came down. `completeConstruction` is
the single place that marks both.

## Nobody gets walled in

The nastiest bug this system has had, and worth stating plainly because the failure is
severe and silent.

Delivery originally walked *onto* a site to drop materials. If another colonist finished
that wall in the same moment, the deliverer was sealed inside it. A pawn on an impassable
cell has no reachability component, so `canReach` returned **false for every target** —
they idled forever with no visible cause, and seven of sixteen walls never got built.

Three defences, because "colonist can reach nothing, ever again" is too severe to guard in
only one place:

1. **Delivery walks adjacent**, never onto the site.
2. **Construction waits** while anyone occupies the cell — `toilWork`'s `canProgress`,
   which pauses rather than fails, because the condition clears on its own.
3. **`escapeIfTrapped`** in movement relocates any pawn found on an impassable cell.

## Food has a ceiling

Unrelated to construction on the surface, but it is what makes construction *happen*.

Berry bushes regrow forever and Harvest is checked before Build in the giver order, so
colonists harvested for eternity and never mined or built anything — the entire rest of the
game silently never occurred. `HarvestGiver` now stops once the colony holds roughly three
days of food.

It is also simply better behaviour: nobody strips every bush on the map when the stores are
full.
