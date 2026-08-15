---
name: art-pass
description: Use when drawing or improving a procedural sprite — terrain, buildings, items, plants, pawns, overlays. Covers the two ways art is made, the numbers that define the style, the review loop, and the geometry rules that silently break tile alignment.
---

# Drawing something

All art is generated in code from `src/render/art/`, cached by `ArtProvider`, and drawn from a
palette. There is no atlas and no artist — see [ADR 0010](../../../docs/decisions/0010-procedural-art.md)
for why, and for what would have to change for that to stop being true.

**The style is stated as numbers in `src/render/art/language.ts`.** Read that file, not this
paragraph, for the sun, the tone ramp, occlusion depth, bevel width, minimum feature size, standard
proportions and the material table. This document says how to *work*; that file says what the style
*is*. Numbers make the first attempt land closer, which is cheaper than making the fourth attempt land.

## Look at it with one command

```bash
npm run art
```

Writes `art/contact-sheet.png` — every sprite, every rotation, at 3×, over an outline of the footprint
cells it claims — plus one PNG per sprite and `report.json` with every measurement. Then just open the
sheet. **No dev server, no browser, no screenshot.** It also fails with a non-zero exit if anything
breaks its contract, so it is a check as well as a review surface.

`sprites.html` is the same manifest rendered live, for when you want reload-as-you-edit, the night
wash, or zoom. `filmstrip.html` is for animation.

**Never judge a sprite at play zoom.** Every art fault in this project's history was invisible there
and obvious within seconds on a sheet.

## Two ways to make a sprite

### Solids in tile space — prefer this for anything built

```ts
{ x0: 0.12, y0: 0.12, z0: 0, x1: 1.88, y1: 0.88, z1: HEIGHT.bed, material: 'wood', label: 'frame' }
```

`x` and `y` in **tiles** across the unrotated footprint, `z` in **storeys** (1.0 = `LEVEL_HEIGHT`).
The renderer does projection, face shading, material surface, contact occlusion and bevel. See
`model/buildingModels.ts`.

Read a model as a sentence about the thing — *a frame half a storey up on four posts, with a mattress
inset on it and a pillow at the head end.* Where the legs land in screen pixels at rotation 3 is the
renderer's problem, not yours.

Three things come free, and all three were bugs before:

- **Rotation.** Turning a model turns its coordinates. Four facings are one shape seen four ways.
- **Footprint containment.** A solid inside the footprint's tile range cannot project outside its
  diamonds. Not checkable-and-fixed — *not expressible*.
- **Depth ordering within the object**, because solids draw in the order you list them.

Three rules it does not give you:

- `rise / LEVEL_HEIGHT` is a **ceiling**. A solid above it projects off the top of its own frame. The
  harness fails on it rather than cropping silently.
- A face thinner than a pixel is dropped. If a part vanishes, it was under 1px thick.
- **A sideways offset is a downward offset too.** Screen y is `(x + y) × HALF_TILE_H`, so a part
  hung to one side of a pivot does not merely swing left and right as the model rotates — it swings
  *down* by `offset × TILE_H` pixels as well. A banner's cloth at an offset of 0.14 tiles dropped
  four and a half pixels at two of its four facings, onto a hem only seven pixels off the ground,
  and read as a sign lying against its own post. Any part offset in the ground plane needs clearance
  for the swing, or a smaller offset.

- **A horizontal surface hides everything under it, and by more than you expect.** A top face's
  diamond hangs `side × HALF_TILE_H` below its own plane — about twelve pixels for a chair seat,
  forty for a 2×1 shelf board — so anything shorter than that is inside its own top's silhouette.
  This cost M13 three sprites: a chair whose legs showed a one-pixel sliver at two corners, a shelf
  whose back panel was invisible behind its own boards, and a stool that read as a pancake. The
  answers are to **raise it** (`HEIGHT.seat` went 0.19 → 0.26 for the camera, not for anatomy), to
  draw it as a **body rather than legs** when it is too low to raise, or to put the detail on the
  **front face** where a shelf actually shows it. Reach for `npm run art` early here — the harness
  names the buried part.

### Hand-drawn vectors — for organic and tiling things

Pawns, plants, flames, cloth folds, terrain. Pixi `Graphics` in the sprite's own frame pixels. The
harness measures these identically, through `drawListFromGraphics`.

## The shared vocabulary

Applied consistently across pawns, items, plants and buildings:

1. **A lit edge on the sunward side, a shadow on the other.** For rounded masses use a *crescent*:
   draw the lit shape nudged up-and-right, then cut it back with the base tone so light survives only
   along the rim. Bushes and pawn heads use exactly this.
   **Check the crescent survives, and check what it was drawn on survives too.** The pawn's head
   crescent was covered outright by a hair ellipse at the same centre and a larger radius — and when
   M13 went to fix that "one-liner", the head underneath it turned out to be contributing **six**
   visible pixels, all of them chin, with both eyes painted straight onto the hair. The colonist had
   no face and had shipped that way for three milestones. Keep the crescent inset *inside* its own
   silhouette while you are there: the version that had been hidden all along reached half a pixel
   past the widest point of the head, and would have laid a stray lit mark beside the face the moment
   it became visible.
2. **A contact shadow.** Without it objects float. Ground-level shading where terrain meets something
   raised is `contactShadow.ts` and belongs to the ground, not the object.
3. **Two tones per form, not one** — and on a modelled surface, four. A chunk split into a lit and a
   shaded half reads as a lump with volume; filled flat it reads as confetti.
4. **One accent that says what it is.** The pillow on a bedroll, the relic strip on a door.

`sunwardBand` is a **single-tile** device. Pointed at a shape two tiles long it draws a band across
the middle instead of along the lit edge, and the crescent that replaces it must be **contained**
within the silhouette or it leaves a stray line lying beside the object.

## Rules that break things silently

- **A rim highlight must never go on anything that tiles.** Terrain is generated per tile with no
  knowledge of neighbours, so a lit edge on every rock draws a bright line between adjacent rocks — a
  seam grid over the whole mountain, which is what ADR 0002 exists to prevent. Same for a wall run.
  Use `sunwardBand` on an already-*inset* shape instead.

- **Marks must not escape the tile diamond.** In the diamond's own metric — x over `HALF_TILE_W` plus
  y over `HALF_TILE_H` — a mark of half-width `w` at inset `i` reaches `i + w / HALF_TILE_W`. Keep
  that under 1. Where a sprite genuinely leans over its own edge, declare `mayOverhang` in the
  manifest **with the measured figure**, so an increase still fails.

- **State the frame for anything a layer positions by assumption.** Art that fails to reach all four
  corners produces a *smaller* texture drawn offset; art that overshoots produces a larger one. The
  campfire appeared in the corner of its tile from this, and grass drew a dark seam above every tile.

- **Raised art is measured from the ground plane, not the top face.** They differ by `rise`.

- **Detail has to exist at a scale you can see.** Below `MIN_FEATURE` a mark is not a detail the
  player reads, it is one they have to already know about. Conversely *scattered* single-pixel marks
  read as static — grass blades had to be clumped into tufts before they read as vegetation.

- **Colours come from `palette.ts`.** Never a hex literal.

- **No `Math.random`, even here.** `render/` is outside enforcement rule 2, but art that redraws
  differently each run cannot be asserted on or diffed. Seed a hash, as `terrainArt` does per
  `(id, variant)` and `surface.ts` does per material.

## Soft gradients

Two things use them — light glows and contact shading — and both learned the same lesson: **stacked
translucent shapes quantise into visible contour rings.** Generate a canvas gradient instead
(`art/glow.ts`) and set `scaleMode = 'linear'`, because the nearest-neighbour sampling that keeps the
pixel art crisp will band a gradient. Additive light should peak below 1, or the core saturates to
white and erases whatever is emitting it.

The model renderer is the opposite case: it snaps every summed tone onto a ladder (`quantiseTone`).
The first modelled bed came out with **150 distinct colours across 1,740 pixels**, which is mud rather
than form. Pixel art gets its character from a small number of deliberate tones.

## Animation is reviewed as a filmstrip, never live

A still can be screenshotted. **An animation cannot** — the order cursor lasts 420 ms and every
attempt to catch it was a race against a tool round-trip. Several screenshots landed on empty frames,
which looks exactly like a feature that does not work.

Write the drawing as a pure function of normalised time, `draw(ctx, size, t)`, with no clock and no
state. Then sample it into a strip — see `filmstrip.html`.

- **Build against the filmstrip; hand the motion to a human.** Whether a shape is right is answered by
  a still. Whether the *movement* feels good is a judgement for the person directing the art.
- **Keep variants rather than overwriting them.** The first order cursor was "wrong" by the brief and
  better in practice, and it survived only because the alternative was added beside it. A conversion is
  where this matters most: the new thing is more *systematic*, which is not the same as better. Legacy
  drawings sit on the contact sheet as `— before` rows until the replacement is signed off.

## Add a sprite to the review surfaces

Add it to `src/render/art/manifest.ts` with a contract. That one edit reaches the tests, the bake and
`sprites.html` together. Before the manifest existed these were three separate acts and the second was
the one you could forget — which is how the sleeping pose reached the review page two milestones after
the buildings did.

## Finally

**Ask of any art problem: is this a measurement or a judgement?** Getting it wrong is expensive both
ways — hand-checking something a test could assert, or arguing about a number when the real question
is whether it looks right.

Then still look at it in the running game, at play zoom, in daylight and at night — **through a
scenario**, not by hand:

```
javascript_tool → await __scenario.capture('beds-all-rotations')
Read art/scenes/beds-all-rotations.png
```

See the `scenario` skill. Reaching one such picture by hand cost about twenty tool calls, six of them
spent persuading colonists to lie on the right bed. The debug panel (`` ` ``) is still the right tool
for *playing with* a change — skip to a time of day, hand out materials, place finished structures —
and no longer the way to *set one up*.

The harness catches geometry. It has nothing whatsoever to say about whether a thing reads as what it
is. That is your eyes, and for anything dynamic it is the user's.
