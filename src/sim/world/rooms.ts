/**
 * Enclosed spaces.
 *
 * A room is a pocket of open ground that a flood fill cannot escape from — and whose
 * boundary includes **something a colonist built**.
 *
 * Both halves are needed. Enclosure alone is not enough: natural terrain closes off
 * plenty of pockets, and a lagoon ringed by deep water or a clearing ringed by rock
 * would otherwise count as sheltered. Colonists would collect "slept under a roof" for
 * bedding down in a hollow, which is exactly the reward that is supposed to make
 * building a hut worthwhile.
 *
 * Enclosure is why **doors seal rooms without blocking movement**. A house whose only
 * entrance made it count as outdoors would defeat the point of building one.
 *
 * Rebuilt lazily on the same dirty-flag pattern as reachability, because both change
 * for exactly the same reason — a structure went up or came down.
 */

import { GROUND_LEVEL, type TilePos } from '../core/position';
import type { TileMap } from './tilemap';

/** Cells that are solid, or inside a wall. Not part of any room. */
const NO_ROOM = -1;

export class RoomMap {
  private readonly roomId: Int32Array;
  private readonly queue: Int32Array;
  /** Per space: whether it counts as a built, enclosed room. */
  private sheltered: boolean[] = [];
  private dirty = true;

  constructor(private readonly map: TileMap) {
    this.roomId = new Int32Array(map.size);
    this.queue = new Int32Array(map.size);
  }

  /** Call whenever a wall or door is built or removed. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Every distinct open space, indoors or not. */
  get spaceCount(): number {
    this.ensureFresh();
    return this.sheltered.length;
  }

  /** Rooms the colony actually built. What the HUD reports. */
  get enclosedCount(): number {
    this.ensureFresh();
    return this.sheltered.filter(Boolean).length;
  }

  roomAt(position: TilePos): number {
    this.ensureFresh();
    const z = position.z ?? GROUND_LEVEL;
    if (!this.map.inBounds(position.x, position.y, z)) return NO_ROOM;
    return this.roomId[this.map.idx(position.x, position.y, z)];
  }

  /** True when this cell sits inside a sealed space that colonists built. */
  isIndoors(position: TilePos): boolean {
    const room = this.roomAt(position);
    if (room === NO_ROOM) return false;
    return this.sheltered[room];
  }

  private ensureFresh(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
  }

  private rebuild(): void {
    const map = this.map;
    this.roomId.fill(NO_ROOM);
    this.sheltered = [];

    for (let z = 0; z < map.levels; z++) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const index = map.idx(x, y, z);
          if (this.roomId[index] !== NO_ROOM) continue;
          if (!this.isRoomInterior(x, y, z, index)) continue;
          this.sheltered.push(this.fill(x, y, z, this.sheltered.length));
        }
      }
    }
  }

  /**
   * Whether a cell can be *inside* a room.
   *
   * Walls and doors are excluded even though a door is walkable — they are the boundary,
   * not the interior.
   */
  private isRoomInterior(x: number, y: number, z: number, index: number): boolean {
    if (this.map.sealsRoomAt(index)) return false;
    return this.map.isPassable(x, y, z);
  }

  /**
   * Flood fills one space.
   *
   * Returns whether it counts as a room: enclosed *and* bounded somewhere by something
   * built. Both facts fall out of the same walk, so they are gathered together.
   */
  private fill(startX: number, startY: number, z: number, id: number): boolean {
    const map = this.map;
    const queue = this.queue;
    let head = 0;
    let tail = 0;
    let escaped = false;
    let touchesStructure = false;

    const start = map.idx(startX, startY, z);
    this.roomId[start] = id;
    queue[tail++] = start;

    while (head < tail) {
      const current = queue[head++];
      const cx = map.xOf(current);
      const cy = map.yOf(current);

      // Touching the border means this space opens onto the world.
      if (cx === 0 || cy === 0 || cx === map.width - 1 || cy === map.height - 1) {
        escaped = true;
      }

      // Orthogonal only. Diagonal spread would leak a room through the point where two
      // walls meet at a corner, and a house with a diagonal gap is not a house.
      for (const [dx, dy] of ORTHOGONAL) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!map.inBounds(nx, ny, z)) continue;

        const neighbour = map.idx(nx, ny, z);
        if (map.sealsRoomAt(neighbour)) touchesStructure = true;

        if (this.roomId[neighbour] !== NO_ROOM) continue;
        if (!this.isRoomInterior(nx, ny, z, neighbour)) continue;

        this.roomId[neighbour] = id;
        queue[tail++] = neighbour;
      }
    }

    return !escaped && touchesStructure;
  }
}

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
