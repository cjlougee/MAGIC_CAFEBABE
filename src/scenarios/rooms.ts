/**
 * M13's playable check, as a picture instead of an expedition.
 *
 * *"Furnish a hut and it stops being a box"* is a judgement, not a measurement — no
 * assertion will ever make it — so the only question is what it costs to *look*. Building
 * this by hand means a wall run, a door, a floor, a carpet, eight pieces of furniture and
 * a wait for nightfall, which is most of an afternoon. Written down it is two calls.
 *
 * At night, because half of what M13 added is light: a torch burns warm, a lamp and a
 * floodlight are salvage that never went out and burn cold. In daylight the three are
 * three shapes; after dark they are three different colours of room.
 */

import { pos, type TilePos } from '../sim/core/position';
import { Building } from '../sim/defs/buildings';
import { Buildable, type BuildableId } from '../sim/defs/buildables';
import type { Scenario, ScenarioBuilder } from './index';

const SIZE = 32;

/** Clear of the landing party and the bedrolls it laid around the middle of the map. */
const ORIGIN: TilePos = pos(4, 4);

const at = (dx: number, dy: number): TilePos => pos(ORIGIN.x + dx, ORIGIN.y + dy, ORIGIN.z);

/**
 * Walls around a `w × h` room with one door in the near wall, and a floor inside it.
 *
 * `surfaceFor` picks what goes on each interior cell, and every cell is laid **exactly
 * once** — surfaces do not stack, so flooring the whole room and then carpeting part of it
 * would throw. That is the rule doing its job on the first thing that tried to break it.
 */
function hut(
  s: ScenarioBuilder,
  w: number,
  h: number,
  doorAt: number,
  surfaceFor: (x: number, y: number) => BuildableId,
): void {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const onEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!onEdge) {
        s.floor(at(x, y), surfaceFor(x, y));
        continue;
      }
      if (y === h - 1 && x === doorAt) {
        s.place(Building.Door, at(x, y));
        continue;
      }
      s.place(Building.Wall, at(x, y));
    }
  }
}

/** Everything M13 lets you put in a room, laid out as somebody would actually live in it. */
function furnish(s: ScenarioBuilder): void {
  s.flat(SIZE);
  // Carpet over the sleeping end, paving over the rest — one surface per cell.
  hut(s, 11, 9, 5, (x, y) => (x <= 4 && y <= 4 ? Buildable.Carpet : Buildable.Floor));

  s.place(Building.Bed, at(1, 1), 0);
  s.place(Building.Bed, at(1, 3), 0);
  s.place(Building.Shelf, at(1, 6), 0);

  s.place(Building.Table, at(6, 3));
  s.place(Building.Chair, at(5, 3), 0);
  s.place(Building.Chair, at(8, 4), 2);
  s.place(Building.Stool, at(6, 5));

  s.place(Building.Desk, at(7, 1), 0);
  s.place(Building.Crate, at(4, 6));
  s.place(Building.Safe, at(9, 6));
  s.place(Building.Lamp, at(5, 1));
  s.place(Building.Banner, at(9, 1), 0);
}

const ROOM_FRAME = { fit: 'contents', zoom: 1.6 } as const;

export const rooms: Scenario[] = [
  /*
   * **The same room twice, and both are needed.**
   *
   * At noon it answers the milestone's own playable check — does a furnished hut stop
   * being a box — which is a question about *shapes*, and at night every shape is a
   * silhouette. At night it answers the other half, which is that a lamp is not merely a
   * differently-shaped object: it changes the colour of the room it stands in.
   *
   * Two entries rather than one, for the reason the contact sheet keeps `— before` rows:
   * a comparison you cannot see side by side is a comparison nobody makes.
   */
  {
    name: 'furnished-room',
    about: 'A walled hut with a carpet, beds, a table and chairs, shelves and storage. Noon.',
    build: (s) => {
      furnish(s);
      s.timeOfDay('noon');
    },
    frame: ROOM_FRAME,
  },
  {
    name: 'furnished-room-night',
    about: 'The same room after dark, lit by the relic lamp standing in it.',
    build: (s) => {
      furnish(s);
      s.timeOfDay('night');
    },
    frame: ROOM_FRAME,
  },
  {
    name: 'lights-at-night',
    /*
     * The three tiers side by side, which is the only way the claim they make is
     * checkable: a torch is `firelight`, a lamp and a floodlight are `relicGlow`, and the
     * radii run 4 / 7 / 11. One at a time each is just "a light".
     *
     * Kept tight in the corner. Spread across the map the frame grows to hold them all and
     * pulls in the landing party — a heap of colonists and bedrolls in the middle of a
     * picture whose subject is how far a lamp reaches.
     */
    about: 'Torch, lamp and floodlight in a row, with a campfire and a hearth. Night.',
    build: (s) => {
      s.flat(SIZE);
      s.place(Building.Torch, at(0, 0));
      s.place(Building.Lamp, at(5, 0));
      s.place(Building.Floodlight, at(11, 0));
      s.place(Building.Campfire, at(0, 6));
      s.place(Building.Hearth, at(5, 6));
      s.timeOfDay('night');
    },
    frame: { fit: 'contents', zoom: 1.6 },
  },
];
