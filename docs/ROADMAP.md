# Roadmap

We build **vertical slices**. Each slice is playable and interesting on its own; each milestone inside
a slice ends at something you can look at and touch. The failure mode for a project this size is six
systems at 40% depth and nothing playable — slices are the defence against it.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Slice 1 — The colony spine ("a colony that survives a week")

Map, pawns, job scheduler, needs/mood, construction, save/load. This is the skeleton every later
slice hangs off.

### M0 — Skeleton
- [x] Vite + TS + React + Pixi scaffold
- [x] Enforcement rules: import firewall, no-`Math.random`, determinism test
- [x] Seeded RNG (sfc32) with serializable state
- [x] Fixed-tick loop decoupled from render, speed controls (pause/1x/2x/3x)
- [x] Command queue + `SimSnapshot` publisher
- [x] Tile grids, terrain defs, seeded worldgen (elevation / moisture / ruins)
- [x] Palette + `ArtProvider` procedural sprite generation
- [x] Viewport-pooled terrain rendering with culling, camera pan/zoom
- [x] Low-frequency tint field so large areas don't read as flat colour
- [x] Day/night wash — pulled forward from M1, because a ticking clock with no visual
      consequence made the HUD read as decoration
- **Playable check:** ✅ pan and zoom a colourful generated map at a stable 60fps.

### M1 — Pawns & movement
- [ ] Pawn entity + entity store
- [ ] Binary-heap A* on the walk-cost grid
- [ ] Connected-component reachability map, recomputed on wall change
- [ ] Movement toil, selection, click-to-move as a direct order
- [ ] Procedural layered pawn art (body / head / hair / apparel tint)
- [ ] Per-cell light grid, replacing M0's flat day/night wash (lamps, fires)
- **Playable check:** click a pawn, click the ground, they walk there and around obstacles.

### M2 — The job system *(the big one)*
- [ ] `WorkGiver` → `Job` → `JobDriver` → toils pipeline
- [ ] Reservation system (no two pawns on one target)
- [ ] **Hard preemption** — `interrupt(pawn, reason)` releases reservations cleanly
- [ ] Staggered pawn thinking (`tick % 30 === index % 30`)
- [ ] Work types: Construct, Mine, Haul, Cook, Clean + per-pawn priority grid UI
- [ ] Ground item stacks, stockpile zone painting, designation overlays
- **Playable check:** designate rocks; pawns mine and haul to a stockpile with zero further input,
  and never fight over the same rock.

### M3 — Needs, mood, survival
- [ ] Hunger + Rest needs with emergency job escalation
- [ ] Beds, campfire cooking
- [ ] Thoughts and mood, mental break ("sad wander")
- [ ] Alerts panel, pawn inspector (Needs / Gear / Work tabs)
- **Playable check:** a colony feeds and beds itself unattended for 3 in-game days.

### M4 — Construction & rooms
- [ ] Architect menu, blueprints, material delivery jobs, frames
- [ ] Walls, doors, floors
- [ ] Room flood-fill; indoors / beauty thoughts
- **Playable check:** draw a house; pawns haul materials and build it; sleeping inside lifts mood.

### M5 — Save/load & the survival test
- [ ] Serialization with version field + migration hook
- [ ] Main menu
- [ ] Headless `survive-a-week` regression test
- **Playable check:** save mid-game, reload, state hash identical.

---

## Later slices

Real, but not designed in detail yet. Each gets its own design pass when we reach it.

- **Slice 2 — Production.** Workbenches and bills, recipe chains, quality tiers, power grid.
  Delivers the *scrap → refined → relic-tech* ladder.
- **Slice 3 — Threat.** Combat, body-part injury model (`hediffs`), raids, an event director that
  paces pressure.
- **Slice 4 — The world outside.** World map, caravans, exploration of ruins, factions, trade.
- **Slice 5 — Command.** Squad selection, formations, orders, morale — the Bannerlord layer, riding
  on the preemption support built in M2.
