# Backlog

Work that is wanted and not yet scheduled. Separate from [`ROADMAP.md`](ROADMAP.md) on purpose: the
roadmap is a small number of milestones in a committed order, and burying a seventeen-item wish list
inside it would make the next thing to do harder to find, not easier.

**This replaces M10.** The crafting ladder was going to be next; the detail work below matters more
to whether the game is worth playing, and much of it wants thinking through before any of it is
built. Relic-tech recovery, the refined tier, and pawn skills are still wanted and now live in
[Unscheduled, still wanted](#unscheduled-still-wanted) at the bottom rather than in a numbered
milestone.

Items keep the numbers they were raised with, so they stay easy to refer to. Grouping is ours;
the notes under each are what the current code already has to say about it.

---

## Interaction and UI

**1. Drag the minimap.** Click currently jumps the camera; dragging should scrub it. The minimap
already converts screen position to tile position for its click handler, so this is a pointer-move
handler over the same maths — small, and the first thing anyone tries.

**2. Select a wall or door directly, with a red ✕ to flag it for deletion.** Deconstruction exists
as a *drag-a-rectangle designation* only, which is fine for clearing an area and clumsy for one
misplaced wall. Wants: buildings as click targets (pawns and benches already are), a small panel
for the selected structure, and the existing `Designation.Deconstruct` behind the button.

**4. Toolbar review.** A visual menu showing item sprites, and a build menu organised into
categories. The current toolbar is a flat row of text buttons and the architect list is one
undivided list of `BUILDABLE_DEFS` — it works at four buildables and will not at forty. Sprites are
already generated procedurally, so the art for this exists; it needs a way to render one into DOM.

## Doors, buildings, and what is inside them

**3. Doors that look and act like doors.** Today a door is a passable square that seals a room, and
nothing about it reads as a door. Wants a real sprite in the frame of the wall, a style submenu
*before* placing, and states: leave open, closed, locked. Note that `buildingSealsRoom` and
`buildingBlocks` are already separate flags precisely because a door is both walkable and a room
edge — the data model is ready; the art and the states are not.

**8. Buildings that look like buildings.** More than one block tall, windows, awnings, lights,
ornamentation, roofs. Brick versus wood versus scrap. A hovel should not be a shorter skyscraper.
This is the largest visual item on the list and it collides with the projection: anything tall
occludes what is behind it, which is why terrain relief was kept deliberately modest. It also wants
`LEVEL_HEIGHT` reconciled against decorative relief — see ADR 0003.

**9. Things that go in buildings.** Chairs, desks, tech, supplies, weapons, safes, messages,
furniture, carpet, lighting. A room that is four walls and a floor is a box; the contents are what
make it somewhere. Carpet is a surface (`setSurfaceAt` handles it today); the rest are buildings or
items with a footprint.

**6. Multi-tile items.** Already flagged in the roadmap as deserving its own milestone rather than
being polish: placement legality, `buildingBlocks` and `buildingSealsRoom` across several cells,
which cell a pawn reserves and walks to, room flood-fill, save shape, and deconstruct all currently
assume one building occupies exactly one cell. Note that **8 and 9 both need this** — a desk is not
one tile — so it is likely the gate on that whole group.

## The world itself

**5. Small details.** Biome-specific flora and fauna, rocks, trees, flowers, hidden caches,
abandoned objects. A diversity of items rather than four. Random scrap lying on the map.
Biomes exist as of M7 and currently change only terrain; they are the natural place to hang
"what grows and lives here". Hidden caches are the cheapest possible reward for exploring and
would give M8's places something to *contain*.

**7. Terrain.** Ditches, hills, valleys, caves, mountains, plains, ocean, beach. Some of this is
biome tuning on what already exists; ditches, hills and caves are **verticality**, which is
reserved but not built (ADR 0003) and is the single biggest structural item anywhere on this list.

## The world outside

**10. Friendly and enemy bases.** · **15. Raider bases, towns, cities, villages, abandoned places.**
M8's constraint-search placement is the mechanism these arrive through — a town is a POI kind with a
bigger, different stamp and inhabitants. What is missing is anything that lives in them.

**17. Other people AI.** Everything above depends on this. Pawns currently have exactly one
behaviour tree and no notion of a stranger.

**13. Reputation and faction alignment.** · **14. Trading.** The vision calls for a world that
remembers what you did; the cheap version is one queryable ledger written early rather than forty
booleans scattered later.

**16. Random events.** An event director pacing pressure over time. Listed in Slice 3 in the roadmap.

## Progression

**11. Per-pawn abilities to activate, unlock, and upgrade.** The Fallout/Starfield model from the
vision: everything visible from the start, you choose a path, and blueprints are found rather than
researched.

**12. Weapons with mods, upgrades, and special abilities.** Needs combat (Slice 3) to mean anything.

---

## Unscheduled, still wanted

Displaced from M10 rather than dropped:

- **Relic-tech recovered, not manufactured** — the top tier of the setting's ladder, found in the
  places M8 now generates. Ties directly to item 5's hidden caches.
- **The refined tier and a bench to make it at** — the M6 bill system carrying its second and third
  recipe.
- **Pawn skills gating who can make what**, so the ladder is a decision about people rather than a
  list of nouns.
- **Quality tiers** and **power**, both deferred since Slice 2 opened and still waiting for
  something to need them.

## A skill for making POIs, eventually

Worth writing, **not yet**. Both existing skills were written from real code after the pattern had
proved itself — `add-work-type` after M2, `art-pass` after M6 — and M8 is a single milestone with
two POI kinds and one stamp shape. Items 10 and 15 are what will turn placement into a genuine
pattern with variants worth documenting. Write it then, from what the code actually does.

What already looks like it belongs in it, from M8: noise makes texture and constraints make places;
a stamped enclosure must guarantee a door onto ground that connects to the colony; a place's centre
is its address and must stay standable; the name is generated once and saved; and a compound needs
a clear apron or it disappears into the wreckage it was scored for sitting near.
