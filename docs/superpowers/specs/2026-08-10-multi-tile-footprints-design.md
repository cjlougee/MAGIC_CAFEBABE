# M10 — Multi-tile footprints

**Status:** agreed, not yet built · 2026-08-10 · backlog item 6

A working plan, not a design doc. When the code lands,
[`design/05-construction-and-rooms.md`](../../design/05-construction-and-rooms.md) gains the durable
description and this file stops being interesting.

---

## The problem

Every building occupies exactly one cell, and eight separate systems have that assumption baked in:
placement legality, `buildingBlocks`, `buildingSealsRoom`, which cell a pawn reserves, which cell a
pawn walks to, room flood-fill, the save shape, and deconstruct. A desk is not one tile and neither
is a bed, so backlog items 8 (buildings that look like buildings) and 9 (things that go in
buildings) are both gated on this.

The 2×1 bedroll is the first case because it already exists and is already wrong.

## The model

```ts
// defs/buildings.ts — content
readonly footprint: { readonly w: number; readonly h: number };   // unrotated, w along +x

// entities/building.ts, entities/constructionSite.ts — instance
readonly pos: TilePos;   // the ANCHOR: min-x / min-y cell of the ROTATED footprint
rotation: Rotation;      // 0 | 1 | 2 | 3, saved
```

Rotations **0 and 2 cover identical cells** and differ only in facing; 1 and 3 likewise. Rotated
size is `(w, h)` at 0/2 and `(h, w)` at 1/3.

Cells are **derived, never saved** — the codebase rule. One new module owns the arithmetic:

```
sim/world/footprint.ts
  sizeOf(def, rotation)            -> { w, h }
  cellsOf(anchor, def, rotation)   -> TilePos[]
  coversCell(building, map, index) -> boolean
  isSingleCell(def)                -> boolean
```

Nothing else computes footprint cells. If a second place ever does, the two will disagree the first
time a rotation convention changes.

### Why rotation now rather than later

The same argument as `TilePos.z` in ADR 0003. Rotation touches the def, the instance, placement, the
preview, the save, the hash, and every sprite. Adding it after furniture exists is a save migration
plus an art rewrite; adding it today is one field and a `switch`. It costs one integer per building.

## What changes

| Area | Change |
|---|---|
| `world/lookup.ts` | `buildingAt` / `siteAt` test footprint containment, not one cell |
| `world/placement.ts` | `canPlaceBlueprint(world, cell, buildable, rotation)` — **every** footprint cell in bounds, storable, free of buildings and sites |
| `world/construction.ts` | `completeConstruction` / `deconstruct` stamp and clear every cell; `markDirtyAt` **per cell**, never the blanket `markDirty()` |
| `world/rooms.ts` | **nothing.** It reads `sealsRoomAt` off the grid, so stamping every cell is the entire fix |
| `ai/toils.ts` | `bestAdjacentCell` → adjacent to *any* footprint cell, excluding the footprint itself |
| `world/designations.ts` (callers) | Marking any cell of a building marks its whole footprint |
| Input / preview | Multi-tile buildables place one footprint per click; rect-drag stays for 1×1 |
| `render/iso.ts` | `footprintBounds()` — the single definition, as the projection rule requires |
| `render/art/artProvider.ts` | `building(def, rotation)`; cache key gains rotation |
| `save/` | v5 → v6: `rotation` on buildings and sites, in **both** `serialize.ts` and `hashWorld()` |

### The sprite frame

For a `w × h` footprint anchored at `(ax, ay)`:

```
width  = (w + h) * HALF_TILE_W
height = (w + h) * HALF_TILE_H + buildingHeight
left   = tileToWorld(ax, ay + h - 1).x - HALF_TILE_W
top    = tileToWorld(ax, ay).y - HALF_TILE_H - buildingHeight
```

At `w = h = 1` this reduces to `TILE_W × TILE_H` at the current offsets, so every existing
single-tile sprite is byte-identical. That is the check that the generalisation is right.

Depth sorting uses the footprint's **maximum** `x + y`, so the structure draws after everything
strictly behind it. Flat buildings keep `BUILDING_BIAS` and stay under pawns; raised ones keep the
entity bias. A tall multi-tile building will sort imperfectly against a pawn standing beside its far
corner — noted, and left for M13, which owns building occlusion anyway.

### Two sprites, four facings

`buildBuildingGraphics(def, rotation)` draws two footprint orientations. The 180° pairs differ only
in which end the detail sits at — a bedroll's pillow, later a bed's headboard. A horizontal flip is
**not** a 180° rotation in isometric: mirroring maps `(x − y) → −(x − y)`, which swaps the axes and
reverses the light direction. The one light direction is not negotiable, so the pillow moves and the
shading does not.

## The migration has a real problem

v5 → v6 widens every existing bedroll from 1×1 to 2×1. In an old save the cell east of a bedroll may
hold a wall the player built after landing.

The step cannot import `Building.Bedroll` or the live footprint — that rule exists precisely because
a renumbered table makes every such step quietly misread old saves. So it **freezes the literals**
(`def === 0` was Bedroll at v5; the footprint it is being widened to is 2×1) and reads the save's own
RLE `blocks` grid:

1. east cell blocked or holding another saved building → `rotation: 1`
2. south cell also blocked → `rotation: 0`, accept the overlap

Bedrolls are passable and do not seal, so a residual overlap is cosmetic rather than a grid conflict.
Everything else in the save gets `rotation: 0`.

## What ships

1. **Bedroll → 2×1.** Flat, passable. Proves footprint, rotation, save, render.
2. **Bed — 2×1, buildable, passable, `isBed`.** The upgrade M4 promised and never delivered. Proves
   blueprint → deliver → build → deconstruct across a footprint.
3. **Hearth — 2×2, buildable, impassable, does not seal, carries the campfire's recipes with a larger
   light radius.** Without one impassable multi-cell structure, *nothing* exercises blocking across
   cells, walk-adjacent-to-a-footprint, or a footprint correctly failing to cut a room in two. It is
   also the exact case the campfire's `passable: false, blocksRoom: false` comment already argues for.

Then, as a **separate change in the same milestone** — not bundled into the footprint work:

4. **Sleeping colonists lie down.** Render-only, reading the `asleep` flag the snapshot already
   carries. The 2×1 bed is what gives it a head end to lie at.

## Tests — `tests/footprint.test.ts`

1. `cellsOf` for every rotation of a 2×1 and a 2×2; 0/2 and 1/3 agree on cells.
2. Placement refuses a footprint that is partly off-map, partly unstorable, or overlapping a
   building or a site — one cell of overlap is enough.
3. A 2×2 impassable building blocks all four cells.
4. That same building inside a hut leaves the hut **one** room, not two.
5. A pawn walks adjacent to a footprint and never onto it.
6. Deconstruct clears every cell and refunds once, not once per cell.
7. Marking one cell of a multi-tile building marks the whole footprint.
8. Save round-trip preserves rotation; mutating rotation changes `hashWorld`.
9. Migration: a v5 bedroll with a wall to its east comes back rotated, not overlapping.
10. Determinism unaffected — same seed, same ticks, same hash.

## Playable check

Place a bed, rotate it before committing, and watch two colonists deliver stone and raise it. Build a
hearth inside a hut and confirm the hut is still one room. Mark half the hearth and see the whole
thing tint. Deconstruct it and count the salvage. Save, reload, and get a bit-identical world.

## Also measured, not assumed

The pattern that has caught three milestones running is a constant tuned to the old map size. Two are
still unexamined and one is directly in this milestone's blast radius, because 2×1 bedrolls need more
room at the landing site than 1×1 ones did:

- `findLandingSite`'s search radius — 28 tiles, which was a meaningful fraction of a 128² map and is
  ~5% of a 512² one.
- `BUSH_DENSITY`.

Measure both, report both. If either is wrong it becomes a named item rather than a silent fix.

## Out of scope

- Non-rectangular footprints. A rectangle covers desks, beds, benches and tables; an arbitrary cell
  set is a generalisation nothing has asked for.
- Multi-tile *terrain* results. Floors stay 1×1.
- Building occlusion — M13 owns it, and it needs footprints to exist first.
- Tall buildings, roofs, and the `LEVEL_HEIGHT` reconciliation — M13, and a new ADR.
