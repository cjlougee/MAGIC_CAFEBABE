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
