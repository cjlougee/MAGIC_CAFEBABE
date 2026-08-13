---
name: scenario
description: Use when you need to see a game state that is not the default — verifying a render or gameplay change, checking every rotation or variant of something, or reproducing a bug. Covers writing a scenario, capturing it to a PNG, and when to hand the setup to the user instead.
---

# Seeing a game state

```
javascript_tool → await __scenario.capture('beds-all-rotations')
Read art/scenes/beds-all-rotations.png
```

Two calls. That is the whole loop.

**The baseline it replaces was about twenty.** Verifying one render fix — *is a sleeping colonist
positioned correctly on a bed?* — cost roughly six calls placing a bed through the debug panel, six
persuading colonists to prefer it over a bedroll, four reaching night, and eight screenshots mostly
spent re-framing. Only the last few had anything to do with the question.

`__scenario.list()` says what exists and what question each one answers.

## Writing one

`src/scenarios/`, plain TypeScript, versioned like anything else.

```ts
{
  name: 'beds-all-rotations',
  about: 'Four beds, one per facing, each with a colonist asleep at the head end. Night.',
  build(s) {
    s.flat(28);
    for (const rotation of ROTATIONS) {
      s.sleeperIn(s.place(Building.Bed, pos(4 + rotation * 5, 4), rotation));
    }
    s.timeOfDay('night');
  },
  frame: { fit: 'contents', zoom: 2 },
}
```

- **Start from `s.flat()`.** Worldgen randomness is noise in a picture whose subject is a bed: a lake
  in shot, a tree occluding the thing under review, a landing site three hundred tiles from where the
  camera points. Use `s.generated()` only when terrain *is* the subject.
- **`fit: 'contents'` computes the zoom**; `zoom` is a ceiling, not an instruction. Let it frame.
- **Arrange subjects in a block, not a row.** Four things in a row is sixteen tiles of *diagonal* on
  an isometric screen, and the camera pulls back to play zoom to hold them — which is exactly where
  every art fault in this project has successfully hidden.
- **A scenario over about a dozen lines means the builder is missing a verb.** Add the verb.

## The rule that matters

**Reach the state the game reaches, including the bookkeeping around it.**

Skipping the AI's *decision* is the entire point — whether a colonist wants that bed, whether they
walk there, whether it is late enough. Skipping the *transition* is forbidden, because then the
harness shows pictures of states the game cannot produce, and a fast harness that lies is worse than
no harness.

The first version of this got it wrong in a way worth remembering. The rule was written as "call the
game's own mutator", `sleeperIn` called `fallAsleep`, and it was still wrong: in the game that flag
only ever exists *inside an active sleep job holding a bed reservation*. A pawn with the flag alone is
jobless and unreserved, so a second colonist can be sent to the occupied bed and `tickPawnAI` will
hand the sleeper unrelated work while it is still drawn asleep. **A mutator is usually the smallest
part of a transition.** The reservation, the job and the interrupt are the rest.

`timeOfDay` failed the same way: it wrote `world.tick` directly, and the debug command it should have
used only ever moves the clock *forward*, because winding it back leaves anything that already
happened stranded in the future.

So: `s.place` goes through the real `build` command with `instant: true`, which runs the legality
check and refuses to raise a blocking structure on an occupied cell. `s.sleeperIn` takes the real
sleep job. Neither stamps the grid.

## Capturing something you set up by hand

`__scenario.capture()` with no name photographs whatever is currently on screen, at full resolution.
That is the cheap half of handing setup to the user — they arrange something fiddly in four clicks,
you take the still in one call.

## When not to write one

**Feel, timing, performance, whether an animation reads, what happens over a long run of play.** A
scenario freezes a moment; those questions are about motion. Write the user a short numbered setup and
hand it over — see "Hand the fussy setup to the user" in `CLAUDE.md`. Then `capture()` the result if a
still helps.

Also skip it when building the scenario would plainly cost more than the answer is worth.

## Gotchas

- **Reload after editing engine or renderer code.** Vite's HMR replaces the module but `__scenario`
  still closes over the destroyed engine, and the failure is a confusing `Cannot read properties of
  null (reading 'canvas')` from deep inside Pixi.
- **The capture renders synchronously** rather than awaiting a frame, because `requestAnimationFrame`
  is throttled in a hidden tab — which is exactly when this is most needed, since screenshots have
  already failed there.
- **`art/scenes/` is generated and gitignored.** Nothing there is a source of truth; re-capture rather
  than trusting an old file.
- Scenarios are dev-only and deliberately **not** wired into `npm run check`, so they cannot become a
  maintenance tax on unrelated work. The trade is that a stale one fails at capture time. There is a
  registry test that builds every shipped scenario, which catches the worst of it.

## Finally

The harness answers *where things are*. It has nothing whatever to say about whether a thing reads as
what it is — that is still your eyes, and still the user's.
