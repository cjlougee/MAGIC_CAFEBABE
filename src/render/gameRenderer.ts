/**
 * Owns the Pixi application and every draw layer.
 *
 * Reads world state; never writes it. If you find yourself wanting to mutate the
 * simulation from in here, the change belongs in a Command instead.
 *
 * Draw layers, bottom to top:
 *   GroundLayer   flat terrain — thousands of sprites, never overlaps, never sorted
 *   OverlayLayer  designations and zones — marks on the floor, so objects cover them
 *   ObjectLayer   raised terrain + items + colonists — sorted together by depth
 *   LightingLayer screen-space day/night wash
 */

import { Application, Container } from 'pixi.js';
import type { EntityId } from '../sim/core/entityStore';
import { daylight } from '../sim/world/time';
import type { World } from '../sim/world/world';
import { ArtProvider } from './art/artProvider';
import { Palette } from './art/palette';
import { TerrainTintField } from './art/terrainTint';
import { Camera } from './camera/camera';
import { CameraController } from './camera/cameraController';
import { DEFAULT_ZOOM } from './constants';
import { GroundLayer } from './layers/groundLayer';
import { EmissiveLayer } from './layers/emissiveLayer';
import { LightingLayer } from './layers/lightingLayer';
import { ObjectLayer } from './layers/objectLayer';
import { OrderMarkerLayer } from './layers/orderMarkerLayer';
import { OverlayLayer, type DragPreview } from './layers/overlayLayer';

export class GameRenderer {
  readonly camera: Camera;

  private readonly worldContainer = new Container();
  private readonly tint = new TerrainTintField();
  private readonly ground: GroundLayer;
  private readonly overlays: OverlayLayer;
  private readonly objects: ObjectLayer;
  private readonly orderMarkers: OrderMarkerLayer;
  private readonly lighting = new LightingLayer();
  private readonly emissive = new EmissiveLayer();
  private readonly controller: CameraController;

  private constructor(
    private readonly app: Application,
    private readonly art: ArtProvider,
    camera: Camera,
    shouldPan: (event: PointerEvent) => boolean,
  ) {
    this.camera = camera;
    this.ground = new GroundLayer(art, this.tint);
    this.overlays = new OverlayLayer(art);
    this.objects = new ObjectLayer(art, this.tint);
    this.orderMarkers = new OrderMarkerLayer(art);

    this.worldContainer.addChild(this.ground.container);
    this.worldContainer.addChild(this.overlays.container);
    // Above the designation overlays and below the objects: an order marker is a mark on
    // the ground, so a colonist standing on the tile should cover it.
    this.worldContainer.addChild(this.orderMarkers.container);
    this.worldContainer.addChild(this.objects.container);
    this.app.stage.addChild(this.worldContainer);
    // Lighting sits outside the world container so it stays screen-aligned rather
    // than scaling and panning with the map.
    this.app.stage.addChild(this.lighting.sprite);
    // Both above the wash, so light gives the darkness back rather than being dimmed by
    // it. Emissive first, then fires — a campfire beside a bulkhead should read as the
    // brighter of the two.
    this.app.stage.addChild(this.emissive.container);
    this.app.stage.addChild(this.lighting.glow);

    this.controller = new CameraController(this.camera, this.app.canvas, shouldPan);
    this.controller.attach();
    this.app.canvas.style.cursor = 'default';
  }

  /** Acknowledges a move order on a tile. Pure feedback; the sim knows nothing of it. */
  markOrder(x: number, y: number, z: number): void {
    this.orderMarkers.add(x, y, z);
  }

  /** Resting cursor. The camera swaps to `grabbing` once a pan actually moves. */
  setCursor(cursor: string): void {
    this.app.canvas.style.cursor = cursor;
  }

  static async create(
    host: HTMLElement,
    world: World,
    shouldPan: (event: PointerEvent) => boolean = () => true,
  ): Promise<GameRenderer> {
    const app = new Application();
    await app.init({
      background: Palette.void,
      resizeTo: host,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
    });
    host.appendChild(app.canvas);

    const art = new ArtProvider(app.renderer);
    art.warmUpTerrain();

    // Open on the colony rather than the geometric centre of the map — the player
    // should be looking at their people the moment the game starts.
    const camera = new Camera(world.landingSite.x, world.landingSite.y, DEFAULT_ZOOM);

    // The app's own ticker would drive rendering independently of the simulation
    // clock; we drive both from one loop so speed control stays coherent.
    app.ticker.stop();

    return new GameRenderer(app, art, camera, shouldPan);
  }

  /** Draws one frame. `dtMs` is real elapsed time, used for smooth key panning. */
  render(
    world: World,
    dtMs: number,
    selected: ReadonlySet<EntityId>,
    preview: DragPreview | null = null,
  ): void {
    const width = this.app.screen.width;
    const height = this.app.screen.height;

    this.controller.update(dtMs, world.map.width, world.map.height);
    this.camera.applyTo(this.worldContainer, width, height);

    this.tint.ensure(world.map, world.seed);

    const view = this.camera.visibleTiles(width, height, world.map.width, world.map.height);
    const visible = this.camera.visibleWorld(width, height);

    this.ground.update(world.map, world.seed, view, visible);
    this.overlays.update(world, view, visible, preview);
    this.orderMarkers.update(dtMs);
    this.objects.update(world, view, visible, selected);
    const light = daylight(world.tick);
    this.lighting.update(light, width, height);
    // Screen-space like the wash, but its children are positioned in world coordinates,
    // so it borrows the world transform rather than converting every emitter itself.
    this.lighting.glow.position.copyFrom(this.worldContainer.position);
    this.lighting.glow.scale.copyFrom(this.worldContainer.scale);
    this.lighting.updateEmitters(world, light);

    this.emissive.container.position.copyFrom(this.worldContainer.position);
    this.emissive.container.scale.copyFrom(this.worldContainer.scale);
    this.emissive.update(world.map, view, visible);
    this.emissive.setDaylight(light);

    this.app.renderer.render(this.app.stage);
  }

  /**
   * Drops every cached view of the world.
   *
   * Loading or regenerating swaps the whole World object, and the ground layer caches by
   * seed and terrain revision — both of which a *different* world can coincidentally
   * match, leaving the old map on screen.
   */
  onWorldReplaced(): void {
    // Both cache on map revision, which restarts from zero in a loaded world and so can
    // read as unchanged when in fact everything has.
    this.ground.invalidate();
    this.emissive.invalidate();
    // Receipts for orders given in a world that no longer exists.
    this.orderMarkers.clear();
  }

  /** Centres the view on a tile. Used when the player picks a colonist from the HUD. */
  focusOn(x: number, y: number): void {
    this.camera.x = x;
    this.camera.y = y;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get viewSize(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  destroy(): void {
    this.controller.detach();
    this.ground.destroy();
    this.overlays.destroy();
    this.objects.destroy();
    this.lighting.destroy();
    this.emissive.destroy();
    this.art.destroy();
    this.app.destroy(true, { children: true });
  }
}
