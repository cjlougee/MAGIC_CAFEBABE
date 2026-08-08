# Vision

## What this is

A colony simulation with **systemic depth as the point**. Not a base builder with a survival veneer —
a game where pawns have their own agenda, where systems interact to produce stories nobody scripted,
and where the player's job is steering rather than puppeteering.

## The one thing every goal here has in common: specificity

Every "feel" goal this project has — NPCs with names rather than roles, colonists with backstories,
loot that *combines* rather than out-ranks, a world that remembers what you did, a guaranteed city
somewhere, a house you can actually buy — is the same wish stated six different ways:

> **Things in this world are particular things, not instances of a type.**

Which sets up the central craft problem, because the world is generated and **generators produce
instances of types.** That is what they are for. Left alone, procedural content yields "a ruin", "a
guard", "a sword, +2". The design demands *the listening post in the northern flats*, *Auden, who
owes you*, *the coupling you pulled out of the wreck at the cost of a colonist*.

So the rule is: **the generator's job is to produce particulars, not variety.** Concretely —

- **Name things at birth and persist the name.** A thing with a stored name can be referred to,
  remembered, and missed.
- **Generate history once, then keep it.** A ruin that decides what it used to be every time it is
  examined is a type. One that decided during worldgen and wrote it down is a place.
- **Place landmarks by constraint, not by threshold.** *Noise makes texture; constraints make
  places.* Scattered wreckage can be a noise field. A named ruin cannot.
- **Keep one ledger of what the player did**, so consequence can be *queried* rather than scattered
  across forty booleans nothing can read together.

The test this yields is worth applying to any proposed feature: **does this produce a particular
thing, or an instance of a type?** The `scrap → refined → relic-tech` ladder fails it on its own —
three nouns in a partial order, with nothing particular anywhere in it — which is why it was
reframed as *the thing you carried home from somewhere* rather than as a tier list.

## The shape of play

- **You are someone, and you have a band.** A player character among colonists who are also
  characters, not interchangeable labour. Where exactly the avatar lands is still open; that it
  exists is not.
- **The colony runs while you are away.** This is the hard part of the Kenshi/RimWorld hybrid, and
  the work-*pool* scheduler already solves it: colonists are never assigned to jobs, so removing
  four of them from the pool is not a special case.
- **Progression is skills and blueprints, not a tech tree.** Fallout 4 / Starfield rather than
  Civilization: everything is visible from the first minute and you choose a path through it.
  Blueprints are found, so the upgrade curve is an implicit reward for exploring rather than a
  menu you unlock. It is also cheaper — there is no tree to design up front, and a new discipline
  is additive.
- **Progress is hard-fought and every point is precious**, at least early. Losing a colonist should
  feel disastrous and be survivable. Those two words are in tension on purpose.
- **Real-time with pause.** Stop the clock, give orders, let it run.

## Influences, and what we take from each

| Game | What we take |
|---|---|
| **RimWorld** | The depth. Interacting systems, the work-priority scheduler, needs/mood/thoughts, emergent narrative |
| **Kenshi** | The feel. A hostile world you scavenge rather than conquer; ruins that predate you; progression through use |
| **Space Haven** | The look. Colourful, dynamic, readable — saturated machinery against desaturated wilderness |
| **Bannerlord** | The command layer. Selecting a squad and *ordering* it, rather than watching it |
| **Diablo** | The moment-to-moment. A close camera and direct control of a character you inhabit |

## Setting: the fallen-tech frontier

You colonize a world littered with the wreckage of a collapsed high-tech civilization.

This is a load-bearing choice, not flavour. It makes every pillar feed the others:

- **Crafting** gets a natural ladder — **scrap → refined → salvaged relic-tech** — so upgrading always
  has somewhere to go.
- **Exploration** has a point: the top tier cannot be manufactured, only recovered from ruins.
- **Factions** write themselves: scavenger clans, a remnant order hoarding what's left, natives who
  want the ruins undisturbed.
- **Art direction** earns itself: clean, saturated, colourful machinery sitting in rusted alien
  wilderness. The relic cyan in the palette is the visual signature of the tier you can't make, and
  in isometric it sits on the *vertical* faces of standing structures — so intact relic-tech reads
  as lit panels from across the map.

## Relic tech is dim, not powered

The ruins still emit, and that is the hook — but they are **weathered panels that have
stood in the open for centuries and merely failed to go out**, not equipment somebody
services. Run the relic cyan at full saturation and the wreckage reads as maintained,
which quietly contradicts the whole premise: nobody has maintained anything here in a very
long time, and that is why the top of the crafting ladder can only be *found*.

Concretely, in `render/art/palette.ts`: `relic` is the colour of the material, `relicGlow`
is the dimmer, less saturated thing it gives off. Ruins should still pull the eye across a
dark map — findable is the point — but as something guttering rather than something on.

## Pillars

1. **Emergent labour.** Pawns decide what to do from a priority grid, and it's legible why.
2. **A ladder worth climbing.** Crafting and upgrading with visible tiers and real trade-offs.
3. **Pressure worth defending against.** Threats that escalate and force the base to adapt.
4. **A world outside the walls.** One continuous map you cross on foot, with places on it worth the
   walk. Exploration and factions that matter to the colony's economy. See ADR
   [0007](../decisions/0007-world-shape.md).
5. **Command when it counts.** Direct, tactical control in a fight — not just drafted positioning.
6. **Ground worth fighting over.** Verticality that changes tactics: high ground, cover, trenches —
   and caves that hide what the fallen civilization left behind.
7. **A world that remembers.** Named people, persistent consequence, and a colony whose history is
   its own rather than a difficulty curve.

## What this is not

Naming the negative space is what keeps scope honest.

- **Not 3D.** A 2D isometric tile grid (2:1 dimetric), permanently — sprites on a grid, never meshes,
  and a camera that pans and zooms but never orbits. Verticality arrives as *discrete stacked levels*
  viewed through a cross-section, not as a rotatable third dimension. See ADR
  [0003](../decisions/0003-verticality.md).
- **Not first-person, ever.** Procedural isometric sprites do not become an FPS — it is a different
  renderer, different assets, and an animation system this project has no basis for. The affordable
  version of that impulse is a *close, direct-control camera*: drive the player character yourself,
  everyone else on orders, pause whenever. Diablo-direct, not Doom.
- **Not Dwarf Fortress scale.** ~20 colonists, not thousands. The *map* is now 512×512, but that
  buys distance to travel, not population.
- **Not multiplayer.** The deterministic core would permit it; we are not building it.
- **Not a survival roguelite.** Colonies are meant to persist and be invested in, not restarted hourly.
- **Not procedurally endless.** One continuous, bounded, generated world — see ADR
  [0007](../decisions/0007-world-shape.md). And *generated* must never mean *disposable*: the
  generator's job is particulars, not volume.

## The measure of success

The game works when a player can leave the colony running unattended for a few in-game days, come
back, and find a *story* — someone starved because the cook broke down, someone slept on the floor
because the beds weren't built, the stockpile filled with the wrong thing. Systems producing
consequences the designer didn't script is the whole target.

Slice 2 turns that from a figure of speech into the loop: you leave *because you are somewhere
else*, and the story you come back to is the price of the thing you went to get.
