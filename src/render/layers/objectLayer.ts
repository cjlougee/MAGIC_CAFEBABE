/**
 * Everything with vertical extent: raised terrain, and colonists.
 *
 * These share a layer because they must share a **sort**. A pawn walking behind a
 * bulkhead has to be drawn before it, and a pawn walking in front has to be drawn
 * after; that decision cannot be made if they live in separate containers. Flat ground
 * is excluded precisely because it never overlaps anything and never needs sorting —
 * see GroundLayer.
 *
 * Rebuilt every frame rather than cached on view change, because its contents move
 * every frame. It is a few hundred sprites against GroundLayer's few thousand, which
 * is exactly why the split is worth making.
 */

import { Container, Sprite } from 'pixi.js';
import type { EntityId } from '../../sim/core/entityStore';
import { TERRAIN_DEFS } from '../../sim/defs/terrain';
import { isOnGround } from '../../sim/entities/item';
import { buildingCells } from '../../sim/entities/building';
import { pawnVisualPos, type Pawn, type PawnAppearance } from '../../sim/entities/pawn';
import { ripeness } from '../../sim/entities/plant';
import { Designation } from '../../sim/world/designations';
import { footprintOfBuilding, sizeOf } from '../../sim/world/footprint';
import { buildingAt } from '../../sim/world/lookup';
import type { World } from '../../sim/world/world';
import type { ArtProvider } from '../art/artProvider';
import { mixColors, Palette } from '../art/palette';
import { buildProgress, siteCells } from '../../sim/entities/constructionSite';
import { BUILDING_HEIGHT, siteStageFor } from '../art/buildingArt';
import { ITEM_GROUND_Y, ITEM_H, ITEM_W } from '../art/itemArt';
import { PAWN_ASLEEP_GROUND_Y, PAWN_ASLEEP_H, PAWN_GROUND_Y, PAWN_H } from '../art/pawnArt';
import { PLANT_GROUND_Y, PLANT_H, PLANT_W, stageFor } from '../art/plantArt';
import { terrainHeight, variantForCell } from '../art/terrainArt';
import type { TerrainTintField } from '../art/terrainTint';
import type { TileRect, WorldRect } from '../camera/camera';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { footprintBounds, tileToWorld } from '../iso';
import { collectOccluders } from '../occlusion';

/** How transparent an occluding tile becomes. Low enough to clearly read the pawn. */
const OCCLUDED_ALPHA = 0.32;

/**
 * Depth is scaled so entities can be slotted *between* tile depths.
 *
 * A pawn at tile depth d sorts at `d * DEPTH_SCALE + ENTITY_BIAS` — after the tile it
 * stands on, before the tile in front of it.
 */
/**
 * Within one tile's depth, things stack in the order they physically sit:
 * floor structures, then piles on the floor, then plants, then people.
 */
const DEPTH_SCALE = 16;
const BUILDING_BIAS = 2;
const ITEM_BIAS = 4;
const PLANT_BIAS = 6;
const ENTITY_BIAS = 8;

interface PawnVisual {
  readonly pawn: Pawn;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
}

export class ObjectLayer {
  readonly container = new Container();

  private readonly tilePool: Sprite[] = [];
  private readonly itemPool: Sprite[] = [];
  private readonly plantPool: Sprite[] = [];
  private readonly buildingPool: Sprite[] = [];
  private readonly sitePool: Sprite[] = [];
  private readonly pawnSprites = new Map<EntityId, Sprite>();
  private readonly facing = new Map<EntityId, number>();
  private readonly occluders = new Set<number>();
  /**
   * One ring per selected colonist, pooled.
   *
   * Was a single sprite, which was exactly right while only one pawn could be selected
   * and silently wrong the moment a party could — the last pawn in the loop would have
   * taken the ring and the rest would have looked unselected while still obeying orders.
   */
  private readonly selectionRings: Sprite[] = [];

  constructor(
    private readonly art: ArtProvider,
    private readonly tint: TerrainTintField,
  ) {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
    this.container.sortableChildren = true;

  }

  update(world: World, view: TileRect, visible: WorldRect, selected: ReadonlySet<EntityId>): void {
    const visuals: PawnVisual[] = [...world.pawns.values()].map((pawn) => ({
      pawn,
      at: pawnVisualPos(pawn),
    }));

    collectOccluders(
      world.map,
      visuals.map((entry) => entry.at),
      this.occluders,
    );

    this.updateTiles(world, view, visible);
    this.updateBuildings(world, visible);
    this.updateSites(world, visible);
    this.updatePlants(world, visible);
    this.updateItems(world, visible);
    this.updatePawns(world, visuals, selected);
  }

  private updateBuildings(world: World, visible: WorldRect): void {
    let used = 0;

    for (const building of world.buildings.values()) {
      const height = BUILDING_HEIGHT[building.def] ?? 0;
      const { w, h } = sizeOf(footprintOfBuilding(building.def), building.rotation);
      const box = footprintBounds(
        building.pos.x,
        building.pos.y,
        w,
        h,
        building.pos.z,
        height,
      );
      if (box.left + box.width < visible.x0 || box.left > visible.x1) continue;
      if (box.top + box.height < visible.y0 || box.top > visible.y1) continue;

      const sprite = this.fromPool(this.buildingPool, used++, 0, 0);
      sprite.texture = this.art.building(building.def, building.rotation, building.locked);

      /*
       * Marked-for-demolition is shown *on the structure*, because it cannot be shown
       * under it. Designation marks belong to OverlayLayer, which sits below objects so
       * that pawns and walls cover the floor — which meant a wall completely hid its own
       * mark, and marking one gave the player no feedback whatsoever. Floors, being flat,
       * were fine; buildings are what the tool is mostly aimed at.
       *
       * Assigned on both branches, never just the marked one: these sprites are pooled
       * and recycled, so an unmarked building would inherit the last tenant's red.
       */
      const index = world.map.idx(building.pos.x, building.pos.y, building.pos.z);
      sprite.tint = world.designations.has(Designation.Deconstruct, index)
        ? Palette.markedForDeconstruct
        : 0xffffff;
      // Same offset rule as raised terrain: the texture's base diamond sits `height`
      // pixels down from its top edge, so the footprint lands on the ground plane.
      sprite.position.set(box.left, box.top);
      /*
       * Raised structures sort with the *pawn* bias, not the floor bias.
       *
       * A wall is a tall thing standing on a cell, exactly like a rock — sorting it
       * under items would draw a stone pile in front of the wall behind it. Flat
       * buildings keep the floor bias so a bedroll stays under whoever sleeps on it.
       *
       * Depth is the footprint's *nearest* corner, not its anchor: one sprite covering
       * several cells has to draw after everything behind all of them, or a 2x2 hearth
       * would be overdrawn by the very tiles it stands on.
       */
      const bias = height > 0 ? ENTITY_BIAS - 1 : BUILDING_BIAS;
      const depth = building.pos.x + w - 1 + (building.pos.y + h - 1);
      sprite.zIndex = depth * DEPTH_SCALE + bias;
      sprite.visible = true;
    }

    this.hideRest(this.buildingPool, used);
  }

  private updateSites(world: World, visible: WorldRect): void {
    let used = 0;

    for (const site of world.sites.values()) {
      const texture = this.art.site(siteStageFor(buildProgress(site)));

      // One marker per cell rather than one stretched sprite. A blueprint is a promise
      // about *ground*, and saying so cell by cell is both honest and free — the site
      // texture is flat, so nothing about it needs to know the footprint's shape.
      for (const cell of siteCells(site)) {
        const at = tileToWorld(cell.x, cell.y, cell.z);
        if (at.x + HALF_TILE_W < visible.x0 || at.x - HALF_TILE_W > visible.x1) continue;
        if (at.y + HALF_TILE_H < visible.y0 || at.y - HALF_TILE_H > visible.y1) continue;

        const sprite = this.fromPool(this.sitePool, used++, 0, 0);
        sprite.texture = texture;
        sprite.position.set(at.x - HALF_TILE_W, at.y - HALF_TILE_H);
        sprite.zIndex = (cell.x + cell.y) * DEPTH_SCALE + BUILDING_BIAS + 1;
        sprite.visible = true;
      }
    }

    this.hideRest(this.sitePool, used);
  }

  private updatePlants(world: World, visible: WorldRect): void {
    let used = 0;

    for (const plant of world.plants.values()) {
      const at = tileToWorld(plant.pos.x, plant.pos.y, plant.pos.z);
      if (at.x + PLANT_W < visible.x0 || at.x - PLANT_W > visible.x1) continue;
      if (at.y + PLANT_H < visible.y0 || at.y - PLANT_H > visible.y1) continue;

      const sprite = this.fromPool(this.plantPool, used++, 0.5, PLANT_GROUND_Y / PLANT_H);
      sprite.texture = this.art.plant(stageFor(ripeness(plant)));
      sprite.position.set(at.x, at.y);
      sprite.zIndex = (plant.pos.x + plant.pos.y) * DEPTH_SCALE + PLANT_BIAS;
      sprite.visible = true;
    }

    this.hideRest(this.plantPool, used);
  }

  /** Piles lying on the ground. Carried stacks travel with their pawn instead. */
  private updateItems(world: World, visible: WorldRect): void {
    let used = 0;

    for (const item of world.items.values()) {
      if (!isOnGround(item) || !item.pos) continue;

      const at = tileToWorld(item.pos.x, item.pos.y, item.pos.z);
      if (at.x + ITEM_W < visible.x0 || at.x - ITEM_W > visible.x1) continue;
      if (at.y + ITEM_H < visible.y0 || at.y - ITEM_H > visible.y1) continue;

      const sprite = this.itemAt(used++);
      sprite.texture = this.art.item(item.def);
      sprite.position.set(at.x, at.y);
      sprite.zIndex = (item.pos.x + item.pos.y) * DEPTH_SCALE + ITEM_BIAS;
      sprite.visible = true;
    }

    this.hideRest(this.itemPool, used);
  }

  private updateTiles(world: World, view: TileRect, visible: WorldRect): void {
    const { map, seed } = world;
    let used = 0;

    for (let y = view.y0; y <= view.y1; y++) {
      for (let x = view.x0; x <= view.x1; x++) {
        const index = map.idx(x, y);
        const terrain = map.terrainAt(index);
        const height = terrainHeight(terrain);
        if (height === 0) continue; // GroundLayer's business.

        const pos = tileToWorld(x, y);
        if (pos.x + HALF_TILE_W < visible.x0 || pos.x - HALF_TILE_W > visible.x1) continue;
        if (pos.y + HALF_TILE_H < visible.y0 || pos.y - HALF_TILE_H - height > visible.y1) continue;

        const sprite = this.tileAt(used++);
        sprite.texture = this.art.terrain(
          terrain,
          variantForCell(x, y, seed, TERRAIN_DEFS[terrain].variants),
        );
        // The texture's base diamond sits `height` pixels down from its top edge, so
        // offsetting by height puts the tile's footprint on the ground plane.
        sprite.position.set(pos.x - HALF_TILE_W, pos.y - HALF_TILE_H - height);
        /*
         * A mine mark is shown *on the rock*, for the reason a demolition mark is shown
         * on the wall: the overlay marker is drawn on the ground plane, and this tile
         * stands 14px above it, so the mark landed at the base of the block it referred
         * to and read as nothing at all against dark stone.
         *
         * Mixed with the terrain tint field rather than replacing it — that field is what
         * stops large areas of one terrain reading as flat colour, and overwriting it
         * would trade one invisible thing for another.
         */
        const marked = world.designations.has(Designation.Mine, index);
        sprite.tint = marked
          ? mixColors(this.tint.at(index), Palette.markedForMine, 0.6)
          : this.tint.at(index);
        sprite.zIndex = (x + y) * DEPTH_SCALE;
        sprite.alpha = this.occluders.has(index) ? OCCLUDED_ALPHA : 1;
        sprite.visible = true;
      }
    }

    for (let i = used; i < this.tilePool.length; i++) {
      this.tilePool[i].visible = false;
    }
  }

  private updatePawns(
    world: World,
    visuals: readonly PawnVisual[],
    selected: ReadonlySet<EntityId>,
  ): void {
    const alive = new Set<EntityId>();
    let ringsUsed = 0;

    for (const { pawn, at } of visuals) {
      alive.add(pawn.id);
      const sprite = this.pawnAt(pawn.id, pawn.appearance);
      const screen = tileToWorld(at.x, at.y, at.z);

      /*
       * Asleep is a different sprite, not the standing one laid over a bed.
       *
       * The bed underneath decides which way they lie, so the body runs along it rather
       * than across it and the head lands on the same end as the pillow. Sleeping rough
       * finds no bed and lies along the default axis, which is still better than standing
       * bolt upright in a field.
       */
      const bed = pawn.asleep
        ? buildingAt(world, world.map.idx(at.x | 0, at.y | 0, at.z))
        : undefined;

      if (pawn.asleep) {
        const rotation = bed?.rotation ?? 0;
        sprite.texture = this.art.pawnAsleep(pawn.appearance, rotation);
        sprite.anchor.set(0.5, PAWN_ASLEEP_GROUND_Y / PAWN_ASLEEP_H);
        // Never mirrored: the pose already carries its direction, and flipping it would
        // reverse the light on the blanket.
        sprite.scale.x = 1;
      } else {
        sprite.texture = this.art.pawn(pawn.appearance);
        sprite.anchor.set(0.5, PAWN_GROUND_Y / PAWN_H);
        sprite.scale.x = this.facingFor(pawn);
      }

      sprite.position.set(screen.x, screen.y);

      /*
       * A sleeper sorts with the bed, not with their own cell.
       *
       * A building takes the depth of its footprint's *nearest* corner, so a colonist
       * asleep on the head cell of a 2x1 bed has a strictly smaller depth than the bed
       * does — and would be drawn first, and covered by the very bed they are lying on.
       * Borrowing the bed's depth and keeping the entity bias puts them back on top.
       */
      const depth = bed
        ? Math.max(...buildingCells(bed).map((cell) => cell.x + cell.y))
        : at.x + at.y;
      sprite.zIndex = depth * DEPTH_SCALE + ENTITY_BIAS;
      sprite.visible = true;

      if (selected.has(pawn.id)) {
        const ring = this.ringAt(ringsUsed++);
        ring.position.set(screen.x - HALF_TILE_W, screen.y - HALF_TILE_H);
        // Just under the pawn, so the ring reads as being on the ground beneath them.
        ring.zIndex = depth * DEPTH_SCALE + ENTITY_BIAS - 1;
        ring.visible = true;
      }
    }

    for (let i = ringsUsed; i < this.selectionRings.length; i++) {
      this.selectionRings[i].visible = false;
    }

    // Drop sprites for pawns that no longer exist — regenerating the world replaces
    // the entire colony, and leaked sprites would keep drawing ghosts.
    for (const [id, sprite] of this.pawnSprites) {
      if (alive.has(id)) continue;
      sprite.destroy();
      this.pawnSprites.delete(id);
      this.facing.delete(id);
    }
  }

  /** Grows on demand, like the pawn sprites. A party is never large enough to bound. */
  private ringAt(index: number): Sprite {
    let ring = this.selectionRings[index];
    if (!ring) {
      ring = new Sprite(this.art.selectionRing());
      this.container.addChild(ring);
      this.selectionRings[index] = ring;
    }
    return ring;
  }

  /**
   * Which way a pawn faces, as an x-scale.
   *
   * Derived from *screen* direction, not tile direction: in isometric, moving along
   * +x goes down-RIGHT and +y goes down-LEFT, so the tile delta alone would have pawns
   * facing backwards half the time. Remembered while idle so a pawn doesn't snap back
   * to a default the moment it stops.
   */
  private facingFor(pawn: Pawn): number {
    const target = pawn.moveTarget;
    if (target) {
      const screenDx = target.x - pawn.pos.x - (target.y - pawn.pos.y);
      if (screenDx !== 0) this.facing.set(pawn.id, screenDx > 0 ? 1 : -1);
    }
    return this.facing.get(pawn.id) ?? 1;
  }

  private itemAt(index: number): Sprite {
    return this.fromPool(this.itemPool, index, 0.5, ITEM_GROUND_Y / ITEM_H);
  }

  /** Shared pool machinery. Anchor is fixed when the sprite is first created. */
  private fromPool(pool: Sprite[], index: number, anchorX: number, anchorY: number): Sprite {
    let sprite = pool[index];
    if (!sprite) {
      sprite = new Sprite();
      sprite.anchor.set(anchorX, anchorY);
      sprite.eventMode = 'none';
      pool[index] = sprite;
      this.container.addChild(sprite);
    }
    return sprite;
  }

  private hideRest(pool: Sprite[], used: number): void {
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
  }

  private tileAt(index: number): Sprite {
    let sprite = this.tilePool[index];
    if (!sprite) {
      sprite = new Sprite();
      sprite.eventMode = 'none';
      this.tilePool[index] = sprite;
      this.container.addChild(sprite);
    }
    return sprite;
  }

  private pawnAt(id: EntityId, appearance: PawnAppearance): Sprite {
    let sprite = this.pawnSprites.get(id);
    if (!sprite) {
      sprite = new Sprite(this.art.pawn(appearance));
      // The anchor is set per frame rather than here: standing and sleeping have
      // different frames and different ground lines, and a pawn falling asleep must not
      // keep the standing one and sink into the mattress.
      sprite.anchor.set(0.5, PAWN_GROUND_Y / PAWN_H);
      sprite.eventMode = 'none';
      this.pawnSprites.set(id, sprite);
      this.container.addChild(sprite);
    }
    return sprite;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.tilePool.length = 0;
    this.itemPool.length = 0;
    this.plantPool.length = 0;
    this.buildingPool.length = 0;
    this.sitePool.length = 0;
    this.pawnSprites.clear();
    this.facing.clear();
  }
}
