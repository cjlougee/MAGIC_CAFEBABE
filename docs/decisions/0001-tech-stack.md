# 0001 — TypeScript + PixiJS, with a pure simulation core

**Status:** Accepted · 2026-08-01

## Context

We need an engine for a long-lived colony sim built collaboratively between a solo developer and an AI
agent. The dominant constraint is **iteration speed of that pair**, not raw engine capability — a
colony sim's performance envelope (250×250 tiles, ~20 pawns) is modest by modern standards, but the
project's size means a slow feedback loop compounds into failure.

Candidates considered: Godot 4 + C#, C# + MonoGame, Rust + Bevy, TypeScript + PixiJS.

## Decision

**TypeScript + PixiJS v8**, with a strict architectural firewall: the simulation core is plain
TypeScript that imports nothing from the renderer, UI, or DOM.

React renders UI as a DOM overlay above the Pixi canvas. Vite for build, Vitest for test.

## Why

- **The agent can see the running game.** Browser tooling lets it start the dev server, screenshot the
  result, click through it, and read the console. On the alternatives the agent writes code semi-blind
  and hands it over for a human to run. That verification loop outweighs every other difference.
- **The pure core is trivially testable.** A headless harness can fast-forward seven in-game days and
  assert the colony survived — the highest-value regression test available for this genre, and it only
  exists because the sim has no rendering dependency.
- **Determinism is achievable.** Fixed tick, seeded RNG, plain-data state. Save/load becomes
  serialization, and bugs become reproducible from a seed.
- **UI in the DOM is a large, free win.** Colony sims are UI-heavy (work grids, inventories,
  inspectors, bill configuration). HTML gives layout, scrolling, and text rendering for nothing.

## Consequences

**Accepted costs:**

- Performance ceiling is lower than a native engine. Mitigated by flat typed-array grids for hot data,
  chunked render textures, and a per-tick pathfinding budget. Not a limit we hit at target scale.
- We hand-roll systems an engine would provide (camera, tilemap chunking, lighting).
- Shipping to Steam requires wrapping in Tauri or Electron. Deferred; not needed until there is a game.

**Bought:**

- The firewall means the renderer is replaceable without touching gameplay code. If the web renderer
  ever becomes the binding constraint, we swap the presentation layer, not the game.

## Alternatives rejected

- **Godot 4 + C#** — better raw engine, but the editor/scene-file workflow is one the agent cannot
  drive or visually verify, which slows the core loop this project lives or dies by.
- **C# + MonoGame** — RimWorld's own lineage and excellent performance, but everything including the
  entire UI layer is built from zero, giving the longest time-to-first-fun and still no visual
  verification loop.
- **Rust + Bevy** — compile times and immature UI tooling both work directly against iteration speed.
