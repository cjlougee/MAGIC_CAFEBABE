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

Selection is a list, and the modifiers are the ones every file manager uses, because that is where
players already know them from:

| | |
|---|---|
| click | replace the party, and set the anchor |
| **ctrl**-click | toggle one colonist in or out |
| **shift**-click | take everyone between the anchor and this colonist |

"Between" means **roster order** — the entity store's insertion order, which is what the colonist
strip lists and the only ordering colonists have. A range over screen position would change meaning
every time somebody walked. Ctrl wins if both are held.

All three work from the roster as well as from the map, which matters more than it sounds: on a
512-tile world a drag rectangle would have to cover half the map to gather colonists who have
wandered off to forage.

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

## Showing what a tool is about to do

The build tool used to show nothing until the button went down. Position, extent and
facing were all invisible until after the click, so placing a bed was a blind commitment
and rotating it was a control whose effect you could only see by undoing it.

Three things fixed that, and the third is the one that matters:

- The **cursor is tracked whether or not a button is down**, so the preview exists on
  hover rather than only during a drag.
- The overlay draws the **footprint cells**, greyed out as a whole when the placement
  would be refused — a footprint is legal or it is not, so marking one offending cell
  would imply the rest is going ahead.
- `ObjectLayer` draws a translucent **ghost of the actual sprite**, tinted red when the
  simulation would refuse it. The cell outline can say *where* but never *which way*:
  rotations 0 and 2 cover exactly the same cells, so on the outline alone half of every
  player's presses of the turn key look like they did nothing at all. It lives in the
  object layer rather than with the flat overlay tiles because it has height and has to
  sort against what is already standing — a ghost drawn *under* the walls it is being
  fitted between answers nothing about whether it fits.

### Q and E, and why that is not a breach of ADR 0005

**Q and E turn the pending blueprint, but only while the build tool is up.** Q otherwise
selects the select tool.

The rule is that a gesture must not change meaning based on **state the player cannot
see** — and which tool is active is the most visible state in the game. The toolbar
highlights it, the cursor changes to a crosshair, the architect row opens, the facing
readout appears, and the hint bar itself swaps to say `Q` `E` turn. Escape and right-click
both still leave the tool, so nothing is trapped behind the borrowed key.

The rotate *button* was removed rather than kept alongside, and so was the facing readout
that replaced it. The ghost under the cursor already shows which way the thing is turned,
at the place the player is looking; a button was a second way to do what the keys do
better, with the hand off the map, and a readout was a third. **The build menu holds
buildable things and nothing else** — it is about to grow categories and forty entries in
M13, and every non-buildable row in it is one the player has to look past.

## Selecting a structure shows you which one

A colonist gets a ring on the ground. A wall cannot: the ring would be underneath the very
thing it points at, which is the same problem demolition marks hit in M4. So a selected
structure is **tinted**, in the object layer, the same mechanism and for the same reason —
relic-tinted to match the colonist's ring, and pale, because unlike a demolition mark it
is not an order. A mark outranks a selection when both apply: what the colony is about to
*do* matters more than which panel happens to be open, and the panel is already on screen
saying what is selected.

## Saying that an order landed

Right-clicking the ground used to produce nothing at all, and worse than nothing — the right button
also pans, so the cursor flipped to the grab hand the instant it went down. Every order was
acknowledged with feedback for a different action. The grab hand now waits until the view actually
moves, so a click that turns out to be an order never claims to be a pan.

In its place, two things:

- **The cursor animation.** Four blades sweep in from the corners along an arc and are drawn into
  the point clicked. A plain 2D canvas rather than anything in Pixi, because it belongs to the
  *cursor*: it plays at a point on screen and must not pan, zoom or scale with the map, and it has
  to keep running while the game is paused. `render/art/orderCursor.ts` is a pure function of
  normalised time, which is what makes it reviewable — see the note in the `art-pass` skill about
  why an animation is written that way, and `filmstrip.html` for the harness.
- **The target tile pulses**, three times over two seconds, in relic cyan at up to half opacity.
  A whole number of cosine cycles lands back on zero by itself, so it ends without a cut and needs
  no fade envelope — one was tried, and it crushed the second and third pulses to a quarter
  strength, so three pulses read as one. The tile glows **from the middle out** — a concentric
  falloff, the same idea as the light diffusion in `glow.ts`, because a flat fill reads as a
  coloured card laid on the ground instead of something happening at a point. Built on a canvas and
  sampled `linear`, for the reason every gradient here is: nearest steps it into contour rings.
  **All four edges are outlined**, at the same relative alpha, so the pulse says *this tile* rather
  than *somewhere around here* — a falloff on its own dissolves at exactly the boundary the player
  is trying to read. The usual rule against rim highlights does not apply, because that one exists
  to stop terrain tiles drawing a seam grid across a whole mountain; this is a transient marker on
  a single cell and having a border is the point of it.

Only clicks in the world get the cursor animation. Ordering from the places list is a button press,
and a button already acknowledges itself.

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
