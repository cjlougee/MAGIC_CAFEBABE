# Needs and mood

The systems that make colonists act without being told, and feel like people while doing it.

## Needs sit above the work grid

A need job — eating, sleeping — **outranks every work type, unconditionally**. It does not appear in
the priority grid and cannot be switched off.

This is the most important rule in the milestone. If eating were just another work type, a colonist
with Haul at priority 1 would starve beside a stockpile, and the player would rightly read that as a
bug rather than a lesson about priorities. The hierarchy in `tickPawnAI` is:

```
1. mental break   — overrides everything
2. needs          — eat, sleep
3. work           — by the player's priority grid
```

Hunger is checked before rest: a starving colonist who lies down to sleep dies in their bed, which is
both bad play and a bad story.

**No food anywhere is not a reason to stand still.** When the need can't be met, `findNeedJob` falls
through to work rather than blocking. The alert tells the player what's wrong; the colonist keeps
being useful until it's fixed.

## Mood is a list of reasons, never a number

Mood is always recomputed as `BASE_MOOD + the sum of active thoughts`. Nothing sets it directly.

That constraint is what lets the inspector answer *"why is Ash miserable?"* with a list the player can
act on, instead of a number they can only guess at. Any mood change that can't be expressed as a
thought doesn't belong in the system.

Two kinds of thought:

| | Stored? | Lifetime | Example |
|---|---|---|---|
| **Situational** | No — derived each tick | Vanishes with the condition | *Hungry*, *Starving*, *Exhausted* |
| **Memory** | Yes, with an age | Decays over hours | *Ate raw food*, *Slept on the ground* |

Situational thoughts must not be stored, or a colonist who has just eaten stays unhappy about hunger.
Memories must be, or a bad night has no consequences past dawn.

Repeating a memory refreshes it rather than stacking, so eating four times doesn't quadruple the
penalty.

## Mental breaks

Below `BREAK_THRESHOLD`, a colonist rolls each think tick against `BREAK_CHANCE_PER_THINK`. On a hit
they drop everything — `interrupt()` releases their claims — and wander for a few hours.

Probabilistic rather than a hard trigger, deliberately: a colonist who dips under the line for a
moment shouldn't reliably snap, and two identical bad days shouldn't produce identical stories. The
roll draws from the world RNG, so it stays deterministic.

## Food is a loop, not a countdown

Berry bushes regrow. A starting stockpile would make survival a countdown; a regrowing bush makes it a
*system* the player can reason about and eventually improve. Farming in Slice 2 is then a better
version of something that already works.

Bushes start at randomised growth so the colony doesn't face a synchronised famine followed by a
synchronised glut. Harvesting strips a bush back to bare rather than destroying it.

**Colonists eat a meal, not a mouthful.** One unit restores 14%, so eating once at the 35% threshold
left them hungry again almost immediately — an endless shuttle between food and work. `consumeFood`
eats until satisfied. This was invisible in tests and obvious within a minute of watching.

## Beds

Bedrolls arrive *with* the landing party rather than being constructed, because construction is M4 and
a placeholder build tool would be code M4 immediately deletes. Sleeping in a bed is a small mood gain;
sleeping rough is a larger loss — the first real pressure toward building anything.

Beds are claimed through the same reservation system as rocks and stacks, which is why
`Reservations` is keyed by entity rather than by item.

## Alerts

Derived fresh from world state every snapshot rather than raised as events. An alert can therefore
never be stale — when the situation resolves, it simply isn't generated again. Event-based alerts
need dismissal logic and eventually lie.

Kept short on purpose. An alerts panel that is always full is one nobody reads.

## What this milestone deliberately does not have

- **Cooking.** Cooking is production, and production is Slice 2 with the bill system. A one-off
  campfire recipe here would be rewritten the moment real bills arrive. Raw food carries a mood
  penalty instead, which *motivates* cooking rather than pre-empting it.
- **A light grid.** It was deferred to M3 on the grounds that campfires would be the first light
  source. No campfires, so still nothing to light — it follows cooking into Slice 2.
- **Injury beyond starvation.** `health` is a single number. The body-part `hediff` model lands with
  combat in Slice 3.
