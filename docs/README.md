# Documentation

How to find things, and where new writing belongs.

| Folder | Holds | Write here when |
|---|---|---|
| `design/` | How a system works and why it's shaped that way | You build or change a system |
| `decisions/` | Short ADRs — one decision, its alternatives, its consequences | You make a call a future reader would question |
| `ROADMAP.md` | Slices, milestones, and what's actually done | You finish a milestone, or the plan changes |

## Start here

1. [`../CLAUDE.md`](../CLAUDE.md) — the three enforcement rules, commands, and conventions. Read first.
2. [`design/00-vision.md`](design/00-vision.md) — what the game is, its pillars, and what it is not.
3. [`design/01-architecture.md`](design/01-architecture.md) — layers, data flow, subsystem designs.
4. [`ROADMAP.md`](ROADMAP.md) — where we are and what's next.

## Conventions

- **Design docs describe the current state, not history.** When behaviour changes, edit the doc in the
  same commit. Use ADRs for the historical record.
- **ADRs are immutable once merged.** Superseded by a newer ADR rather than edited; add a
  `Superseded by: 000N` line to the old one.
- Number ADRs sequentially: `decisions/0001-tech-stack.md`.
- Keep docs short enough to actually be read. A design doc that nobody finishes is a design doc that
  nobody follows.
