# Save and load

## The shape of it

```
World  ──serializeWorld──▶  SaveData (plain JSON)  ──JSON.stringify──▶  localStorage
World  ◀──deserializeWorld──  SaveData  ◀──migrate──  JSON.parse
```

`sim/save/serialize.ts` produces and consumes plain data. `app/saveStorage.ts` is the only
file that touches `localStorage` — enforcement rule 1 means the simulation cannot, and
that constraint is what makes save/load testable in Node like everything else.

## Derived state is never saved

Pathfinder scratch, reachability components, the room map, and `walkCost` are all rebuilt
on load. Storing them would double the file and add a way for a save to be internally
inconsistent — a stored `walkCost` could disagree with the terrain it came from, and
nothing could tell you which was right.

**Reservations *are* saved.** They look transient but a pawn restored mid-job is still
holding its targets; dropping the claims would let a second colonist take the same rock
the moment the game reloaded.

## Terrain is run-length encoded

A 128×128 map is 16,384 cells per grid, three grids. As raw JSON numbers that is most of a
megabyte; RLE collapses it to a few hundred entries because terrain comes in long runs. A
full colony saves in about 20KB.

Hand-rolled rather than base64 so the format stays readable and depends on nothing.

## Slots

Saves are named, and there can be as many as storage allows. Each occupies **two keys**:

```
magic-cafebabe:slot:<id>:info    small — name, day, colonists, timestamp
magic-cafebabe:slot:<id>:data    the colony itself
```

Split because listing has to read every save's name and day, and parsing a 20KB world to
render one line would make the menu slower the more you play.

**There is no index key.** The list is derived by scanning for `:info` suffixes, so it
cannot drift out of step with what is actually stored — an index that disagrees with
reality is worse than no index. A slot whose data went missing is hidden rather than
offered, because a save that loads nothing is worse than one that isn't there.

Writes go **data first, then info**: a half-written slot with no info is invisible, where
info with no data would advertise a save that cannot be loaded. A failed write rolls both
back.

Saving defaults to creating a *new* slot named after the day, because the common mistake
is overwriting a colony you wanted to keep. Overwrite is available per-row, where the
thing being replaced is visible. Deleting takes two clicks — there is no undo.

The pre-naming single-slot key is migrated into a named slot on first listing, so nobody
loses a colony to an update.

## Versioning

`SAVE_VERSION` is 1. `migrate.ts` holds a chain of steps, each upgrading by exactly one
version and never skipping — a sequence of small, individually-obvious transforms stays
reviewable where one "handle any old shape" function does not.

There is nothing to migrate yet. The machinery exists anyway, because the alternative is
discovering you need it *after* shipping a format, when every existing colony is already
unreadable.

A save from a **newer** build is refused rather than guessed at. Loading one
half-understood would corrupt a colony instead of declining it.

## The invariant that holds it together

**`serializeWorld` and `hashWorld` must stay in step.** The round-trip test compares
hashes, so a field missing from *both* passes silently. Both files say so at the top; when
you add persistent state to `World`, add it to both.

## Tests

`tests/save.test.ts` builds on one idea: serialize, deserialize, and the world hash must
match.

- Round-trip of a fresh colony, a two-day-old colony, and one caught mid-job with carried
  goods and live reservations.
- **Behavioural equality**: a restored world doesn't merely *equal* the original, it
  continues identically — run both 5,000 more ticks and the hashes still match.
- **The week test**: save halfway through seven days, reload, run the rest, and the result
  is bit-identical to an uninterrupted run. That single assertion covers determinism,
  serialization, and the whole simulation at once.
