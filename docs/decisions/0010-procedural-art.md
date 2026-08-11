# 0010 — Procedural art, rasterized in TypeScript

**Status:** Accepted · 2026-08-11

## Context

`ArtProvider` was built in M0 as a door: *"a real artist's atlas can be dropped in behind this
interface later without a single change to layer or gameplay code."* M13–M15 are three milestones of
almost nothing but new sprites — the architect menu goes from four entries to roughly forty — so this
is the moment the door is either walked through or closed.

Two things were wrong, with different causes, and conflating them would have got the answer wrong.

**Judging art was expensive.** The loop was edit → dev server → browser → screenshot → squint. In M10
that cost several round trips per iteration, and seven art bugs still shipped. **Six of the seven were
measurements** — a self-intersecting polygon, ink a storey above its own footprint, a pose six times
longer than it was wide, a body covering half its bed, a head off the blanket twice, a lock bar with
two visible pixels. The seventh was *"the shading is an awkward line, hard to tell what it is supposed
to be"*, and no test will ever say that.

**Detail looked basic**, and not for want of skill. Measured: a bedroll was **five distinct colours**
across a 96×48 sprite, a door five across 64×48, a wall seven across 64×54 — three flat quads with two
course lines on them. Terrain does not have this problem, because it got a texture pass in M0
(`mottle`, `speckle`, `drawTufts`, twenty-six marks on a sand tile) and buildings never got an
equivalent. The deeper cause is that **the pipeline was vector-only**: ambient occlusion, dithered
ramps, per-face surface noise and silhouette bevels are not expressible as Pixi fills except by
emitting hundreds of tiny polygons. You could not get "formed" out of it by trying harder.

## Decision

**Art stays procedural, and gains a CPU rasterizer.**

1. Sprites are described as **solids in tile space** with materials — `x` and `y` in tiles, `z` in
   storeys — and rendered by our own code, which does projection, face shading, surface texture,
   contact occlusion and bevel.
2. That renderer emits a **draw list**, which a pure-TypeScript rasterizer turns into pixels. No GPU,
   no canvas, no DOM.
3. The rasterizer **ships**: modelled structures upload the exact buffer the tests measured.
4. Image generation is used **only as art-direction reference**. Nothing generated ships.

## Why not an artist's atlas

There is no artist, and hiring one does not fit the project. Not a principled objection — a factual one.

## Why not AI-generated sprites

Concretely, not in the abstract:

- **Alignment.** A 2×1 bed at rotation 1 must land its ink inside a 96×48 frame, on an exact ground
  line, inside the projected diamonds of the cells it claims. Every one of those is a number the
  harness checks and an image model has no way to be told.
- **Coherence.** Forty objects × four rotations must share one sun, one palette and one material
  vocabulary. In code that is a shared constant. In generated images it is luck, re-rolled per asset.
- **Multi-view consistency.** Four facings must be the same object. At 64 px this is where image
  models are weakest, and rotations 0 and 2 must additionally differ *only* in facing.
- **Reviewability.** A sprite that is code diffs, reviews, and regenerates. A PNG does not.

The decisive point is that **the geometry harness would reject nearly all of it**, and a pipeline whose
output routinely fails its own gate is not a pipeline.

## Why not model in an external tool

MagicaVoxel or Blender to a baked atlas is the industry-standard path and genuinely produces formed
results. Rejected because it costs an external binary in the workflow, non-code assets in the
repository, the loss of "a sprite is a diffable function", and a generation step no test can see
inside. The measured gap did not need a different *tool*; it needed surface, occlusion and a bevel,
which is about four hundred lines.

## Why the rasterizer ships rather than baking an atlas

Baking offline was the alternative and is still the fallback if startup cost ever bites. Shipping the
rasterizer wins on one property: **what the tests measure is what the game draws.** A harness that
measures a re-render of the same instructions can be green while the screen is wrong, which is the
exact failure this milestone exists to close. It also avoids a build artefact in git and the "you
changed the code and forgot to re-bake" failure mode.

## Consequences

**Measured, on the two structures converted:**

| | tones before | tones after |
|---|---|---|
| Bed (96×59) | 10 | 55 |
| Bedroll (96×48) | 5 | 38 |

**Two paths exist during the transition, deliberately.** Modelled structures rasterize on the CPU;
terrain, pawns, plants, items and overlays stay on `generateTexture`. M13 and M14 convert the rest as
they touch them. Nothing on the vector path changed by a pixel in M12, which is what keeps a
pure-infrastructure milestone from quietly restyling the game.

**The harness measures both paths**, through one `DrawList` abstraction — a check that ran on only one
of them would go quiet exactly when new art arrived.

**Rotation and footprint containment become correct by construction.** A solid inside the footprint's
tile range cannot project outside its diamonds, and turning a model is turning its coordinates. Two
of the seven shipped bugs are no longer expressible.

**`render/` may not use `Math.random`.** Not an enforcement rule — that one is about `sim/` — but
surface noise draws from a deterministic hash for the same reason `terrainArt` seeds per
`(id, variant)`: art that redrew differently each run could not be asserted on or diffed.

**The door stays open.** `ArtProvider` is untouched as an interface. An atlas can still be dropped in
behind it; this decision says only that nothing available today beats generating the art in code.

See `docs/superpowers/specs/2026-08-11-asset-pipeline-design.md` for the full design, and
`.claude/skills/art-pass` for how to draw something now.
