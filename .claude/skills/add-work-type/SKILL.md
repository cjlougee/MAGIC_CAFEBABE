---
name: add-work-type
description: Use when adding a new kind of colonist work (a work type, work giver, or job kind) to the simulation — e.g. Construct, Cook, Clean, Research, Doctor. Covers the WorkGiver → Job → JobDriver → toils pipeline and the invariants that are easy to break silently.
---

# Adding a work type

The pipeline is `WorkType → WorkGiver → Job → JobDriver → Toils`. See
`docs/design/03-work-and-jobs.md` for why it is shaped this way. This skill is the
checklist for extending it without breaking the invariants that fail *quietly*.

## Before you start

**Do not add a WorkType without a WorkGiver behind it.** A column in the player's
priority grid that can never produce a job is a lie told to the player. If the content
the work operates on doesn't exist yet, build the content first.

**One WorkType can have many WorkGivers.** "Deliver materials to a blueprint" and
"restock a workbench" are both Haul. Only add a column when the *player* needs a
separate lever.

## The steps

### 1. Declare the work type — `src/sim/defs/workTypes.ts`

Add to `WorkType` and `WORK_TYPE_DEFS`. Array position must equal the id. Display order
is array order. `WORK_TYPE_COUNT` and `defaultPriorities()` follow automatically.

### 2. Add the job shape — `src/sim/ai/job.ts`

Extend the `Job` union and `JobKind`. **Jobs are plain data** — no functions, no
references to live objects. Entity ids and `TilePos`, nothing else. This is what lets a
mid-job pawn be saved as a toil index and two counters.

### 3. Write the giver — `src/sim/ai/workGivers.ts`

Return a `Job` or `null`. Every giver **must** reject, before returning:

- targets already reserved — `world.reservations.canReserveCell/Item(..., pawn.id)`
- targets that are unreachable — `world.reachability.canReach(...)`, or
  `bestAdjacentCell(...)` when the pawn works from beside the target
- targets that are no longer valid (the rock is already mined, the item is gone)

A giver that hands back impossible work produces a pawn that starts a job, fails it, and
immediately picks the same one again — forever. Order the checks cheapest-first and pay
for reachability only on a candidate that would actually win.

Register in `WORK_GIVERS`. Order within a priority band is the tiebreak.

### 4. Compose the driver — `src/sim/ai/jobDrivers.ts`

Add an entry to `DRIVERS` mapping your `JobKind` to a toil list. Reach for the existing
toils first: `toilReserveCell`, `toilReserveItem`, `toilWalkTo`, `toilWalkAdjacentTo`,
`toilWork`, `toilPickUp`, `toilDropCarried`.

**If you need a genuinely new toil, it is probably generic** — write it in `toils.ts`
alongside the others, not inline in the driver.

Use the `asMine`/`asHaul` narrowing-helper pattern: a driver is only ever run for its own
job kind, so a mismatch is a wiring bug and should throw rather than silently read
`undefined`.

### 5. Wire the command, if the player triggers it

Add to the `Command` union in `src/sim/core/commands.ts` and handle it in
`Simulation.applyCommands`. Area commands carry a rectangle, not a list of cells.

## Invariants that fail silently

- **`toilWork` needs `stillValid`.** Checked every tick, because the reason for the work
  can vanish while it is being done — someone else finished it, the player cancelled it.
- **Changing terrain requires `world.reachability.markDirty()`.** Forgetting it means
  pawns can't reach ground they're standing next to. Changing terrain also bumps
  `TileMap.revision`, which is what stops render layers drawing a hole where the terrain
  used to be.
- **Never release reservations yourself.** `endJob()` is the single exit; completion,
  failure, and preemption all route through it. Releasing anywhere else means the other
  paths leak, and a leaked reservation makes a target permanently untouchable with no
  visible cause.
- **A walk toil must clear the remaining path when it completes.** Movement ticks *after*
  jobs, so a leftover route walks the pawn off the cell it just reached.
- **New saved state goes in `hashWorld()`.** A hash that ignores a field silently stops
  guarding it, and the determinism tests go green while protecting nothing.
- **Never make a cell impassable while a pawn stands on it.** A pawn on an impassable
  cell has no reachability component, so `canReach` fails for *every* target and they
  idle forever with no visible cause. If work would block a cell, use `toilWork`'s
  `canProgress` to **wait** (not fail) while `pawnOccupies` is true.
- **`canProgress` waits; `stillValid` fails.** Use the first for conditions that clear on
  their own, the second for reasons the job should be abandoned. Getting them the wrong
  way round either cancels work that was merely blocked, or spins on work that will never
  become possible.
- **`passable` is not `storable`.** Anything that puts goods on the ground filters on
  `map.isStorable(...)`; only movement uses `isPassable`. Water is passable and not
  storable, and that is the whole reason the distinction exists.
- **Player-facing placement rules go in `sim/world/placement.ts`**, not inline in the
  command handler. The drag preview reads the same predicates, and if they drift the
  preview promises something the simulation then refuses — which reads to the player as
  the click not registering.

## If the work serves a need rather than the player

Eating and sleeping are **not** work types. They come from `findNeedJob` in `sim/ai/needs.ts`
and outrank every work type unconditionally — a colonist with Haul at priority 1 must not
starve beside a stockpile. Add there, not to `WORK_GIVERS`, and make sure the fallback
when the need *can't* be met is to carry on working rather than freeze.

Reservations are keyed by **entity**, not by item — plants, beds, and stacks all claim
through `reserveEntity`. Use `toilReserveEntity` with an existence check against
whichever store the id lives in.

## Tests to write — `tests/jobs.test.ts`

Mirror the existing ones; the first is the one that matters:

1. **Outcome, headless.** Set up the scenario, `sim.run(20000)`, assert the world
   changed the way a player would expect. This catches more than every unit test
   combined.
2. **Reservation exclusivity** — N pawns, one target, exactly one takes it.
3. **No leaks** — `world.reservations.activeCount` is 0 once work finishes.
4. **Preemption** — `interrupt()` mid-job clears the job, releases claims, and drops
   carried goods without destroying them.
5. **Priority respected** — the work type at priority 1 is chosen over one at 4, and a
   work type at 0 is never chosen.

**Isolate the scenario.** A focused test should strip whatever it isn't about — clearing
plants out of a mining test, for instance. Otherwise adding a new work type silently
changes the timing of every existing behavioural test, and they start failing for
reasons unrelated to what they assert.

## Finally

Update `docs/ROADMAP.md`, `docs/design/03-work-and-jobs.md` if the pipeline changed, and
run `npm run check`. Then **look at it in the browser** — every real bug this system has
had was invisible to tests: a cached ground layer leaving holes where rock was mined, a
preview that silently refused, and colonists eating one berry per trip because nothing
in a test can notice that behaviour is merely *technically* correct.
