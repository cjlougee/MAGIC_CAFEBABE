/** Presentation constants. The simulation works in tiles and knows none of this. */

/** Pixels per tile at zoom 1. */
export const TILE_SIZE = 32;

/** Zoom bounds, chosen so the sprite pool stays bounded (see TerrainLayer). */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 1;

/** Extra tiles rendered past the viewport edge, so panning never shows a bare gap. */
export const VIEW_MARGIN_TILES = 2;
