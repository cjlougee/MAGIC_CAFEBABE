# M12 — The asset pipeline

**Design, 2026-08-11.** Process, not content. Judged on M13 costing visibly less per sprite than M10 did.

## The problem, measured

M13–M15 are three milestones of almost nothing but new sprites. Two things made that a bad prospect.

### Judging was the expensive half

Seven art bugs shipped across M10 and M11 and every one was caught late, by eye:

| Bug | Measurable? |
|---|---|
| `isoCapsule` drew a self-intersecting bow-tie for two of four facings | yes — self-intersecting polygon |
| Hearth drawn a whole storey above its own footprint | yes — ink misplaced vs the stated frame |
| Sleeping pose six times longer than it was wide | yes — aspect ratio |
| Sleeping body covered half the bedroll | yes — extent vs the bed's footprint |
| Head floated outside the blanket silhouette (twice) | yes — ink detached from what it rests on |
| Lock bar drawn behind the near jamb, two visible pixels | yes — occluded ink |
| Door's relic caps read as two glowing pillars | **no — taste** |

Six of seven were measurements. The review loop was edit → dev server → browser → screenshot →
squint, several round trips per iteration. During this milestone's own design pass the screenshot leg
failed outright, which is the argument in miniature.

### Detail was basic, and the cause was structural

Measured tone counts before any change: **bedroll 5** across 96×48, **door 5** across 64×48, **wall 7**
across 64×54 — three flat quads with two course lines. Terrain does not have this problem because it
got `mottle` / `speckle` / `drawTufts` in M0 and buildings never got an equivalent.

The deeper cause: **the pipeline was vector-only.** Occlusion, dither, per-face noise and bevels are
not expressible as Pixi fills except as hundreds of tiny polygons. Trying harder could not fix it.

## What was proven before designing

- Pixi 8 builds a `Graphics` in **plain Node** — no GPU, canvas or DOM. `context.instructions` is the
  painter-ordered draw list; every shape answers `contains` and `strokeContains`.
- A 25-line rasterizer over that rendered all six buildings in **7 ms**, and on first run flagged the
  bed's two far legs as contributing zero visible pixels — the lock-bar signal, on art where the
  burial is deliberate. Which is why contracts are per-sprite.
- `vite-node` ships with vitest; `BufferImageSource` constructs headlessly. **Zero new dependencies.**

## Decisions

| Fork | Decision |
|---|---|
| Authoring | **Solids in tile space** plus materials. Describe the object, not its picture. |
| Runtime | **The rasterizer ships.** Tests measure the bytes the game draws. |
| Scope | **Substrate plus Bedroll/Bed.** M13/M14 convert the rest as they touch them. |
| Atlas | **Procedural.** Image generation as art direction only — see [ADR 0010](../../decisions/0010-procedural-art.md). |

## Architecture

```
src/render/art/
  language.ts        the design language as NUMBERS — sun, ramp, AO, bevel, proportions, materials
  manifest.ts        every sprite, with the contract it promises
  model/
    project.ts       tile space → frame pixels, and the quarter turns
    solids/render.ts solids → faces → draw list, with surface, occlusion and bevel
    surface.ts       per-pixel material texture from a deterministic hash
    buildingModels.ts the structures described as objects
  raster/
    drawList.ts      the intermediate form: ordered marks with per-pixel paint
    raster.ts        draw list → RGBA + an OWNER map
    fromGraphics.ts  Pixi Graphics → draw list, so existing art is measurable unchanged
    measure.ts       the measurements the assertions are built on
    footprintMask.ts where ink is allowed to be
    geometry.ts      self-intersection, on the outline
    toTexture.ts     RGBA → Pixi texture
tools/
  bakeArt.ts         npm run art
  png.ts             RGBA → PNG over node:zlib
  tinyFont.ts        3×5 bitmap font for sheet labels
```

**One draw list, three consumers.** `tests/art.test.ts` asserts on it, `npm run art` bakes it,
`sprites.html` renders it live. The `owner` map — which mark last covered each pixel — is what every
occlusion question is answered from.

## The contracts

Two levels, because the shipped bugs split cleanly along them.

**Sprite contracts** — ink versus its own frame: containment, ground line, aspect bounds, declared
hidden marks, rotation pairs that must differ or match.

**Placement contracts** — the sprite versus the world cells it claims. The hearth-a-storey-up bug and
the sleeping-pose bug are *both* placement, and no sprite-level check would ever have caught either.

**A review surface must not compute the answer its own way.** The composed "sleeper on a bed" scene
originally derived its offset from the sprite frame, whose top already carries `-rise`, while
`ObjectLayer` placed the sleeper on the ground plane. Same intent, expressed twice, differing by
exactly a bed's 11px — so the sheet showed a colonist lying neatly on a bed while the game drew one on
the floor underneath it with their head off the end. A bedroll's 3px made the same error nearly
invisible, so it read as *"beds are broken, bedrolls are fine"*.

`src/render/placement.ts` now owns every question of the form *"given this building, where does that
draw"*, and both callers use it. A picture that disagrees with the game is worse than no picture,
because it is trusted.

Exceptions are **declared with a reason and an exact count**, never tolerated:

- Bed: `mayHide: { count: 2 }` — the far leg is entirely behind the frame, and which leg that is
  changes with rotation while the count does not. Exact equality makes it a ratchet both ways.
- Door: `mayOverhang: 0.16` — the jambs are centred *on* the tile's edge vertices because a door
  continues the wall run it interrupts. Measured at 13%.
- Campfire: `mayOverhang: 0.06` — the stone ring is an ellipse inscribed in a diamond. Measured at 4%.

## Results

**Tones per sprite**, same ink area:

| | before | after |
|---|---|---|
| Bed | 10 | 55 |
| Bedroll | 5 | 38 |

**The review loop**: `npm run art` → `art/contact-sheet.png`. One command, one image, 49 sprites in
~180 ms. No dev server, no browser, no display.

**The harness fires.** Four historic bugs were deliberately reintroduced and each failed a named
assertion with a number: hearth up a storey (*"1232px (24.6%) of ink lies outside a 2x2 footprint"*),
the bow-tie capsule, the head off the blanket (*"only 0 of 34 head pixels touch the blanket"*), the
pillow at the wrong end (*"the pillow sits 32.1px from the head cell (0,0) and 10.9px from the foot"*).

**666 tests**, up from 454.

## What the harness found on its own

- **The pawn head's sunward crescent is drawn and then covered outright by hair.** It contributes
  *zero* pixels on three of five hair styles and under 16 on the other two. The shape language's own
  worked example, invisible on the most-looked-at sprite in the game. Recorded, scheduled for M13.
- The bed's code comment said "the two at the back" are hidden. Measured: one whole leg and most of
  another — and once leg tops were correctly suppressed, exactly one leg.
- Three hex literals in `buildingArt.ts` outside the palette.

## Non-goals

Terrain, pawns, plants, items and overlays stay on the vector path — measured by the harness, not
redrawn. `filmstrip.html` untouched. No new sprites: M13 creates the forty.

## Known risk

A generic renderer can make everything look like grey boxes, which is worse than hand-tuned art. The
material system is the mitigation rather than a garnish, and the legacy drawings stay on the contact
sheet as `— before` rows until M13 signs the models off.
