# 0004 — Water is a barrier, not a slow lane

**Status:** Accepted · 2026-08-05

## Context

M2 shipped with stockpiles allowed on any *passable* cell. Shallow water is passable, so colonists
would happily wade into a river and stack crates in the current — and mined stone spilled into the
water too. The bug surfaced a question the codebase had never actually answered: what is water *for*?

Three things needed deciding: whether water blocks movement or merely slows it, whether colonists can
swim, and what happens when the player tries to use water as ground.

## Decision

**Deep water is impassable. Shallow water is passable but slow (cost 22 against open ground's 10).
Colonists cannot swim. Nothing may be stored in either.**

Formally, this introduces a distinction the terrain table did not have:

```
passable   — a colonist may enter this cell
storable   — goods may rest on this cell
```

Every terrain answers both the same way *except water*, which is exactly why conflating them went
unnoticed. `TerrainDef.storable` now states it explicitly, and `canDesignateMine` /
`canPlaceStockpile` in `sim/world/placement.ts` are the single definition both the command handlers
and the drag preview consult.

## Why no swimming

Deep water being a hard barrier is a **feature**, not a limitation:

- It gives the map shape. A coastline or a river is a real constraint on where a colony can grow,
  which makes site choice matter.
- It creates chokepoints, which is what makes terrain tactically interesting once raids arrive
  (Slice 3) and squads can be positioned (Slice 5). A map you can swim across has no chokepoints.
- Shallow fords become meaningful: the cost-22 crossing is a decision, not a formality.

Swimming would erase all three for the sake of realism nobody asked for. RimWorld and Kenshi both make
the same call.

Bridges — building over water to create a crossing you control — are the natural counterpart, and land
with construction in M4.

## Consequences

- **Spill and drop searches filter on `storable`, not `isPassable`.** Mining a riverbank no longer
  spills stone into the water, and a colonist interrupted mid-ford puts their load on the bank rather
  than in the current.
- **Rejected cells are shown during the drag**, tinted red, rather than the tool silently doing
  nothing. Silent refusal reads as "the click didn't register", which is worse than a visible no.
- Solid terrain is also marked unstorable. Nothing can stand there, so nothing can be stacked there —
  previously covered incidentally by the passability check, now stated.
- A stack whose spill radius finds no storable cell **is lost**. That needs a colonist working a
  one-tile island; the alternative is over-stacking, which would break the one-stack-per-cell
  invariant everything else relies on.

## Alternatives rejected

- **Let items sit in shallow water.** Simplest, and wrong: colonists wading out to stack crates in a
  river looks broken, and it would undermine the later idea that terrain constrains where a base can
  be built.
- **Make shallow water impassable too.** Removes the ford, which is one of the few places terrain
  currently creates an interesting routing decision.
- **Allow swimming with a speed penalty.** Costs the map its shape and the tactical layer its
  chokepoints, in exchange for realism that does not serve any pillar.
