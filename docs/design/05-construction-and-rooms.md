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
