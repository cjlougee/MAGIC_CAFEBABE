# M12.5 — The scenario harness

**Design, 2026-08-13.** Debugging tooling. Judged on whether checking a gameplay state stops costing
twenty round trips.

## The problem, measured

Verifying one change — *is a sleeping colonist positioned correctly on a bed?* — cost about twenty
tool calls:

| Calls | Spent on |
|---|---|
| ~6 | Placing a bed: debug panel, *Place finished*, Build menu, Bed, two clicks |
| ~6 | **Persuading colonists to choose the raised bed over a bedroll** |
| ~4 | Reaching night and a sleep cycle: skip, simulate, skip, simulate |
| ~8 | Screenshots, most of them re-framing |

Only the last few had anything to do with the question. Six were spent on colonist preference, which
was not under test at all.

**The debug panel is not the fix.** It is a *UI*, and every UI interaction is a round trip; adding
buttons makes it a nicer UI and barely moves the cost. The failure is that the only way to reach a
game state is to play the game into it.

**And the fast path already exists, unused.** `src/sim/` is pure, headless and fully constructible
from TypeScript — enforcement rule 1's whole payoff — and the tests already exploit it to fast-forward
seven in-game days. Any world can be built instantly, with no clicking and no waiting for sim time.
What is missing is a way to get a *picture* of one.

M12 built most of the other half: a rasterizer that turns a draw list into pixels headless, and a PNG
writer. `npm run art` → `Read` is the loop that worked all day. This applies the same loop to worlds
instead of sprites.

## Decisions

| Fork | Decision |
|---|---|
| Renderer | **Real renderer first**, captured to disk. Headless second, once the scene graph is extracted. |
| Regression | **Look-at-it only.** No golden images: M13–M15 are almost entirely intentional art changes, and a golden that fails on every one of them trains people to regenerate without looking. |
| Timing | **Now, before M13** — the milestone with the most "show me a room with furniture and people in it" in the roadmap. |

## Design

### A scenario is a function that builds a world

```ts
export const bedsAllRotations: Scenario = {
  name: 'beds-all-rotations',
  about: 'A bed at each rotation, a colonist asleep in each, at night',
  build(s) {
    for (const r of ROTATIONS) {
      const bed = s.place(Building.Bed, { x: 6 + r * 5, y: 8 }, r);
      s.sleeperIn(bed);
    }
    s.timeOfDay('night');
  },
  frame: { fit: 'contents', zoom: 2.5 },
};
```

Plain TypeScript in `src/scenarios/`, versioned and reviewable like any other code.

### Skip the decision, not the transition

The load-bearing verb is `s.sleeperIn(bed)`, and it must be built the right way round.

**Skip the AI's decision** — whether a colonist wants that bed, whether they walk there, whether it is
night enough. That is what cost six calls and it is never what is under test.

**Do not skip the state transition.** `sleeperIn` calls the same mutator the game calls when a
colonist actually goes to bed; it does not hand-set `asleep` and `spot`. A scenario that reaches a
state by a route the game cannot take shows a picture of something that cannot happen — which is the
same failure as a contact sheet that disagrees with the layer, and that one shipped a bug this week.

The rule, stated once: **a scenario forces outcomes through the game's own mutators, and skips only
the AI that would have chosen them.**

The same applies to placement. `s.place` goes through `canPlaceFootprint` rather than stamping the
grid, so a scenario cannot quietly produce a world the simulation considers broken — a pawn on an
impassable cell, or a sealed enclosure with no door.

### Scenarios start from a flat fixture world

The debug room. Known terrain, no lakes, no trees occluding, fixed seed, landing site in the middle.
`s.flat(32)` by default; `s.generated(seed)` when terrain is the point. Worldgen randomness is noise
in a picture whose subject is a bed.

### Loading reuses the path that already exists

`Engine.regenerate(seed)` is already a correct "replace the world" path: it dispatches through the
command queue, drops the selection, bumps `worldEpoch` so the minimap cannot show a world the player
has left, tells the renderer, and refocuses the camera. `Engine.loadScenario(name)` mirrors it step
for step.

The world is built **outside** the simulation and handed in through `Simulation.install(world)`, which
mirrors the existing `Simulation.load(save)`: drain the queue, then swap `worldState`. Saves already
arrive whole from outside by that route, so scenarios are its second caller rather than a new
mutation path — and the alternative, a command carrying an entire `World`, would be stranger than the
thing it was avoiding. Draining first matters: a command queued against the outgoing world would
otherwise land on its successor, addressing entity ids that mean something different there.

### Capture writes a full-resolution PNG to disk

A dev-only Vite middleware accepts `POST /__capture?name=…` and writes `art/scenes/<name>.png`. The
page extracts with `renderer.extract.canvas()`, which reads the framebuffer rather than compositing a
window — so it should survive the pane-not-displayed failure that made screenshots impossible for part
of this week.

**That assumption is verified before anything is built on it**, exactly as Pixi-under-vitest was in
M12. If it does not hold, the fallback is to bring the headless renderer forward instead.

**Result (2026-08-13):** `canvas.toBlob` on the live WebGL canvas returned **18,703 bytes** at
966×1030, with all 100 sampled centre pixels opaque. So the plain DOM-canvas path works and Pixi's
`extract` is not needed for the pixels — the drawing buffer survives present.

**What this does *not* prove**, stated plainly because the distinction is the whole risk: the pane was
*displayed* during that check. Reading the canvas does not depend on the window being composited, but
`requestAnimationFrame` **does** get throttled or suspended in a hidden tab — so a capture that waits
on rAF could hang precisely when it is needed most. The mitigation is not to wait on rAF at all:
force a synchronous `renderer.render(stage)` before reading, and treat any frame wait as a race
against a timeout. That costs three lines and removes the only part of this that was ever in doubt.

### The API

```ts
window.__scenario = {
  list(): string[];
  load(name: string): void;
  capture(name?: string): Promise<string>;   // load if named, draw a frame, extract, POST, return path
};
```

`capture()` with no argument grabs whatever is currently on screen — which is what makes the manual
protocol below cheap: you set something up by hand, I take a full-resolution still of it in one call.

**The loop becomes two calls:**

```
javascript_tool → await __scenario.capture('beds-all-rotations')
Read art/scenes/beds-all-rotations.png
```

### Dev-only

The middleware exists only under `apply: 'serve'`; `window.__scenario` is behind `import.meta.env.DEV`.
Names are sanitised to `[a-z0-9-_]`, the body size is capped, and writes are confined to `art/scenes/`.
It ships nowhere.

### Headless comes second, with no rework

Scenarios touch only `src/sim/`, so they are already renderer-agnostic. The later step is extracting
`buildSceneGraph(world, view) → DrawCommand[]` out of `ObjectLayer`, so the Pixi layer and a pure-TS
compositor consume one list and cannot disagree about placement. That extraction is the structural fix
for the bug class caught this week, and is worth doing on its own merits — the layer is currently
untestable.

### The manual protocol, effective now

Not everything should be a scenario. When a question is genuinely dynamic — feel, timing, performance,
whether an animation reads — I write a short numbered setup and hand it over rather than burning
calls, then use `capture()` on the result. I will also just ask when a scenario would cost more than
it saves.

## Files

**New:** `src/scenarios/` (builder, fixture world, registry, starter scenarios) ·
`src/app/scenarioMode.ts` (dev-only `window` API) · a capture middleware in `vite.config.ts`

**Modified:** `src/app/engine.ts` (`loadScenario`, mirroring `regenerate`) · `.gitignore`
(`/art/scenes/` is generated) · `CLAUDE.md`, `docs/ROADMAP.md`

**Reused, not rebuilt:** `Engine.regenerate`'s replacement sequence · `canPlaceFootprint` from
`sim/world/placement.ts` · the sim's own sleep/carry/need mutators · `tools/png.ts` is *not* needed —
the browser encodes the PNG.

## Verification

1. **First, before building anything else:** confirm `renderer.extract.canvas()` produces a correct
   image with the Browser pane hidden. This is the load-bearing assumption.
2. `npm run check` stays green; the harness adds no production code paths.
3. Capture `beds-all-rotations` and read it — four rotations, four sleepers, one image, two calls.
   If that is not obviously pleasant, the milestone has not landed.
4. Re-run the M12 sleeper check through a scenario rather than by hand, and compare the call count
   against the twenty this spec opens with. That number is the milestone's whole justification.
5. Confirm a scenario cannot build an illegal world: attempt to place a structure on water and on an
   occupied cell, and check it is refused rather than stamped.

## Risks

- **A scenario that lies.** Mitigated by routing through the game's own mutators, above. This is the
  single most important property; a fast harness showing impossible states is worse than no harness.
- **`extract` cost on a large stage.** The stage is culled to the viewport, so this should be
  bounded — but it is measured rather than assumed.
- **Scenario rot.** Scenarios reference building ids and world APIs and will break as those move.
  Acceptable: they are dev fixtures, they live in the repo, and a broken one fails loudly at load.
  They are deliberately *not* wired into `npm run check`, so they cannot become a maintenance tax on
  unrelated work.

## Notes for the surrounding docs

### Skills

- **New: `scenario`** — how to reach a game state worth looking at. When to write a scenario versus
  when to hand setup to the user; the force-the-outcome-not-the-field rule; the capture loop; the
  fixture world. Written *after* the first few real scenarios exist, on the M12 precedent that
  `add-work-type` and `art-pass` were both written from mistakes actually made rather than predicted.
- **Expand `art-pass`** — its closing section still says "look at the running game, press `` ` `` for
  the debug panel". That becomes "capture a scenario", with the debug panel demoted to the manual
  fallback.
- **Expand `add-work-type`** — one line: a new work type deserves a scenario showing the job actually
  running, because "the pawn does the thing" is exactly the kind of dynamic claim a screenshot cannot
  support.

### CLAUDE.md

- Generalise **"Looking at art costs one command"** into **"Looking costs one command"**, covering both
  `npm run art` for sprites and `__scenario.capture` for game states.
- Add `src/scenarios/` to the layout.
- Add the invariant: **a scenario forces outcomes through the game's own mutators and skips only the
  AI that would have chosen them.** A scenario that reaches a state by a route the game cannot take is
  showing a picture of something that cannot happen.
- Demote the debug panel section: it stays the right tool for *playing* with a change, and stops being
  the recommended way to *set up* one.
