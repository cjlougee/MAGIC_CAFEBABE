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
import { pawnVisualPos, type Pawn, type PawnAppearance } from '../../sim/entities/pawn';
import { ripeness } from '../../sim/entities/plant';
import type { World } from '../../sim/world/world';
import type { ArtProvider } from '../art/artProvider';
import { ITEM_GROUND_Y, ITEM_H, ITEM_W } from '../art/itemArt';
import { PAWN_GROUND_Y, PAWN_H } from '../art/pawnArt';
import { PLANT_GROUND_Y, PLANT_H, PLANT_W, stageFor } from '../art/plantArt';
import { terrainHeight, variantForCell } from '../art/terrainArt';
import type { TerrainTintField } from '../art/terrainTint';
import type { TileRect, WorldRect } from '../camera/camera';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { tileToWorld } from '../iso';
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
  private readonly pawnSprites = new Map<EntityId, Sprite>();
  private readonly facing = new Map<EntityId, number>();
  private readonly occluders = new Set<number>();
  private readonly selectionRing: Sprite;

  constructor(
    private readonly art: ArtProvider,
    private readonly tint: TerrainTintField,
  ) {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
    this.container.sortableChildren = true;

    this.selectionRing = new Sprite(art.selectionRing());
    this.selectionRing.visible = false;
    this.container.addChild(this.selectionRing);
  }

  update(world: World, view: TileRect, visible: WorldRect, selectedId: EntityId | null): void {
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
    this.updatePlants(world, visible);
    this.updateItems(world, visible);
    this.updatePawns(visuals, selectedId);
  }

  private updateBuildings(world: World, visible: WorldRect): void {
    let used = 0;

    for (const building of world.buildings.values()) {
      const at = tileToWorld(building.pos.x, building.pos.y, building.pos.z);
      if (at.x + HALF_TILE_W < visible.x0 || at.x - HALF_TILE_W > visible.x1) continue;
      if (at.y + HALF_TILE_H < visible.y0 || at.y - HALF_TILE_H > visible.y1) continue;

      const sprite = this.fromPool(this.buildingPool, used++, 0, 0);
      sprite.texture = this.art.building(building.def);
      sprite.position.set(at.x - HALF_TILE_W, at.y - HALF_TILE_H);
      sprite.zIndex = (building.pos.x + building.pos.y) * DEPTH_SCALE + BUILDING_BIAS;
      sprite.visible = true;
    }

    this.hideRest(this.buildingPool, used);
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
        sprite.tint = this.tint.at(index);
        sprite.zIndex = (x + y) * DEPTH_SCALE;
        sprite.alpha = this.occluders.has(index) ? OCCLUDED_ALPHA : 1;
        sprite.visible = true;
      }
    }

    for (let i = used; i < this.tilePool.length; i++) {
      this.tilePool[i].visible = false;
    }
  }

  private updatePawns(visuals: readonly PawnVisual[], selectedId: EntityId | null): void {
    const alive = new Set<EntityId>();

    for (const { pawn, at } of visuals) {
      alive.add(pawn.id);
      const sprite = this.pawnAt(pawn.id, pawn.appearance);
      const world = tileToWorld(at.x, at.y, at.z);

      sprite.position.set(world.x, world.y);
      sprite.zIndex = (at.x + at.y) * DEPTH_SCALE + ENTITY_BIAS;
      sprite.scale.x = this.facingFor(pawn);
      sprite.visible = true;

      if (selectedId === pawn.id) {
        this.selectionRing.position.set(world.x - HALF_TILE_W, world.y - HALF_TILE_H);
        // Just under the pawn, so the ring reads as being on the ground beneath them.
        this.selectionRing.zIndex = (at.x + at.y) * DEPTH_SCALE + ENTITY_BIAS - 1;
        this.selectionRing.visible = true;
      }
    }

    if (selectedId === null || !alive.has(selectedId)) {
      this.selectionRing.visible = false;
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
      // Anchored at the feet, so a pawn's contact point is the tile centre regardless
      // of how tall the sprite is, and mirroring flips about the body's midline.
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
    this.pawnSprites.clear();
    this.facing.clear();
  }
}
