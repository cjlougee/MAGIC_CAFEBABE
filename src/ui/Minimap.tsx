/**
 * Where you are, and where the places are.
 *
 * The 512² world is sixteen times the map Slice 1 shipped, and the zoom bound stops well
 * short of showing it — so without this the player has no way to know a named vault
 * exists eighty tiles north, let alone go there. Clicking jumps the camera, which is the
 * whole navigation story until parties can travel in M9.
 *
 * Terrain is painted to an offscreen canvas and only repainted when `mapRevision`
 * changes; the markers redraw on every snapshot. Mining one rock should not cost a
 * 262,144-pixel repaint, and neither should a colonist taking a step.
 */

import { useEffect, useRef } from 'react';
import type { Engine } from '../app/engine';
import type { PoiSummary } from '../sim/snapshot';

interface MinimapProps {
  readonly engine: Engine;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly pois: readonly PoiSummary[];
  readonly landingSite: { readonly x: number; readonly y: number };
  readonly pawns: readonly { readonly x: number; readonly y: number; readonly dead: boolean }[];
  /** Changes every snapshot, which is what drives the marker redraw. */
  readonly tick: number;
}

/** On-screen size. The canvas itself is one pixel per tile and is scaled by CSS. */
const VIEW_PX = 180;

export function Minimap({
  engine,
  mapWidth,
  mapHeight,
  pois,
  landingSite,
  pawns,
  tick,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const painted = useRef('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Terrain layer, rebuilt only when the world actually changed shape. Re-made from
    // scratch if the world changed *size* — loading a save from a smaller map would
    // otherwise paint a 128-tile world into a 512-tile buffer.
    const cached = terrainRef.current;
    let terrain: HTMLCanvasElement;

    if (cached && cached.width === mapWidth && cached.height === mapHeight) {
      terrain = cached;
    } else {
      terrain = document.createElement('canvas');
      terrain.width = mapWidth;
      terrain.height = mapHeight;
      terrainRef.current = terrain;
      painted.current = '';
    }

    const terrainContext = terrain.getContext('2d');
    if (!terrainContext) return;

    if (painted.current !== engine.minimapKey) {
      const image = terrainContext.createImageData(mapWidth, mapHeight);
      engine.paintMinimap(image);
      terrainContext.putImageData(image, 0, 0);
      painted.current = engine.minimapKey;
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(terrain, 0, 0);

    // The camera's footprint, as the diamond it actually is.
    const corners = engine.viewportTileCorners();
    context.beginPath();
    context.moveTo(corners[0].x, corners[0].y);
    for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
    context.closePath();
    context.strokeStyle = 'rgba(223, 230, 238, 0.85)';
    context.lineWidth = Math.max(2, mapWidth / 220);
    context.stroke();

    // Colonists, then home, then the places — drawn last because they are the reason
    // this panel exists and nothing should be able to hide one.
    context.fillStyle = 'rgba(127, 191, 95, 0.95)';
    const dot = Math.max(3, mapWidth / 150);
    for (const pawn of pawns) {
      if (pawn.dead) continue;
      context.fillRect(pawn.x - dot / 2, pawn.y - dot / 2, dot, dot);
    }

    const home = Math.max(6, mapWidth / 70);
    context.strokeStyle = 'rgba(232, 193, 92, 0.95)';
    context.lineWidth = Math.max(2, mapWidth / 220);
    context.strokeRect(landingSite.x - home / 2, landingSite.y - home / 2, home, home);

    for (const poi of pois) {
      const size = Math.max(8, poi.radius * 2);
      context.strokeStyle = 'rgba(83, 214, 196, 0.95)';
      context.lineWidth = Math.max(2, mapWidth / 200);
      context.strokeRect(poi.x - size / 2, poi.y - size / 2, size, size);
    }
  }, [engine, mapWidth, mapHeight, pois, landingSite, pawns, tick]);

  /**
   * Where a pointer event lands, in tiles.
   *
   * Clamped, because a drag that leaves the canvas keeps delivering events — pointer
   * capture is the whole point — and an unclamped read would fling the camera off the
   * map when the cursor overshoots the edge.
   */
  const tileUnder = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * mapWidth;
    const y = ((event.clientY - bounds.top) / bounds.height) * mapHeight;
    return {
      x: Math.round(Math.min(mapWidth - 1, Math.max(0, x))),
      y: Math.round(Math.min(mapHeight - 1, Math.max(0, y))),
    };
  };

  /**
   * Press and drag to scrub the camera, rather than click-to-jump only.
   *
   * Pointer capture on the canvas, so the drag survives the cursor leaving it. On a
   * 512-tile map the minimap is the only way to cross the world quickly, and jumping in
   * discrete hops meant losing your bearings between each one — scrubbing keeps the
   * relationship between where you are and where you are going visible the whole way.
   */
  const scrubTo = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const at = tileUnder(event);
    engine.centreCameraOn(at.x, at.y);
  };

  const beginScrub = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    // Left button only. The right button is the camera everywhere else in the game and
    // must not quietly mean something different here — see ADR 0005.
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event);
  };

  const continueScrub = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    scrubTo(event);
  };

  const endScrub = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section className="minimap">
      <canvas
        ref={canvasRef}
        className="minimap__canvas"
        width={mapWidth}
        height={mapHeight}
        style={{ width: VIEW_PX, height: VIEW_PX }}
        onPointerDown={beginScrub}
        onPointerMove={continueScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        title="Click to jump the camera, or drag to scrub it"
      />
      <ul className="minimap__places">
        {pois.length === 0 && <li className="minimap__empty">No places found</li>}
        {pois.map((poi) => (
          <li key={poi.id}>
            <button
              type="button"
              className="minimap__place"
              onClick={() => engine.centreCameraOn(poi.x, poi.y)}
              title={`${poi.kind} — ${poi.distance} tiles from the landing site`}
            >
              <span className="minimap__place-name">{poi.name}</span>
              <span className="minimap__place-distance">{poi.distance}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
