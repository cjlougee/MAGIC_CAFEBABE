# Work and jobs

The system that makes a colony feel like it has its own agenda. This is the deepest
system in the game and everything from Slice 2 onward hangs off it.

## The pipeline

```
WorkType      a column in the priority grid — what the PLAYER schedules
   │
WorkGiver     scans the world, returns a Job or null — decides WHICH rock
   │
Job           plain data: { kind: 'mine', cell }
   │
JobDriver     a list of toils — decides HOW
   │
Toil          one re-entrant step: reserve, walk, work, pick up, drop
```

Four separations, each earning its keep:

**Job is data, not behaviour.** A pawn's entire progress through a job is a toil index
and two counters. Saving a colonist mid-job means saving three numbers — no closures, no
reconstructing a call stack. Drivers are looked up by `kind` on load.

**WorkGiver decides *which*, JobDriver decides *how*.** "Find the nearest unreserved
reachable rock" and "walk next to it and swing" are different concerns that change for
different reasons.

**One WorkType, many WorkGivers.** Haul will grow "deliver to blueprint" and "restock
workbench" without gaining a column in the player's grid.

**Toils are re-entrant.** Every toil runs each tick and decides afresh whether it is
done, running, or failed. None cache state beyond `ActiveJob`. This is why the world
changing under a pawn degrades into a clean failure instead of a wedged colonist — and
why adding a job kind should mean *composing* toils, not writing new ones. When it
doesn't, a toil is missing.

## Priorities

Per-pawn, per-work-type, 0–4. **Lower is more urgent; 0 means never.** That inversion is
RimWorld's convention and it reads backwards cold — we match it anyway, because the
genre standard beats a cleaner scheme players would have to relearn.

`findJob` walks priority bands most-urgent first, and within a band tries givers in
declaration order. A pawn with Mine=1 and Haul=3 exhausts every mining job before
considering a haul, which is exactly what the grid promises.

## Reservations

`Reservations` maps targets to the pawn that claimed them. Without it every idle pawn
independently picks the *nearest* piece of work and they all walk to the same rock — the
colony looks broken in a way that is instantly visible. It is not an optimisation; it is
what makes autonomous labour look intentional.

**Reservations are released in exactly one place: `endJob()`.** Completion, failure, and
preemption all route through it, so cleanup cannot be remembered on one path and
forgotten on another. A leaked reservation makes a target permanently untouchable and
nothing in the game will ever tell you why — `tests/jobs.test.ts` asserts the count
returns to zero once work finishes.

## Preemption — enforcement rule 3

`interrupt(world, pawn, reason)` ends the current job, releases every claim, drops
anything carried, and hands the pawn back to the AI. Safe from any toil, at any point,
including on an idle pawn.

Dropping matters: a colonist interrupted mid-haul is holding real items, and silently
discarding them would leak resources out of the economy every time the player gave an
order — a slow, invisible bug that would be very hard to trace back to its cause.

Combat (Slice 3) and squad command (Slice 5) are both built on this. A player move order
already uses it today.

## Staggered thinking

A pawn looks for work only when idle *and* on its own think tick:
`world.tick % 30 === pawn.id % 30`.

Scanning every pawn every tick would run the giver sweep 60 times a second per colonist
for no benefit — work does not appear that fast. Staggering by id spreads the cost so no
single tick pays for the whole colony, which is what keeps frame times flat as the
colony grows. An idle pawn waits at most half a second.

## Tick order

```
commands  →  jobs / AI  →  movement  →  tick++
```

Player intent lands before anything reacts to it. Jobs may set a route; movement walks
it. So a step planned this tick begins next tick, never mid-tick.

**Walk toils clear their remaining path on arrival.** Movement ticks *after* jobs, so a
leftover route would carry the pawn straight back off the cell it just reached while the
next toil ran — a colonist mining a rock from across the map with no visible cause.

## Items

One stack per cell per definition, RimWorld's rule. Without it a hundred one-stone piles
accumulate on a tile and every haul scan walks them all — the invariant is a performance
decision as much as a display one.

`ItemStore` owns the `cell → ids` index; nothing may move an item without going through
it. Overflow past a stack limit **spills to neighbouring cells** rather than clamping,
because mining a rock yields more than a cell can hold and silently deleting the
difference would make the economy leak.

## What renders it

`OverlayLayer` draws designations and zones between the ground and the objects standing
on it — they are marks *on* the floor, so a colonist should cover them. Item piles live
in `ObjectLayer` so they sort correctly against pawns.

**`TileMap.revision` is load-bearing.** `GroundLayer` caches sprite assignments by view
rect; mining turns rock into gravel, and without a revision term in the cache key the
layer keeps drawing the world as it was and leaves a hole where the rock stood. Found by
looking at the running game — no test would have caught it, and
`tests/tilemapRevision.test.ts` now guards it.
