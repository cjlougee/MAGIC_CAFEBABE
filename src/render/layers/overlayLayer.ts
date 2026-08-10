/**
 * The player's intentions, drawn on the ground.
 *
 * Sits between the ground and the objects that stand on it: designations and zones are
 * marks *on* the floor, so a colonist or a boulder should cover them. Needs no depth
 * sorting for the same reason GroundLayer doesn't — every overlay is flat.
 *
 * Also draws the live drag preview, which is view-only state and never reaches the
 * simulation. Nothing is designated until the player releases the button.
 */

import { Container, Sprite } from 'pixi.js';
import { Designation } from '../../sim/world/designations';
import type { BuildableId } from '../../sim/defs/buildables';
import {
  cellsOf,
  footprintOfBuildable,
  isSingleCell,
  type Rotation,
} from '../../sim/world/footprint';
import {
  canDesignateDeconstruct,
  canDesignateMine,
  canPlaceBlueprint,
  canPlaceFootprint,
  canPlaceStockpile,
} from '../../sim/world/placement';
import type { World } from '../../sim/world/world';
import type { ArtProvider } from '../art/artProvider';
import { Palette } from '../art/palette';
import type { TileRect, WorldRect } from '../camera/camera';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { tileToWorld } from '../iso';

/**
 * Which cells a tool would actually affect, so the preview can say so up front.
 *
 * `select` is here because a drag with no marquee reads as a broken control. It was
 * excluded on the grounds that selecting changes nothing about the world — true, and
 * beside the point: the player still needs to see the box they are dragging. Reported
 * as "I can't drag select", when it had been selecting correctly the whole time and
 * simply never drew anything.
 */
export type PreviewTool = 'select' | 'mine' | 'deconstruct' | 'stockpile' | 'erase' | 'build';

export interface DragPreview {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z: number;
  readonly tool: PreviewTool;
  /** Set only for the build tool. Decides the footprint drawn under the cursor. */
  readonly buildable?: BuildableId;
  readonly rotation?: Rotation;
}

const REJECTED_TINT = Palette.danger;
const REJECTED_ALPHA = 0.55;

/**
 * Whether the active tool would actually affect a cell.
 *
 * Delegates to the same predicates the command handlers use, so the preview can never
 * promise something the simulation then refuses.
 */
function acceptsCell(world: World, tool: PreviewTool, x: number, y: number, z: number): boolean {
  if (!world.map.inBounds(x, y, z)) return false;
  const index = world.map.idx(x, y, z);

  switch (tool) {
    // A selection box asks nothing of the ground, so no cell is ever greyed out.
    case 'select':
      return true;
    case 'mine':
      return canDesignateMine(world.map, index);
    case 'deconstruct':
      return canDesignateDeconstruct(world, index);
    case 'stockpile':
      return canPlaceStockpile(world.map, index);
    case 'build':
      return canPlaceBlueprint(world, index);
    case 'erase':
      // Erase always applies; there is nothing to be refused.
      return true;
  }
}

export class OverlayLayer {
  readonly container = new Container();
  private readonly pool: Sprite[] = [];

  constructor(private readonly art: ArtProvider) {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
  }

  update(world: World, view: TileRect, visible: WorldRect, preview: DragPreview | null): void {
    let used = 0;

    const place = (x: number, y: number, texture: Sprite['texture'], rejected = false): void => {
      const at = tileToWorld(x, y);
      if (at.x + HALF_TILE_W < visible.x0 || at.x - HALF_TILE_W > visible.x1) return;
      if (at.y + HALF_TILE_H < visible.y0 || at.y - HALF_TILE_H > visible.y1) return;

      const sprite = this.spriteAt(used++);
      sprite.texture = texture;
      sprite.position.set(at.x - HALF_TILE_W, at.y - HALF_TILE_H);
      sprite.tint = rejected ? REJECTED_TINT : 0xffffff;
      sprite.alpha = rejected ? REJECTED_ALPHA : 1;
      sprite.visible = true;
    };

    // Zones and designations are iterated from their own sets rather than by sweeping
    // the viewport, because they are sparse — usually a handful of cells on a map of
    // tens of thousands.
    const stockpile = this.art.stockpileTile();
    for (const index of world.zones.stockpiles) {
      const x = world.map.xOf(index);
      const y = world.map.yOf(index);
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      place(x, y, stockpile);
    }

    const marker = this.art.mineMarker();
    for (const index of world.designations.cells(Designation.Mine)) {
      const x = world.map.xOf(index);
      const y = world.map.yOf(index);
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      place(x, y, marker);
    }

    const demolition = this.art.deconstructMarker();
    for (const index of world.designations.cells(Designation.Deconstruct)) {
      const x = world.map.xOf(index);
      const y = world.map.yOf(index);
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      place(x, y, demolition);
    }

    if (preview) {
      const previewTexture = this.art.previewTile();
      const footprint =
        preview.buildable === undefined ? null : footprintOfBuildable(preview.buildable);

      for (let y = preview.y0; y <= preview.y1; y++) {
        for (let x = preview.x0; x <= preview.x1; x++) {
          if (footprint && !isSingleCell(footprint)) {
            // A footprint is legal or it is not — there is no half-placing it, so the
            // whole shape greys out together. Marking only the offending cell would
            // suggest the rest is going to be built.
            const anchor = { x, y, z: preview.z };
            const rotation = preview.rotation ?? 0;
            const rejected = !canPlaceFootprint(
              world,
              anchor,
              preview.buildable as BuildableId,
              rotation,
            );
            for (const cell of cellsOf(anchor, footprint, rotation)) {
              if (!world.map.inBounds(cell.x, cell.y, cell.z)) continue;
              place(cell.x, cell.y, previewTexture, rejected);
            }
            continue;
          }

          if (!world.map.inBounds(x, y, preview.z)) continue;
          // Cells the tool will skip are marked before the player commits, rather than
          // silently doing nothing and leaving them to wonder whether it registered.
          place(x, y, previewTexture, !acceptsCell(world, preview.tool, x, y, preview.z));
        }
      }
    }

    for (let i = used; i < this.pool.length; i++) {
      this.pool[i].visible = false;
    }
  }

  private spriteAt(index: number): Sprite {
    let sprite = this.pool[index];
    if (!sprite) {
      sprite = new Sprite();
      sprite.eventMode = 'none';
      this.pool[index] = sprite;
      this.container.addChild(sprite);
    }
    return sprite;
  }


  destroy(): void {
    this.container.destroy({ children: true });
    this.pool.length = 0;
  }
}
