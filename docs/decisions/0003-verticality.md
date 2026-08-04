# 0003 — Verticality: discrete z-levels, reserved now, built later

**Status:** Accepted · 2026-08-04

## Context

Verticality is wanted for gameplay reasons that span two apparently different features:

- **Tactical elevation** — pawns take the high ground for a damage bonus, or drop into a trench or
  behind cover for a defence bonus.
- **Underground space** — an odd-looking cave opens into a dungeon of derelict, dangerous relic-tech.

Plus a presentation requirement borrowed from Space Haven: a **cross-section toggle** that hides
roofs, walls, or whole levels so the interior stays visible.

None of this is needed now. The question is only what must be true *today* so that building it later
costs what it should, rather than costing a rewrite.

## The modelling decision

There are two ways to do verticality, and they are not interchangeable:

|  | Height field | Discrete z-levels |
|---|---|---|
| Shape | One surface per (x, y) at a continuous elevation | Stacked independent layers at the same (x, y) |
| Gives you | Smooth hills, ramps, gentle relief | Caves, overhangs, multi-storey buildings |
| Cannot express | Anything *under* anything | Gentle slopes — everything is stepped |

A height field cannot represent a cave, because a cave requires two surfaces at one (x, y). That rules
it out on its own.

**Decision: discrete z-levels.** One concept covers every case:

- **High ground** is standing on level 1 while the target stands on level 0.
- **A trench** is a floor at level −1 that a pawn drops into.
- **Cover** is a solid cell adjacent to the shooter's line of fire — already a z-level concept.
- **A cave** is a level with solid rock above it.
- **A second storey** is a constructed floor on level 1.

Everything is stepped rather than smooth. For a top-down-lineage colony sim that is the correct
trade — Dwarf Fortress works this way, and stepped terrain reads *better* in isometric than a smooth
height field would, because each step gets a legible side face.

## What is reserved now

The expensive retrofit is not the grid — it is **the position type**. Adding a trailing `z` argument to
an indexing function later is mechanical. Widening `Pawn {x, y}` to `{x, y, z}` after pawns, job
targets, reservation keys, pathfinding nodes, and save files have all been built on two axes is not.

**Pawns do not exist yet.** M1 creates the first one. So the whole of the reservation is:

- `sim/core/position.ts` — `TilePos {x, y, z}`, `GROUND_LEVEL`, and level-aware distance.
  `tileDistance` returns `Infinity` across levels, because travel between them goes through a ramp
  and a straight line would let pathfinding heuristics quietly cheat.
- `TileMap` carries `levels` (currently 1) and indexes level-major: `z * layerSize + y * width + x`.
  Level-major because play iterates *within* a level constantly and *across* levels rarely.
- `render/iso.ts` — `tileToWorld`/`worldToTile` take a level. Higher levels draw `LEVEL_HEIGHT` pixels
  up the screen. At `GROUND_LEVEL` the maths is byte-identical to the flat projection.
- `hashWorld` covers `levels`, so the save fingerprint already guards it.
- `tests/position.test.ts` exercises a genuinely 3-level map. **A reserved seam that was never tested
  is not reserved — it is a guess.**

Total runtime cost today: one unused field per position, and one multiply-by-zero per index.

## What is deliberately *not* built

Following the principle that we don't build tooling for plans that haven't arrived:

- **No cross-section / cutaway rendering.** This is a filter in a draw loop — "skip cells above the
  cut plane" — not a data-model change. Retrofit cost is low, so it waits until there is a second
  level to look at.
- **No vertical pathfinding.** Ramps and stairs are connectivity, and connectivity lands with the
  reachability work in M1. Adding a vertical link then is natural; adding it now is guesswork.
- **No combat modifiers.** High ground and cover bonuses need a combat system to modify (Slice 3).
- **No multi-level worldgen.** Cave generation belongs with the exploration content it serves
  (Slice 4).
- **No height field.** Rejected above; storing continuous elevation would be committing to the wrong
  model, and worldgen's elevation noise will instead select a *surface level* per column when levels
  land.

## Consequences

- Terrain heights in `terrainArt.ts` (rock 14px, bulkheads 22px) are currently decorative sub-level
  relief and are *not* the same thing as `LEVEL_HEIGHT` (24px). When levels land these must be
  reconciled, or a raised terrain tile and a genuine level above will look identical while behaving
  completely differently.
- Draw order gains an outer sort: `for z { for y { for x } }`. Everything on level z draws before
  anything on z+1, since a higher level is unconditionally nearer the viewer. `tileDepth` stays a
  within-level comparison rather than becoming a combined key that would depend on map size.
- Cross-sections make picking ambiguous — one screen point sits over one tile *per level*. This is why
  `worldToTile` takes the level rather than inferring it: the cut plane decides which level the player
  is pointing at.
