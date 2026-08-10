# Backlog

Work that is wanted and not yet scheduled. Separate from [`ROADMAP.md`](ROADMAP.md) on purpose: the
roadmap is a small number of milestones in a committed order, and burying a wish list inside it would
make the next thing to do harder to find, not easier.

**Most of this file has been scheduled.** The seventeen items raised after M9 were a list, not a
plan. Working out what gates what turned them into
[Slice 3 — The Built World](ROADMAP.md#slice-3--the-built-world-the-colony-gets-an-inside) (M10–M15),
a [verticality slice](ROADMAP.md#slice-4--verticality-there-is-an-upstairs-and-a-downstairs),
and dependency-ordered notes inside the later slices. What is left below is what genuinely has no
home yet.

---

## Where the seventeen went

| # | Item | Landed in |
|---|---|---|
| 6 | Multi-tile items | **M10** — the gate on 8 and 9 |
| 2 | Select a wall or door directly, red ✕ | **M11** |
| 3 | Doors that look and act like doors | **M11** |
| 1 | Drag the minimap | **M11** |
| — | *Asset pipeline* | **M12** — not a backlog item; added because M13–15 are three milestones of new art |
| 4 | Toolbar and build-menu review | **M13** — before the content flood, not after |
| 9 | Things that go in buildings | **M13** |
| 8 | Buildings that look like buildings | **split.** Materials, ornament and occlusion M14; storeys need levels, so Slice 4 |
| 5 | Small details — flora, fauna, caches, scrap | **M15** |
| 7 | Terrain | **split.** Biome tuning M15; ditches, hills and caves are Slice 4 |
| 16 | Random events | Slice 5 — Threat |
| 11 | Per-pawn abilities | Slice 5, and wants pawn skills below |
| 12 | Weapons with mods | Slice 5 — needs combat to mean anything |
| 17 | Other people AI | Slice 6, **first** — 10, 13, 14 and 15 all need a notion of a stranger |
| 10 | Friendly and enemy bases | Slice 6 |
| 15 | Raider bases, towns, cities, villages | Slice 6 |
| 13 | Reputation and faction alignment | Slice 6 |
| 14 | Trading | Slice 6 |

The orderings that were genuinely arguable, and the reasoning that settled them:

- **Item 4 before items 3, 9 and 8, not after.** The architect list is one undivided
  `BUILDABLE_DEFS`. It works at four entries; M13 and M14 create forty. Categorising a menu that is
  already overflowing is a bigger job than categorising one about to.
- **A pipeline milestone before any of the art.** Not a backlog item at all — it came out of M10,
  where the cost was in *judging* sprites rather than drawing them, and all five bugs the sprite
  sheet caught were measurements a test could have made.
- **Item 8 split rather than delayed.** Most of "buildings that look like buildings" — materials,
  ornament, silhouette, occlusion — has nothing to do with levels. Only genuine storeys do. Building
  tall in a one-level world and converting it later is building it twice.
- **Item 17 before 10, 13, 14 and 15.** A town is a POI kind with a bigger stamp — M8's constraint
  search already does that part. What is missing from all four is anything that *lives* in them.

---

## Unscheduled, still wanted

Displaced from the retired M10 rather than dropped. The crafting ladder is still the setting's spine;
it is waiting for the places and people that make the top tier worth reaching.

- **Relic-tech recovered, not manufactured** — the top tier of `scrap → refined → relic-tech`, found
  in the places M8 generates. Ties directly to M14's hidden caches, which is the first thing that
  gives those places contents.
- **The refined tier and a bench to make it at** — the M6 bill system carrying its second and third
  recipe. M10's Hearth is the first multi-tile bench and proves the shape.
- **Pawn skills gating who can make what**, so the ladder is a decision about people rather than a
  list of nouns. Also what per-pawn abilities (item 11) want underneath them.
- **Quality tiers** and **power**, both deferred since Slice 2 opened and still waiting for something
  to need them.

## A skill for making POIs, eventually

Worth writing, **not yet**. Both existing skills were written from real code after the pattern had
proved itself — `add-work-type` after M2, `art-pass` after M6 — and M8 is a single milestone with
two POI kinds and one stamp shape. Slice 5's towns and bases are what will turn placement into a
genuine pattern with variants worth documenting. Write it then, from what the code actually does.

What already looks like it belongs in it, from M8: noise makes texture and constraints make places;
a stamped enclosure must guarantee a door onto ground that connects to the colony; a place's centre
is its address and must stay standable; the name is generated once and saved; and a compound needs
a clear apron or it disappears into the wreckage it was scored for sitting near.
