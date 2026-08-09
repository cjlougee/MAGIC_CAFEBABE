/**
 * The world, one pixel per tile.
 *
 * `MIN_ZOOM` deliberately stops well short of showing the whole 512² map, because at that
 * zoom a tile is under eight pixels and the art is mush. This is the other answer: not a
 * smaller view of the game, but a different depiction of it — colour per terrain, no
 * projection, no relief. See `docs/design/08-the-world.md`.
 *
 * Derived render state. It is a pure function of the terrain grid, rebuilt when
 * `TileMap.revision` says the grid changed, and never saved.
 */

import type { TileMap } from '../sim/world/tilemap';
import { terrainColour } from './art/terrainArt';
import { Palette } from './art/palette';

/**
 * Painted flat, in tile order, with no isometric transform at all.
 *
 * A minimap that matched the projection would be a diamond with wasted corners, and
 * would make north-east ambiguous — the player already has one isometric view and needs
 * the other kind here: a plan, where up is up.
 */
export function paintMinimapTerrain(map: TileMap, image: ImageData): void {
  const pixels = image.data;
  const width = Math.min(map.width, image.width);
  const height = Math.min(map.height, image.height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = map.idx(x, y);

      // A structure the colony built shows as *wall*, not as the ground it stands on,
      // so a base reads as a shape rather than as a smudge of stone floor.
      const colour = map.buildingBlocks[index] !== 0
        ? Palette.wall
        : terrainColour(map.terrainAt(index));

      const at = (y * image.width + x) * 4;
      pixels[at] = (colour >> 16) & 0xff;
      pixels[at + 1] = (colour >> 8) & 0xff;
      pixels[at + 2] = colour & 0xff;
      pixels[at + 3] = 255;
    }
  }
}
