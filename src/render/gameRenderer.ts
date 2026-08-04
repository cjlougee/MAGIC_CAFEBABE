/**
 * Owns the Pixi application and every draw layer.
 *
 * Reads world state; never writes it. If you find yourself wanting to mutate the
 * simulation from in here, the change belongs in a Command instead.
 */

import { Application, Container } from 'pixi.js';
import { daylight } from '../sim/world/time';
import type { World } from '../sim/world/world';
import { ArtProvider } from './art/artProvider';
import { Palette } from './art/palette';
import { Camera } from './camera/camera';
import { CameraController } from './camera/cameraController';
import { DEFAULT_ZOOM } from './constants';
import { LightingLayer } from './layers/lightingLayer';
import { TerrainLayer } from './layers/terrainLayer';

export class GameRenderer {
  readonly camera: Camera;

  private readonly worldContainer = new Container();
  private readonly terrain: TerrainLayer;
  private readonly lighting = new LightingLayer();
  private readonly controller: CameraController;

  private constructor(
    private readonly app: Application,
    private readonly art: ArtProvider,
    camera: Camera,
  ) {
    this.camera = camera;
    this.terrain = new TerrainLayer(art);

    this.worldContainer.addChild(this.terrain.container);
    this.app.stage.addChild(this.worldContainer);
    // Lighting sits outside the world container so it stays screen-aligned rather
    // than scaling and panning with the map.
    this.app.stage.addChild(this.lighting.sprite);

    this.controller = new CameraController(this.camera, this.app.canvas);
    this.controller.attach();
    this.app.canvas.style.cursor = 'grab';
  }

  static async create(host: HTMLElement, world: World): Promise<GameRenderer> {
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

    const camera = new Camera(world.map.width / 2, world.map.height / 2, DEFAULT_ZOOM);

    // The app's own ticker would drive rendering independently of the simulation
    // clock; we drive both from one loop so speed control stays coherent.
    app.ticker.stop();

    return new GameRenderer(app, art, camera);
  }

  /** Draws one frame. `dtMs` is real elapsed time, used for smooth key panning. */
  render(world: World, dtMs: number): void {
    const width = this.app.screen.width;
    const height = this.app.screen.height;

    this.controller.update(dtMs, world.map.width, world.map.height);
    this.camera.applyTo(this.worldContainer, width, height);

    const view = this.camera.visibleTiles(width, height, world.map.width, world.map.height);
    this.terrain.update(world.map, world.seed, view);
    this.lighting.update(daylight(world.tick), width, height);

    this.app.renderer.render(this.app.stage);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  destroy(): void {
    this.controller.detach();
    this.terrain.destroy();
    this.lighting.destroy();
    this.art.destroy();
    this.app.destroy(true, { children: true });
  }
}
