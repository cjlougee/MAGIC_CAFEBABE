# Production

Turning materials into goods: recipes, workbenches, and the bills that say how much.

Cooking is the first instance, because the pressure for it already exists — raw food carries a
mood penalty from M3 — so the bill system arrives serving a need the player already feels rather
than as machinery looking for a use.

## A recipe is a buildable that produces an item

```ts
interface RecipeDef {
  workAt: BuildingId;            // which bench
  ingredients: MaterialCost[];   // the same shape a buildable's cost uses
  product: { def: ItemDefId; count: number };
  work: number;                  // ticks of labour once everything has arrived
  defaultUntilCount: number;     // the quota a fresh bill starts at
}
```

Deliberately the same shape as `BuildableDef.cost`, because it is the same problem: a pile of
required materials, a record of what has arrived, and a question of whether anything is missing.
`outstanding()`, `hasAllMaterials()` and `missingMaterials()` are generalised over
`(delivered, cost)` and serve construction sites and workbenches alike. One implementation means
the two cannot disagree about what "still needs two stone" means.

**Recipes take many ingredients.** A bench holds an inventory, you load it, then someone works it.

## Bills, and what "enough" means

A bill is a standing order on a bench:

```ts
interface Bill { recipe: RecipeId; untilCount: number; }
```

**A bill is suspended by arithmetic, not by a flag.** The giver counts the product in the world and
skips the bill when the colony already has enough. The bench idles when stocked and restarts when
supplies drop, and there is no "active" state to keep in sync with reality — the only way to be
wrong about whether a bench should be working is to be wrong about how many meals exist.

`defaultUntilCount` gives a fresh bill a sensible quota so adding one is a single click.
`untilCount` is then the player's to set: **what counts as "enough" is a decision the player owns**,
per bench, and a colony that wants a deep larder should be able to say so.

## Work is a pool, not an assignment

The colony does not hand out jobs and hold pawns to them. Every tick, each idle pawn asks what the
highest-priority thing it is *allowed* to do would be, and takes it. Which means:

- **Anyone assigned the work can join it.** Two cooks stocking one bench is the normal case, not a
  race to be resolved.
- **Anyone can leave it**, the moment something outranks it — a need, a higher-priority work type,
  or a direct order.
- **And rejoin**, when demand reappears, with no memory of having been pulled away.

This is why hard preemption is one of the three enforcement rules rather than a nicety. A pawn must
be able to drop a job cleanly *at any point*, releasing reservations and dropping what it carries,
because being pulled off work is the ordinary case and not an error path. `endJob()` being the single
exit is what makes "leave and rejoin freely" safe.

## Who is allowed to answer a request

Construction and crafting both need materials brought to a spot, and they resolve it differently on
purpose:

| | The request | Who hauls |
|---|---|---|
| **Blueprint** | public — the colony can see the plan | `Haul`, so any hauler responds |
| **Workbench** | private — the kitchen's own business | `Cook`, so only the kitchen staff do |

Stocking a bench is therefore **not a Haul job**. If it were, placing one bill would pull every
hauler in the colony off what they were doing because the chef had an idea — the colony mobilising
to serve an intention it has no way of knowing about. A blueprint is different in kind: it is a
plan the player has published, and answering it is exactly what hauling is for.

The mechanism is small — the stocking job is given by `CookGiver` rather than a Haul giver — and it
is the whole of the distinction. No new machinery, and no loop control flow in the job system: the
giver simply returns whichever job is next.

```
bill unmet, something missing  →  stockBench   (fetch one ingredient, deposit)
bill unmet, everything there   →  craft        (do the labour, produce the item)
bill met                       →  nothing
```

Each is an ordinary linear job, so a cook part-way through stocking can be interrupted by hunger and
pick the errand up afterwards — or a second cook can finish it. **A part-stocked bench is never a
loss**: cancelling the bill or deconstructing the bench returns everything loaded into it, the same
way cancelling a blueprint hands back its delivered materials.

## Eating, once there is something better than raw

`ItemDefinition` gains `nutrition` and `eatThought`. Both used to be constants that `consumeFood`
reached for directly — fine with one food, and two branches waiting to drift the moment there were
two. As item data, the third food is a data change and the eating code never learns about it.

Colonists prefer the best food available, so a cooked meal is eaten before raw stores. Otherwise the
colony would cook diligently and then eat berries, and the whole feature would be invisible.

## Light lives in `render/`, for now

Darkness affects nothing in the simulation yet, which makes a light field **derived render state**:
computed from emitter positions, cached, invalidated when buildings change. Nothing is saved, nothing
is hashed, and there is no risk of a stored copy disagreeing with the buildings it came from.
`BuildingDef.lightRadius` is content and lives in `sim/defs/`; only `render/` reads it.

`LightingLayer` already draws the day/night wash. It becomes the wash minus what the emitters light.

**Darkness is expected to matter later** — a work-speed penalty, and a benefit to staying unseen once
there is anyone to hide from. When it does, the grid moves into `sim/` and is recomputed on load
rather than saved, because it stays a pure function of where the emitters are. That move changes the
field's *address* and nothing else, which is why it is not worth paying for now. Compare
`docs/decisions/0003-verticality.md`, where the opposite call was made: widening a position type
after everything depends on it is a rewrite, so it was done up front. Relocating a derived grid is
not.

## Tests — `tests/cooking.test.ts`

1. **Outcome, headless.** A bench, a bill, raw food in reach: run, and meals exist.
2. **It stops at the quota**, and starts again when meals are eaten below it.
3. **Multi-ingredient recipes** load fully before any labour happens.
4. **Cancelling a bill and deconstructing a stocked bench** both return the ingredients.
5. **A colonist eats the meal, not the raw food**, and gets the better thought.
6. Reservation exclusivity, no leaks, preemption mid-stock, and `Cook` at priority 0 never chosen.
7. Bills and bench inventories survive a save round-trip.
