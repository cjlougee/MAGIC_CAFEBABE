# Command

The direct-control half of the hybrid model: taking colonists out of the work pool, sending them
somewhere, and getting them back.

The colony has always been able to run itself. What it could not do was *go anywhere* — the only
thing that moved a colonist across the map was a right-click, and that order had a lifetime of about
half a second.

## Why a direct order needed draft at all

Movement is a **path**, not a job. `applyMoveTo` set `pawn.path` and nothing else, and `startJob`
begins with `clearPath`. So the sequence was:

1. The player orders a colonist to walk 200 tiles.
2. Within one think interval — 30 ticks, half a second at 1x — a work giver hands them a haul job.
3. `startJob` clears the path. The order is gone, unrecorded, unreported.
4. The colonist turns round and goes back to work.

Every direct order in the game had been doing this since M1. It reads as a pathfinding bug and it is
not one: the order was simply never durable enough to survive the next thought.

## Draft, and the two fields behind it

- **`drafted`** — under direct command. Work givers cannot reach this pawn at all.
- **`draftTarget`** — where the player sent them, kept until they arrive.

The target is stored rather than merely pathed because **eating clears the path**. An order that
lived only in `pawn.path` would end wherever hunger struck, halfway across the map, silently.
`resumeDraftOrder` re-plans on the next think tick after any interruption, which is what makes "go
there" mean *go there* rather than "start going there".

**A move order drafts**, and draft is *also* a thing you can just ask for. Sending somebody
somewhere is the statement that you want them there, so requiring a separate mode first would leave
the one-click version broken exactly as it was. But the implicit path cannot be the only one:
"hold this lot where they are" is an order in its own right, and with no visible control the honest
question was *how do I undraft?* — which had no answer you could see.

So `setDrafted` takes a list and a boolean. The party panel leads with a single button that says
which way it goes — **Draft all 3** or **Back to work (3)** — and each member carries a
`working`/`drafted` toggle. A mixed party counts as undrafted, so the first press drafts everybody
rather than releasing the ones already under command. Drafting with no target means exactly what it
says: stop working, stand there.

### The behavioural hierarchy, updated

```
1. a mental break        overrides everything, drafted or not
2. needs                 eating and sleeping, unconditionally
3. a standing order      if drafted
4. work                  the player's priority grid
```

**Needs stay above draft, deliberately**, and it is worth saying why since the genre often does the
opposite. A drafted pawn that ignored hunger would starve on an expedition while the player was
looking elsewhere, and the only feedback would be a corpse. Out in the wild there is nothing to eat
anyway, so the need finds no job and the pawn keeps walking; near home they detour, eat, and resume.
The cost is that draft is not a guarantee of *holding a spot* — when combat needs that, it will need
its own rule.

## Parties

Selection is a list. Shift-click adds, left-drag over the world catches everyone inside the
rectangle, and shift-clicking the roster works too — on a 512-tile map a drag rectangle would have
to cover half the world to gather colonists who have wandered off.

**The drag draws a marquee**, and that is not cosmetic. It was left out on the grounds that
selecting changes nothing about the world — true, and beside the point. Reported as "I can't drag
select the party", when it had been selecting correctly all along and simply never drew the box, so
there was no way to tell a successful drag from a dead control.

`moveParty` is a command in its own right rather than a loop of `moveTo` in the input layer, because
the interesting part is that they must **not all path to the same cell**. Each pawn takes the
nearest free standable cell to the target that nobody ahead of them claimed. Assignment walks the
party in the order given, so the same order always produces the same arrangement — a spread that
varied run to run would break determinism for something purely cosmetic.

The input layer always sends `moveParty`, even for one colonist, so the fan-out rule cannot differ
between "a pawn" and "some pawns".

## Travelling to a named place

The party panel lists every place M8 generated with its distance, and clicking one sends the party.
Without it, reaching a vault 200 tiles away meant scrolling there and clicking the ground — the
places existed, and were effectively unusable.

## Panels stack, they do not overlap

The party controls, a colonist's sheet and a bench's bills were each absolutely positioned in the
same top-right corner. Any two at once meant one covered the other — and selecting a *single*
colonist did exactly that, hiding the controls that acted on them behind their own character sheet.
Closing the sheet then cleared the selection, taking the party panel with it, so the controls could
not be reached at all.

They now share a `.side-rail`: one scrollable column, panels stacked in order, no absolute
positioning of their own. A panel added later goes in the rail rather than picking a corner and
hoping.

## The player character

One pawn is marked at worldgen, rolled rather than always the first, so the landing party does not
read as "the protagonist and some staff". Today the flag does nothing but show a ◆ in the roster. It
exists so the fiction has somebody in it, and so a stat buff or an ability has something to hang off
later. **No camera change comes with it** — see [`00-vision.md`](00-vision.md).

## Failing loudly

M8's lesson was that this area's failure mode is a colonist standing still with no explanation. M9
adds three ways to strand one, so:

- An unreachable order is **kept, not dropped**. Dropping it silently would leave a pawn idle with
  no record of what they were asked to do; keeping it means `buildAlerts` can say *"X cannot reach
  where you sent them"*, and the retry costs one O(1) reachability check per think tick.
- The party panel repeats it per colonist, because that is the panel you are looking at when you
  gave the order.
- `pawnActivity` distinguishes **travelling** from **holding** from **idle**. A colonist walking
  ninety tiles under orders has no job to name and used to report "idle" — the exact word a player
  scans for when wondering why nothing is happening.

### The one that got through anyway

A drafted colonist stood in an open meadow for five in-game hours. Reachability said the target was
reachable, so no alert fired; A\* returned null, so no path was set.

`DEFAULT_NODE_BUDGET` was a flat 20,000 cells — written when the map was 128², which is 16,384
cells, so **the ceiling could never bind**. At 512² a long walk around water exhausts it. The budget
is now the whole map, which makes a false "no route" impossible because `closedStamp` means no cell
is examined twice; the original purpose, not stalling a tick on a hopeless search, is served
properly by `canReach`, an O(1) check every caller already makes first. A budget was always a poor
guard against hopelessness anyway — it cannot tell a hopeless search from a long one.

This is the same shape as M7's finding, and the third time it has appeared: **a constant tuned to
the old map size, still passing every test.**

## Tests — `tests/command.test.ts`

1. A drafted colonist reaches a target 50 tiles away without being pulled onto work — the regression
   test for the whole milestone, which failed at tick 30 before draft existed.
2. Draft outranks the priority grid, with a control proving hauling really was available.
3. An order survives a need interrupting it, and clears on arrival.
4. Undrafting returns a colonist to the pool and they take work again.
5. An impossible order is kept and raises an alert.
6. A party arrives fanned out, nobody stacked, everybody within reach of the rendezvous.
7. The same party and order produce the same world hash.
8. Draft and the standing order survive a save round-trip.
9. A whole party drafts and releases in one order, stopping work without being sent anywhere.
