# 0007 — One continuous world

**Status:** Accepted · 2026-08-08

## Context

Slice 2 was going to end with a smelter and two recipes. It stopped being that when the design
conversation went up a level: the game is an **open frontier you walk across** — a colony you can
leave, places worth travelling to, ruins holding the one tier you cannot manufacture. See
[`design/00-vision.md`](../design/00-vision.md).

That asks the codebase a question it has never been asked. Every system says `world.map` and means
*the* map: one 128×128 grid, generated once, serialized whole. Reachability floods it, A\* searches
it, work givers scan everything on it. **"Somewhere else" has no representation at all.**

Three shapes were on the table, and the choice had to be made before any of M7–M10, because it
decides what "explore" means and how much of the current map code survives.

## Decision

**One continuous map, grown to 512×512, with no streaming.** The colony, ruins, camps and towns all
sit on it in a single coordinate space. You can see the place you are walking to.

512² is 262,144 cells — sixteen times the current area. On foot that is roughly a quarter of an hour
to cross, which is the pacing the Kenshi comparison implies.

### Why 512² and not 1024²

Because the ceiling is set by the flood fill, not by memory. Measured on this machine, generating
each map and forcing one full reachability rebuild:

| Map | Cells | Worldgen | Reachability rebuild | Save (JSON) |
|---|---|---|---|---|
| 128² | 16K | 5.4 ms | 2.7 ms | ~~28 KB~~ |
| 256² | 65K | 10.8 ms | 12.0 ms | ~~114 KB~~ |
| 512² | 262K | 38.5 ms | 63.7 ms | ~~475 KB~~ → **294 KB** |
| 1024² | 1.05M | 154 ms | 194.7 ms | ~~1.9 MB~~ → **1,131 KB** |

Worldgen and save size scale linearly and are both affordable — worldgen happens once behind a
loading screen, and even the corrected figures sit comfortably inside a `localStorage` budget.

> **The save column was invalidated by the very next commit, and nobody noticed for six
> milestones.** These numbers were measured against *this* commit's worldgen —
> `elevationScale: 1/26`, `moistureScale: 1/19`, no biome or wreckage fields. M7 (`bd46e95`)
> lengthened those wavelengths to 1/70 and 1/40 in the same commit that copied this table into
> `ROADMAP.md`, and that retune roughly **halved the terrain run count** (42,485 → 21,875 at
> seed 1, 512²) — which is precisely what turned a mottled map into a regional one. RLE size is
> a function of run count, so the figure fell with it. Re-measured in Slice 4's Task 0 with
> `tools/measureLevels.ts`; the save format is byte-identical between then and now, so this is
> the terrain change and nothing else. *Fourth* instance of the pattern this project is now
> four-for-four on: a constant measured once, at a scale that then moved.
>
> **The reachability column is correctly historical** and is left alone — it is why chunking
> exists, and it was measured against the same pre-retune world on purpose.

The rebuild column is the problem, because it is not a one-off. `ReachabilityMap` re-floods **every
component in the map** whenever `markDirty()` fires, and terrain changes constantly during ordinary
play: five colonists mining produce **13 terrain changes per in-game hour**, roughly one every three
seconds of real time at 1x and one per second at 3x. At 512² that is a 64 ms stall on that rhythm.
At 1024² it is 195 ms — a third of a second, repeatedly, forever.

So 512² is not a compromise on ambition. It is the size at which the *existing* algorithm is merely
bad rather than fatal, which makes fixing it a measured improvement instead of a prerequisite. The
number moves up once reachability is incremental.

### The door to an endless world stays open, and holding it costs nothing

Chunk-streaming is deliberately *not* built, but nothing may foreclose it. Compare
[ADR 0003](0003-verticality.md), where verticality was reserved by widening `TilePos` up front: that
reservation bought a **field**. This one buys a **habit**, and the distinction matters because it is
the reason this is cheap:

- **Positions are global world coordinates.** Nothing introduces a region-local or chunk-local
  coordinate space. A cell's address is its address everywhere in the codebase.
- **Terrain is reached through `TileMap`,** never by indexing its arrays from outside.

Hold those two and chunking later is a change to how `TileMap` stores its bytes — a storage change
behind an unchanged interface. Break either and it becomes the rewrite that reserving `z` was meant
to avoid.

What is explicitly **not** reserved: simulation LOD, hierarchical pathfinding, and per-region saves.
Those arrive with streaming or not at all, and pretending to reserve them would be paying for
machinery we cannot yet specify.

## Why not the alternatives

- **An abstract overworld with generated local maps** (RimWorld, Bannerlord). By far the cheapest:
  almost every line of current map code survives untouched, and travel is a progress bar rather than
  a pathfinding problem. Rejected on the **design goal, not the cost.** The vision's whole thrust is
  that things in this world are particular things — a specific ruin in a specific valley, not an
  instance of `ruin`. An abstraction layer between the player and the ground is precisely the
  machine that dissolves particulars back into types, and travel becomes a loading seam where the
  map you fight on is not the map you looked at.
- **A chunk-streamed endless world now** (Minecraft, Kenshi proper). The complete answer, and a
  large machine — hierarchical pathfinding, simulation LOD, streaming saves — built *before* we know
  the loop is fun. It is also strictly the big map **plus** a loader, so building the big map first
  is a stepping stone rather than a detour. If the world should be endless, we will have learned it
  from a world we can already walk across.

## Consequences

- **Reachability must stop re-flooding the whole map.** It is now the binding constraint on world
  size, and it is called from inside the work-giver loops, so the stall lands in the middle of the
  AI sweep rather than somewhere the player could forgive it. Whatever replaces the full rebuild
  must keep using `canStep` — shared with A\* — or reachability starts promising routes A\* cannot
  deliver and pawns re-plan forever.
- **Worldgen must produce regions, not per-cell noise.** `pickBaseTerrain(elevation, moisture)`
  decides each cell independently. At 128² that reads as texture; at 512² it reads as static. A
  world worth crossing has to be made of *places that differ*, which is a worldgen redesign, not a
  scale factor.
- **Linear scans are not yet a problem, and the measurement says so.** A five-colonist colony ticks
  in 29 µs at 512² against a 16,667 µs frame budget — up from 5 µs at 128², and still three orders
  of magnitude clear. `lookup.ts` stays a known gap rather than becoming M7 work. It will matter
  when item counts grow, not because the map did.
- **Determinism pays off here rather than merely holding.** A generated continent is only something
  we can discuss, tune, and bug-report because seed *S* produces the same world on every machine.
  The no-`Math.random()` rule was written for save/load and turns out to be what makes a procedural
  world tractable.
- **The landing-site chooser gets a much larger search space**, and its known bias — maximising open
  storable ground walks it away from rock — will show up harder at this scale. Not addressed here.
