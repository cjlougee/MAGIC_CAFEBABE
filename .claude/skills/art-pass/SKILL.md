---
name: art-pass
description: Use when drawing or improving a procedural sprite — terrain, buildings, items, plants, pawns, overlays. Covers the shared shape language, the one light direction, and the geometry rules that silently break tile alignment.
---

# Drawing something

All art is generated in code from `src/render/art/`, cached by `ArtProvider`, and drawn
from a palette. There is no atlas and no artist. What makes it hold together as one style
is not detail — it is that everything obeys the same few rules.

Written after the M6 art pass, from the mistakes it actually made.

## The one sun

**Light comes from the upper right, for everything.** This is the single most valuable
thing in the whole style, because it is what makes unrelated procedural shapes look like
they share a world.

- Isometric faces: `LEFT_FACE_SHADE` / `RIGHT_FACE_SHADE` in `isoShapes.ts`.
- Everything else: `LIT_SHIFT` / `SHADED_SHIFT`, same file.

Never shade a form symmetrically. Colonists had identically-shaded arms and read as flat
tokens standing on a lit map; giving one side the light fixed them in four lines.

## The vocabulary

Applied consistently across pawns, items, plants and buildings:

1. **A lit edge on the sunward side, a shadow on the other.** For rounded masses use a
   *crescent*: draw the lit shape nudged up-and-right, then cut it back with the base
   tone so light survives only along the rim. Bushes and pawn heads use exactly this.
2. **A contact shadow.** A flat ellipse under anything that stands on the ground. Without
   it objects float. Ground-level shading where terrain meets something raised is
   `contactShadow.ts` and belongs to the ground, not the object.
3. **Two tones per form, not one.** An item chunk split into a lit and a shaded half
   reads as a lump with volume; the same chunk filled flat reads as confetti.
4. **One accent that says what it is.** The pillow on a bedroll, the relic strip on a
   door, the crossed logs in a campfire.

## Rules that break things silently

- **A rim highlight must never go on anything that tiles.** Terrain textures are
  generated per tile with no knowledge of neighbours, so a lit edge on every rock draws a
  bright line between adjacent rocks in one mass — a seam grid over the whole mountain,
  which is what ADR 0002 exists to prevent. Same for a run of walls. Use `sunwardBand` on
  an already-*inset* shape instead (a wall's cap), so unlit border separates it from the
  next tile.

- **Marks must not escape the tile diamond.** Textures are cropped to the Graphics'
  bounds, so a mark in a bounding-box corner lands outside its tile and over the
  neighbour. In the diamond's own metric — x over `HALF_TILE_W` plus y over
  `HALF_TILE_H` — a mark of half-width `w` at inset `i` reaches `i + w / HALF_TILE_W`.
  Keep that under 1.

- **State the frame for anything a layer positions by assumption.** `ArtProvider` passes
  an explicit `Rectangle` for terrain and buildings because the layers place them assuming
  exactly `TILE_W x (TILE_H + height)`. Without it, art that fails to reach all four
  corners produces a *smaller* texture drawn offset, and art that overshoots produces a
  larger one — the campfire appeared in the corner of its tile, and grass drew a dark seam
  above every tile, both from this.

- **Raised art is measured from the ground plane, not the top face.** They differ by
  `height`. The top face occupies y ∈ [0, TILE_H] and the footprint sits `height` lower.

- **Detail has to exist at a scale you can see.** A 2px mark is below what the eye
  integrates over at play zoom; a hundred of them average back to the base colour and the
  surface reads as flat. Vary at roughly a third of a tile (`mottle`) and let fine speckle
  serve the close-up view. Conversely, *scattered* single-pixel marks read as static —
  grass blades had to be clumped into tufts before they read as vegetation.

- **Colours come from `palette.ts`.** Never a hex literal in a layer or a component.

## Soft gradients

Two things use them — light glows and contact shading — and both learned the same lesson:
**stacked translucent shapes quantise into visible contour rings.** Generate a canvas
gradient instead (`art/glow.ts`), and set `scaleMode = 'linear'` on it, because the
nearest-neighbour sampling that keeps the pixel art crisp will band a gradient.

Additive light should peak below 1, or the core saturates to white and erases whatever is
emitting it.

## Finally

**Look at it, at play zoom, in daylight and at night.** Press `` ` `` for the debug panel
— skip to a time of day, give yourself materials, place finished structures. Every art
fault in this project's history was invisible to tests and obvious within seconds of
looking: a campfire in the corner of its tile, a white spotlight instead of firelight,
banding rings, dark wedges in tile corners, seams above grass.
