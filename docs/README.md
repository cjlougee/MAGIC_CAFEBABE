# Documentation

How to find things, and where new writing belongs.

| Folder | Holds | Write here when |
|---|---|---|
| `design/` | How a system works and why it's shaped that way | You build or change a system |
| `decisions/` | Short ADRs — one decision, its alternatives, its consequences | You make a call a future reader would question |
| `ROADMAP.md` | Slices, milestones, and what's actually done | You finish a milestone, or the plan changes |
| `BACKLOG.md` | Wanted, not yet scheduled | Something is worth doing but isn't the next thing |
| `superpowers/specs/` | The agreed plan for a milestone, before the code exists | You settle a design and are about to build it |

`superpowers/specs/` is working material with a shelf life: once a milestone lands, `design/` holds
the durable description and the spec is only of historical interest. A design doc describes the
current state; a spec describes an intention.

## Start here

1. [`../CLAUDE.md`](../CLAUDE.md) — the three enforcement rules, commands, and conventions. Read first.
2. [`design/00-vision.md`](design/00-vision.md) — what the game is, its pillars, and what it is not.
3. [`design/01-architecture.md`](design/01-architecture.md) — layers, data flow, subsystem designs.
4. [`ROADMAP.md`](ROADMAP.md) — what's done, what's next, and the known gaps. **Ends with a
   "picking this up next" section written for whoever arrives cold.**

## The systems, in build order

| Doc | System |
|---|---|
| [`02-pawns-and-movement.md`](design/02-pawns-and-movement.md) | Pawns, A\*, reachability, occlusion |
| [`03-work-and-jobs.md`](design/03-work-and-jobs.md) | The job pipeline — the deepest system here |
| [`04-needs-and-mood.md`](design/04-needs-and-mood.md) | Needs, thoughts, mood, mental breaks |
| [`05-construction-and-rooms.md`](design/05-construction-and-rooms.md) | Blueprints, walls, deconstruction, room detection |
| [`06-save-and-load.md`](design/06-save-and-load.md) | Serialization, versioning, migration |
| [`07-production.md`](design/07-production.md) | Recipes, workbenches, bills, cooking, light |
| [`08-the-world.md`](design/08-the-world.md) | Worldgen, biomes, chunked reachability, world scale |
| [`09-command.md`](design/09-command.md) | Draft, parties, travel orders, the player character |

## Conventions

- **Design docs describe the current state, not history.** When behaviour changes, edit the doc in the
  same commit. Use ADRs for the historical record.
- **ADRs are immutable once merged.** Superseded by a newer ADR rather than edited; add a
  `Superseded by: 000N` line to the old one.
- Number ADRs sequentially: `decisions/0001-tech-stack.md`.
- Keep docs short enough to actually be read. A design doc that nobody finishes is a design doc that
  nobody follows.
